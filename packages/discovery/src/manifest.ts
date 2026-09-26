// Declarative CLI discovery.
//
// The goal of this module is that OpenCLI never hardcodes an agent's modes,
// models or providers. Adapters describe *how* to interrogate their CLI with a
// `DiscoveryPlan`; this engine picks the strategies and parses the output.
//
// Every probe is best-effort and time-boxed. A CLI that hangs, prints garbage
// or lacks a command must degrade one section of the manifest, never fail the
// whole discovery.
import { spawn } from 'node:child_process';
import type {
  AgentManifest,
  AgentMode,
  AgentModel,
  AgentProvider,
  DiscoveryContext,
  DiscoveryPlan,
  ManifestSource,
} from '@opencli/domain';
import { readFileSync } from 'node:fs';
import { delimiter } from 'node:path';

export interface ProbeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  code: number | null;
}

const DEFAULT_PROBE_TIMEOUT = 30_000;

/**
 * Runs a short-lived probe command.
 *
 * Never rejects: a probe that fails yields `ok: false` so the caller can fall
 * back. The whole process tree is killed on timeout, because agent CLIs
 * routinely leave a child holding the pipe open, which would otherwise wedge
 * the server.
 */
export function runProbe(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (code: number | null, ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, stdout, stderr, timedOut, code });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // The CLIs we probe are installed as npm shims, which need a command
        // interpreter on Windows. Probes are non-interactive, so the fidelity
        // concerns that apply to PTY launches do not arise here.
        shell: process.platform === 'win32',
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: (err as Error).message, timedOut: false, code: null });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      finish(null, false);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      stderr += (err as Error).message;
      finish(null, false);
    });
    child.on('close', (code) => {
      finish(code, !timedOut && code === 0);
    });
  });
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    /* already gone */
  }
}

/**
 * Parses agent listings of the form `name (primary)` / `name (subagent)`.
 *
 * CLIs interleave the list with JSON blobs describing permissions, so only
 * lines that are exactly `name (type)` are considered.
 */
export function parseAgentList(output: string): AgentMode[] {
  const modes: AgentMode[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([\w.-]+)\s*\((primary|subagent|all)\)$/i);
    if (!match) continue;
    const id = match[1]!;
    if (seen.has(id)) continue;
    seen.add(id);

    // `all` is the CLIs' way of saying "usable as a primary".
    const kind = match[2]!.toLowerCase() === 'subagent' ? 'subagent' : 'primary';
    modes.push({ id, name: id, type: kind, source: 'cli' });
  }

  return modes;
}

/**
 * Scrapes enumerated choices out of `--help` output.
 *
 * Claude Code has no agent listing command but does declare its permission
 * modes, so this is a genuine discovery source rather than a hardcoded list.
 */
export function parseChoiceFlag(helpText: string, flag: string): string[] {
  const index = helpText.indexOf(flag);
  if (index < 0) return [];

  // Choices are printed in parentheses after the flag, sometimes wrapped across
  // several lines, so scan a generous window.
  const window = helpText.slice(index, index + 800);
  const choicesMatch = window.match(/choices:\s*([\s\S]*?)\)/);
  if (!choicesMatch) return [];

  return [...choicesMatch[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter(Boolean);
}

/**
 * Splits a model spec into a provider group and a model id.
 *
 * The split is on the *first* slash, which keeps `provider/model` reconstructible
 * as `providerId + '/' + id` and therefore round-trips the exact string the CLI
 * printed. That matters: `kilo/~anthropic/claude-sonnet-latest` must be handed
 * back verbatim, not normalised into something the CLI will reject.
 */
export function splitModelSpec(spec: string): { provider: string; model: string } {
  const trimmed = spec.trim();
  const index = trimmed.indexOf('/');
  if (index <= 0) return { provider: 'default', model: trimmed };
  return { provider: trimmed.slice(0, index), model: trimmed.slice(index + 1) };
}

/** Display label for a provider group, cleaned of CLI-specific decoration. */
export function providerLabel(provider: string): string {
  return provider.replace(/^[~/]+/, '') || provider;
}

/**
 * Grouping key for a provider segment.
 *
 * Kilo lists many models twice, once as `kilo/~anthropic/...` and once as
 * `kilo/anthropic/...`, where the tilde marks a curated alias rather than a
 * different vendor. Grouping on the cleaned key folds those into one provider
 * so the UI does not show `anthropic` twice, while every model keeps its own
 * exact spec for sending back.
 */
function providerKey(provider: string): string {
  return providerLabel(provider);
}

/**
 * Parses newline-delimited model specs into models grouped by provider.
 *
 * `prefix` is the CLI's own namespace (Kilo prefixes every model with `kilo/`).
 * It is removed before grouping so the real providers surface, while `id` keeps
 * the untouched spec so the CLI still accepts what we send back.
 */
export function parseModelList(
  output: string,
  prefix?: string,
): { models: AgentModel[]; providers: AgentProvider[] } {
  const models: AgentModel[] = [];
  const byProvider = new Map<string, string[]>();
  const seen = new Set<string>();
  const selfPrefix = prefix ? `${prefix}/` : undefined;

  for (const raw of output.split(/\r?\n/)) {
    const spec = raw.trim();
    if (!spec || /\s/.test(spec)) continue;
    if (seen.has(spec)) continue;
    seen.add(spec);

    const unprefixed = selfPrefix && spec.toLowerCase().startsWith(selfPrefix.toLowerCase())
      ? spec.slice(selfPrefix.length)
      : spec;
    const { provider, model } = splitModelSpec(unprefixed);
    const key = providerKey(provider);

    models.push({ id: spec, name: model, providerId: key, source: 'cli' });

    const bucket = byProvider.get(key);
    if (bucket) bucket.push(model);
    else byProvider.set(key, [model]);
  }

  const providers: AgentProvider[] = [...byProvider.entries()].map(([id, list]) => ({
    id,
    name: providerLabel(id),
    models: list,
    source: 'cli' as ManifestSource,
  }));

  return { models, providers };
}

/**
 * Removes agents that are CLI implementation detail rather than a user choice.
 *
 * `hidden` is adapter-declared. Everything the CLI reports as a `subagent` is
 * kept: subagents are legitimate orchestration targets, so the UI can show them
 * in their own section instead of silently dropping them.
 */
export function filterHiddenAgents(modes: AgentMode[], hidden: string[] = []): AgentMode[] {
  if (hidden.length === 0) return modes;
  const blocked = new Set(hidden.map((id) => id.toLowerCase()));
  return modes.filter((mode) => !blocked.has(mode.id.toLowerCase()));
}

/** Keeps only modes a user may pick. */
export function primaryModes(modes: AgentMode[]): AgentMode[] {
  return modes.filter((mode) => (mode.type ?? 'primary') === 'primary');
}

/** Secondary agents, kept separate from the user-selectable primary modes. */
export function subagentModes(modes: AgentMode[]): AgentMode[] {
  return modes.filter((mode) => mode.type === 'subagent');
}

export interface DiscoverOptions {
  adapterName: string;
  version?: string;
  capabilities?: AgentManifest['capabilities'];
  supportsInteractive?: boolean;
  /** Optional config file inspected for the CLI's own selections. */
  configPath?: string;
}

/**
 * Runs the plan against the CLI and assembles a manifest.
 *
 * `config` is read opportunistically: a missing or malformed file only removes
 * the `current` hint, it does not fail discovery.
 */
export async function discoverManifest(
  plan: DiscoveryPlan,
  context: DiscoveryContext,
  options: DiscoverOptions,
): Promise<AgentManifest> {
  const env = context.env ?? process.env;
  const timeouts = plan.timeouts ?? {};

  let modes: AgentMode[] = [];
  let modeSource: ManifestSource = 'none';
  const errors: string[] = [];

  if (plan.agentListArgs) {
    const probe = await runProbe(context.executable, plan.agentListArgs, {
      cwd: context.cwd,
      env,
      timeoutMs: timeouts.agentList ?? 45_000,
    });
    const parsed = parseAgentList(`${probe.stdout}\n${probe.stderr}`);
    if (parsed.length > 0) {
      modes = filterHiddenAgents(parsed, plan.hiddenAgents);
      modeSource = 'cli';
    } else if (!probe.ok) {
      errors.push(`agent list failed${probe.timedOut ? ' (timed out)' : ''}`);
    }
  }

  if (modes.length === 0 && plan.helpArgs) {
    const probe = await runProbe(context.executable, plan.helpArgs, {
      cwd: context.cwd,
      env,
      timeoutMs: timeouts.help ?? 20_000,
    });
    const helpText = `${probe.stdout}\n${probe.stderr}`;
    // Only the declared choice flag describes agents; other choice flags
    // (output format, editor mode, ...) are unrelated.
    const choices = plan.choiceFlag ? parseChoiceFlag(helpText, plan.choiceFlag) : [];
    if (choices.length > 0) {
      modes = choices.map((id) => ({ id, name: id, type: 'primary' as const, source: 'cli' as const }));
      modeSource = 'cli';
    } else if (!probe.ok) {
      errors.push(`help probe failed${probe.timedOut ? ' (timed out)' : ''}`);
    }
  }

  let models: AgentModel[] = [];
  let providers: AgentProvider[] = [];
  let modelSource: ManifestSource = 'none';

  if (plan.modelsArgs) {
    const probe = await runProbe(context.executable, plan.modelsArgs, {
      cwd: context.cwd,
      env,
      timeoutMs: timeouts.models ?? 25_000,
    });
    const parsed = parseModelList(`${probe.stdout}\n${probe.stderr}`, plan.modelPrefix);
    if (parsed.models.length > 0) {
      models = parsed.models;
      providers = parsed.providers;
      modelSource = 'cli';
    } else if (!probe.ok) {
      errors.push(`model list failed${probe.timedOut ? ' (timed out)' : ''}`);
    }
  }

  const config = options.configPath ? readCliConfig(options.configPath) : undefined;
  const current = resolveCurrent(modes, config, models);

  return {
    adapter: {
      id: context.adapterId,
      name: options.adapterName,
      version: options.version,
      executable: context.executable,
    },
    modes,
    models,
    providers,
    capabilities: options.capabilities ?? [],
    current,
    modeModels: buildModeModels(modes, config),
    supportsInteractive: options.supportsInteractive,
    configPath: options.configPath,
    source: modeSource === 'cli' || modelSource === 'cli' ? 'cli' : 'none',
    discoveredAt: new Date().toISOString(),
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

/** Reads a CLI config file, tolerating JSONC comments and a missing file. */
export function readCliConfig(path: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  const withoutComments = raw
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, comment) => (comment ? '' : match))
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    const parsed: unknown = JSON.parse(withoutComments);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function buildModeModels(
  modes: AgentMode[],
  config: Record<string, unknown> | undefined,
): Record<string, { provider: string; model: string }> | undefined {
  if (!config) return undefined;
  const agents = (config.agent ?? {}) as Record<string, { model?: string }>;
  const globalSpec = typeof config.model === 'string' ? config.model : '';
  const out: Record<string, { provider: string; model: string }> = {};

  for (const mode of modes) {
    const spec = agents[mode.id]?.model ?? globalSpec;
    if (typeof spec === 'string' && spec.trim()) {
      out[mode.id] = splitModelSpec(spec);
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function resolveCurrent(
  modes: AgentMode[],
  config: Record<string, unknown> | undefined,
  models: AgentModel[],
): AgentManifest['current'] {
  const first = modes[0];
  const mode =
    (config
      ? ((typeof config.default_agent === 'string' && config.default_agent) ||
         (typeof config.defaultMode === 'string' && config.defaultMode) ||
         '')
      : '') || first?.id || '';

  const agents = (config?.agent ?? {}) as Record<string, { model?: string }>;
  const spec = agents[mode]?.model ?? config?.model;
  if (typeof spec === 'string' && spec.trim()) {
    const { provider, model } = splitModelSpec(spec);
    return { provider, model, mode };
  }

  // A CLI that exposes no model catalog owns its own model choice. Reporting a
  // half-empty "current" would be worse than reporting nothing.
  if (models.length === 0) {
    return mode ? { provider: '', model: '', mode } : undefined;
  }

  const known = models[0]!;
  return { provider: known.providerId, model: known.name ?? known.id, mode };
}

/** Resolves the first PATH directory that actually holds the executable. */
export function pathDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PATH ?? env.Path ?? env.path ?? '').split(delimiter).filter(Boolean);
}
