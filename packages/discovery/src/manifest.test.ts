import { describe, expect, it } from 'vitest';
import {
  filterHiddenAgents,
  parseAgentList,
  parseChoiceFlag,
  parseModelList,
  primaryModes,
  providerLabel,
  readCliConfig,
  splitModelSpec,
  subagentModes,
} from './manifest.js';

// Verbatim `opencode agent list` output: the agent header lines are interleaved
// with a JSON permission blob, which is exactly the shape the parser must
// tolerate.
const OPENCODE_AGENT_LIST = `build (primary)
  [
  {
    "permission": "*",
    "action": "allow",
    "pattern": "*"
  },
  {
    "permission": "doom_loop",
    "action": "ask",
    "pattern": "*"
  }
  ]
compaction (primary)
explore (subagent)
general (subagent)
plan (primary)
summary (primary)
title (primary)
explorer (subagent)
`;

const KILO_AGENT_LIST = `ask (primary)
code (primary)
compaction (primary)
debug (primary)
explore (subagent)
general (subagent)
orchestrator (primary)
plan (primary)
summary (primary)
title (primary)
`;

const INTERNAL = ['compaction', 'summary', 'title', 'explore', 'general', 'explorer'];
describe('parseAgentList', () => {
  it('reads the agent headers and ignores the interleaved permission JSON', () => {
    const modes = parseAgentList(OPENCODE_AGENT_LIST);
    expect(modes.map((m) => m.id)).toEqual([
      'build',
      'compaction',
      'explore',
      'general',
      'plan',
      'summary',
      'title',
      'explorer',
    ]);
    expect(modes.every((m) => m.source === 'cli')).toBe(true);
  });

  it('records the primary/subagent distinction reported by the CLI', () => {
    const modes = parseAgentList(OPENCODE_AGENT_LIST);
    expect(modes.find((m) => m.id === 'build')?.type).toBe('primary');
    expect(modes.find((m) => m.id === 'explore')?.type).toBe('subagent');
  });

  it('treats `all` as a selectable primary', () => {
    expect(parseAgentList('general (all)')[0]?.type).toBe('primary');
  });

  it('deduplicates repeated ids', () => {
    expect(parseAgentList('plan (primary)\nplan (primary)').map((m) => m.id)).toEqual(['plan']);
  });

  it('returns nothing for output with no agent headers', () => {
    expect(parseAgentList('Usage: opencode agent <command>')).toEqual([]);
    expect(parseAgentList('')).toEqual([]);
  });

  it('does not treat a JSON key as an agent header', () => {
    expect(parseAgentList('{"build": true}')).toEqual([]);
  });
});

describe('filterHiddenAgents and primaryModes', () => {
  it('reproduces OpenCode real user-selectable modes from live output alone', () => {
    const modes = primaryModes(filterHiddenAgents(parseAgentList(OPENCODE_AGENT_LIST), INTERNAL));
    expect(modes.map((m) => m.id)).toEqual(['build', 'plan']);
  });

  it('reproduces Kilo real user-selectable modes from live output alone', () => {
    const modes = primaryModes(filterHiddenAgents(parseAgentList(KILO_AGENT_LIST), INTERNAL));
    expect(modes.map((m) => m.id)).toEqual(['ask', 'code', 'debug', 'orchestrator', 'plan']);
  });

  it('never surfaces a subagent as a selectable mode', () => {
    const modes = primaryModes(filterHiddenAgents(parseAgentList(KILO_AGENT_LIST), INTERNAL));
    expect(modes.some((m) => m.id === 'explore')).toBe(false);
    expect(modes.some((m) => m.id === 'general')).toBe(false);
  });

  it('survives the CLI hiding subagents entirely', () => {
    // Adapters only hide true implementation detail, so subagents survive and
    // remain visible in their own section.
    const modes = filterHiddenAgents(parseAgentList(KILO_AGENT_LIST), ['compaction', 'summary', 'title']);
    expect(subagentModes(modes).map((m) => m.id)).toEqual(['explore', 'general']);
    expect(primaryModes(modes).map((m) => m.id)).toEqual(['ask', 'code', 'debug', 'orchestrator', 'plan']);
  });

  it('drops internal helpers that are neither primary nor subagent', () => {
    const modes = filterHiddenAgents(parseAgentList(KILO_AGENT_LIST), ['compaction', 'summary', 'title']);
    expect(modes.some((m) => m.id === 'compaction')).toBe(false);
    expect(modes.some((m) => m.id === 'summary')).toBe(false);
  });

  it('defaults to primary when the CLI omits a type', () => {
    expect(primaryModes([{ id: 'x', name: 'x' }]).map((m) => m.id)).toEqual(['x']);
  });
});

describe('parseChoiceFlag', () => {
  const CLAUDE_HELP = `--permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "default",
                                        "dontAsk", "plan")
  --plugin-dir <path>                   Load a plugin from a directory or .zip`;

  it("reads Claude Code's real permission modes from help text", () => {
    expect(parseChoiceFlag(CLAUDE_HELP, '--permission-mode')).toEqual([
      'acceptEdits',
      'auto',
      'bypassPermissions',
      'default',
      'dontAsk',
      'plan',
    ]);
  });

  it('handles a choices list wrapped across lines', () => {
    const wrapped = `--model <m>  (choices:\n  "a",\n  "b")`;
    expect(parseChoiceFlag(wrapped, '--model')).toEqual(['a', 'b']);
  });

  it('returns nothing when the flag is absent or unlisted', () => {
    expect(parseChoiceFlag(CLAUDE_HELP, '--output-format')).toEqual([]);
    expect(parseChoiceFlag('nothing here', '--permission-mode')).toEqual([]);
  });
});

describe('splitModelSpec', () => {
  it('splits on the first slash only', () => {
    expect(splitModelSpec('9router/mmf/mimo-auto')).toEqual({
      provider: '9router',
      model: 'mmf/mimo-auto',
    });
  });

  it('round-trips the exact string the CLI printed', () => {
    for (const spec of ['opencode/big-pickle', '9router/mmf/mimo-auto', 'kilo/~anthropic/claude-sonnet-latest']) {
      const { provider, model } = splitModelSpec(spec);
      expect(`${provider}/${model}`).toBe(spec);
    }
  });

  it('falls back to a default group when there is no slash', () => {
    expect(splitModelSpec('gpt-4')).toEqual({ provider: 'default', model: 'gpt-4' });
  });
});

describe('providerLabel', () => {
  it('strips the decoration CLIs put in front of provider names', () => {
    expect(providerLabel('~anthropic')).toBe('anthropic');
    expect(providerLabel('anthropic')).toBe('anthropic');
  });
});

describe('parseModelList', () => {
  it("groups Kilo's live model output without losing the exact spec", () => {
    const { models, providers } = parseModelList(
      'kilo/~anthropic/claude-sonnet-latest\nkilo/~openai/gpt-luna-latest\nkilo/~anthropic/claude-opus-latest',
    );

    expect(models).toHaveLength(3);
    expect(models[0]).toEqual({
      id: 'kilo/~anthropic/claude-sonnet-latest',
      name: '~anthropic/claude-sonnet-latest',
      providerId: 'kilo',
      source: 'cli',
    });
    expect(providers).toHaveLength(1);
    expect(providers[0]!.id).toBe('kilo');
    expect(providers[0]!.name).toBe('kilo');
    expect(providers[0]!.models).toEqual([
      '~anthropic/claude-sonnet-latest',
      '~openai/gpt-luna-latest',
      '~anthropic/claude-opus-latest',
    ]);
  });

  it('merges tilde aliases into the real provider group', () => {
    // Kilo lists these twice; the tilde marks a curated alias, not a new vendor.
    const { models, providers } = parseModelList(
      ['kilo/~anthropic/claude-sonnet-latest', 'kilo/anthropic/claude-sonnet-5'].join('\n'),
      'kilo',
    );

    expect(providers).toHaveLength(1);
    expect(providers[0]!.id).toBe('anthropic');
    expect(providers[0]!.name).toBe('anthropic');
    expect(providers[0]!.models).toEqual(['claude-sonnet-latest', 'claude-sonnet-5']);
    // No model is lost, and each keeps the exact spec to send back.
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.id)).toEqual([
      'kilo/~anthropic/claude-sonnet-latest',
      'kilo/anthropic/claude-sonnet-5',
    ]);
  });

  it('strips the CLI namespace so the real providers surface', () => {
    const { models, providers } = parseModelList(
      'kilo/~anthropic/claude-sonnet-latest\nkilo/~openai/gpt-luna-latest',
      'kilo',
    );

    expect(providers.map((p) => p.name)).toEqual(['anthropic', 'openai']);
    expect(providers[0]!.models).toEqual(['claude-sonnet-latest']);
    // The spec sent back to the CLI is untouched.
    expect(models[0]!.id).toBe('kilo/~anthropic/claude-sonnet-latest');
  });

  it('does not strip a prefix that is a real provider', () => {
    const { providers } = parseModelList('google/gemini-pro', 'opencode');
    expect(providers.map((p) => p.id)).toEqual(['google']);
  });

  it('groups OpenCode multi-segment provider/model output', () => {
    const { models, providers } = parseModelList('opencode/big-pickle\ngoogle/gemini-pro\nopencode/spaceship');
    expect(models.map((m) => `${m.providerId}/${m.name}`)).toEqual([
      'opencode/big-pickle',
      'google/gemini-pro',
      'opencode/spaceship',
    ]);
    expect(providers.map((p) => p.id)).toEqual(['opencode', 'google']);
  });

  it('ignores prose and blank lines', () => {
    expect(parseModelList('Available models:\n\n  opencode/big-pickle  \n').models).toHaveLength(1);
    expect(parseModelList('no models here').models).toEqual([]);
  });

  it('deduplicates repeated specs', () => {
    expect(parseModelList('opencode/x\nopencode/x').models).toHaveLength(1);
  });
});

describe('readCliConfig', () => {
  it('tolerates JSONC comments and trailing commas', () => {
    const path = `${process.env.TEMP ?? '.'}/opencli-manifest-fixture.json`;
    const { writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(path, '{ // pick plan\n "default_agent": "plan", "model": "anthropic/sonnet", }');
    try {
      expect(readCliConfig(path)).toEqual({ default_agent: 'plan', model: 'anthropic/sonnet' });
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('returns undefined for a missing or malformed file', () => {
    expect(readCliConfig(`${process.env.TEMP ?? '.'}/definitely-missing-opencli.json`)).toBeUndefined();
  });
});
