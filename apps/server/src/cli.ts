// Dynamic CLI probing + config read/write.
// All executables resolved via PATH scan (findExecutable) and config paths from
// homedir() so this works on any machine regardless of install location.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { adapterCommand, detectOS, findExecutable, runExecutable, type Platform } from '@opencli/discovery';

export interface Mode {
  id: string;
  name: string;
}

export interface ModeModelConfig {
  provider: string;
  model: string;
}

export interface AdapterCapabilities {
  modes: Mode[];
  providers: string[];
  models: Record<string, string[]>;
  /** Per-agent mode model routing (from config agent.{mode}.model). */
  modeModels: Record<string, ModeModelConfig>;
  current: {
    provider: string;
    model: string;
    mode: string;
  };
  configPath?: string;
}

function isAdapterInstalled(adapterId: string): boolean {
  const cmd = adapterCommand(adapterId);
  if (!cmd) return false;
  if (findExecutable(cmd)) return true;
  return adapterId === 'kilocode' && !!findExecutable('kilocode');
}

function homeConfigDir(platform: Platform, folder: string): string {
  if (platform === 'win32') {
    // On Windows, dot-folder under %USERPROFILE% still works for these CLIs.
    return join(homedir(), folder);
  }
  return join(homedir(), folder);
}

function opencodeConfigPath(): string {
  const candidates = ['.config/opencode/opencode.json', '.config/opencode/opencode.jsonc'];
  for (const c of candidates) {
    const p = join(homedir(), c);
    if (existsSync(p)) return p;
  }
  return join(homedir(), '.config/opencode/opencode.json');
}

function kiloConfigPath(): string {
  const candidates = ['.config/kilo/kilo.json', '.config/kilo/kilo.jsonc', '.config/kilo/opencode.json'];
  for (const c of candidates) {
    const p = join(homedir(), c);
    if (existsSync(p)) return p;
  }
  return join(homedir(), '.config/kilo/kilo.json');
}

function claudeConfigPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

async function runCli(args: string[], timeoutMs = 20000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const result = await runExecutable(args[0], args.slice(1), { timeout: timeoutMs });
  return { stdout: result.stdout, stderr: result.stderr, code: result.exitCode };
}

function parseModelLine(line: string): { provider: string; model: string } | null {
  const t = line.trim();
  if (!t) return null;
  // kilo format: "kilo/~anthropic/claude-fable-latest" or "kilo/~openai/model"
  if (t.startsWith('kilo/')) {
    const rest = t.slice('kilo/'.length);
    const idx = rest.indexOf('/');
    if (idx <= 0) return null;
    const provider = rest.slice(0, idx);
    const model = rest.slice(idx + 1);
    if (!provider || !model) return null;
    return { provider, model };
  }
  // opencode format: "provider/model"
  const idx = t.indexOf('/');
  if (idx <= 0) return null;
  const provider = t.slice(0, idx);
  const model = t.slice(idx + 1);
  if (!provider || !model) return null;
  return { provider, model };
}

function splitModelSpec(spec: string): { provider: string; model: string } | null {
  const t = (spec ?? '').trim();
  if (!t) return null;
  const idx = t.indexOf('/');
  if (idx <= 0) return { provider: 'default', model: t };
  return { provider: t.slice(0, idx), model: t.slice(idx + 1) };
}

// --- probing ---

const CAPABILITY_CACHE = new Map<string, { at: number; data: AdapterCapabilities }>();
const CAPABILITY_TTL_MS = 30_000;
const MODE_CACHE = new Map<string, { at: number; modes: Mode[] }>();
const MODE_TTL_MS = 300_000; // agent list is slow — cache modes for 5 min

/** Internal/utility agents — not user-selectable modes. */
const INTERNAL_AGENTS = new Set(['compaction', 'summary', 'title', 'explore', 'general', 'explorer']);

function parseAgentList(stdout: string): Mode[] {
  const modes: Mode[] = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([\w.-]+)\s*\((primary|subagent)\)\s*$/);
    if (!match) continue;
    const [, name, kind] = match;
    if (kind !== 'primary') continue;
    if (INTERNAL_AGENTS.has(name.toLowerCase())) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    modes.push({ id: name, name });
  }
  return modes;
}

function parseClaudePermissionModes(helpText: string): Mode[] {
  const idx = helpText.indexOf('--permission-mode');
  if (idx < 0) return [{ id: 'default', name: 'default' }];
  const slice = helpText.slice(idx, idx + 600);
  const choicesMatch = slice.match(/choices:\s*([\s\S]*?)\)/);
  if (!choicesMatch) return [{ id: 'default', name: 'default' }];
  const modes = [...choicesMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (modes.length === 0) return [{ id: 'default', name: 'default' }];
  return modes.map((m) => ({ id: m, name: m }));
}

async function probeModelList(adapterId: string): Promise<{ providers: string[]; models: Record<string, string[]> }> {
  if (adapterId === 'claude') {
    const providers = ['anthropic'];
    const models = {
      anthropic: [
        'claude-sonnet-4-5',
        'claude-sonnet-4-1',
        'claude-opus-4-1',
        'claude-haiku-4-5',
        'claude-fable-5',
        'claude-sonnet-latest',
        'claude-opus-latest',
        'claude-haiku-latest',
        'sonnet',
        'opus',
        'haiku',
      ],
    };
    return { providers, models };
  }

  const cmd = adapterCommand(adapterId);
  if (!cmd || !isAdapterInstalled(adapterId)) return { providers: [], models: {} };
  const res = await runCli([cmd, 'models']);

  const providers = new Set<string>();
  const models: Record<string, string[]> = {};
  for (const rawLine of res.stdout.split(/\r?\n/)) {
    const parsed = parseModelLine(rawLine);
    if (!parsed) continue;
    providers.add(parsed.provider);
    (models[parsed.provider] ??= []).push(parsed.model);
  }
  if (providers.size === 0) {
    // Fallback: default set if CLI doesn't support the command.
    return { providers: ['default'], models: { default: ['auto', 'fast', 'pro'] } };
  }
  const order = Array.from(providers);
  return { providers: order, models };
}

async function probeModes(adapterId: string, force = false): Promise<Mode[]> {
  const cached = MODE_CACHE.get(adapterId);
  if (!force && cached && Date.now() - cached.at < MODE_TTL_MS) return cached.modes;

  let modes: Mode[];

  if (adapterId === 'claude') {
    if (!isAdapterInstalled('claude')) {
      modes = [{ id: 'default', name: 'default' }];
    } else {
      const res = await runCli(['claude', '--help'], 15_000);
      modes = parseClaudePermissionModes(res.stdout + res.stderr);
    }
  } else {
    const cmd = adapterCommand(adapterId);
    if (!cmd || !isAdapterInstalled(adapterId)) {
      modes = [{ id: 'default', name: 'default' }];
    } else {
      const res = await runCli([cmd, 'agent', 'list'], 90_000);
      modes = parseAgentList(res.stdout);
      if (modes.length === 0) modes = [{ id: 'default', name: 'default' }];
    }
  }

  MODE_CACHE.set(adapterId, { at: Date.now(), modes });
  return modes;
}

function readConfigFile(adapterId: string): { path?: string; cfg: Record<string, unknown> } {
  try {
    const p =
      adapterId === 'claude' ? claudeConfigPath() : adapterId === 'opencode' ? opencodeConfigPath() : kiloConfigPath();
    if (!existsSync(p)) return { cfg: {} };
    return { path: p, cfg: JSON.parse(readFileSync(p, 'utf-8')) };
  } catch {
    return { cfg: {} };
  }
}

function readClaudeModel(cfg: Record<string, unknown>): ModeModelConfig {
  const env = (cfg.env ?? {}) as Record<string, string>;
  const model =
    env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    env.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
    env.ANTHROPIC_MODEL ||
    String(cfg.model ?? 'claude-sonnet-4-5');
  return { provider: 'anthropic', model };
}

function readModeModelsFromConfig(
  adapterId: string,
  modes: Mode[],
  cfg: Record<string, unknown>,
): Record<string, ModeModelConfig> {
  const global =
    adapterId === 'claude'
      ? readClaudeModel(cfg)
      : (splitModelSpec(String(cfg.model ?? '')) ?? { provider: 'default', model: 'auto' });

  const agents = (cfg.agent ?? {}) as Record<string, { model?: string }>;
  const out: Record<string, ModeModelConfig> = {};
  for (const mode of modes) {
    if (adapterId === 'claude') {
      out[mode.id] = { ...global };
      continue;
    }
    const spec = agents[mode.id]?.model ?? cfg.model;
    out[mode.id] = splitModelSpec(String(spec ?? '')) ?? { ...global };
  }
  return out;
}

function readCurrentFromConfig(
  adapterId: string,
  modes: Mode[],
): { provider: string; model: string; mode: string; configPath?: string; modeModels: Record<string, ModeModelConfig> } {
  const { path, cfg } = readConfigFile(adapterId);
  const modeModels = readModeModelsFromConfig(adapterId, modes, cfg);
  // OpenCode uses default_agent for the selected primary agent.
  // A legacy top-level string "mode" is invalid in current OpenCode config schema.
  const activeMode = String(
    adapterId === 'opencode'
      ? (cfg.default_agent ?? modes[0]?.id ?? 'default')
      : (cfg.defaultMode ?? modes[0]?.id ?? 'default'),
  );
  const active = modeModels[activeMode] ?? Object.values(modeModels)[0] ?? { provider: 'default', model: 'auto' };
  return {
    provider: active.provider,
    model: active.model,
    mode: activeMode,
    configPath: path,
    modeModels,
  };
}

export async function probeCapabilities(
  adapterId: string,
  force = false,
  modesOverride?: Mode[],
): Promise<AdapterCapabilities> {
  const cached = CAPABILITY_CACHE.get(adapterId);
  if (!modesOverride && !force && cached && Date.now() - cached.at < CAPABILITY_TTL_MS) return cached.data;

  const modes = modesOverride ?? (await probeModes(adapterId, force));
  const [{ providers, models }, current] = await Promise.all([
    probeModelList(adapterId),
    Promise.resolve(readCurrentFromConfig(adapterId, modes)),
  ]);

  // Make sure current provider/model exist in the list; if not, seed them.
  const mergedModels = { ...models };
  for (const mm of Object.values(current.modeModels)) {
    if (!mergedModels[mm.provider]) mergedModels[mm.provider] = [mm.model];
    else if (!mergedModels[mm.provider].includes(mm.model)) {
      mergedModels[mm.provider] = [mm.model, ...mergedModels[mm.provider]];
    }
  }
  const mergedProviders = new Set(providers);
  for (const mm of Object.values(current.modeModels)) mergedProviders.add(mm.provider);

  const data: AdapterCapabilities = {
    modes,
    providers: Array.from(mergedProviders),
    models: mergedModels,
    modeModels: current.modeModels,
    current: {
      provider: current.provider,
      model: current.model,
      mode: current.mode,
    },
    configPath: current.configPath,
  };
  CAPABILITY_CACHE.set(adapterId, { at: Date.now(), data });
  return data;
}

export function invalidateCapability(adapterId: string): void {
  CAPABILITY_CACHE.delete(adapterId);
  MODE_CACHE.delete(adapterId);
}

// --- config write ---

interface WritePatch {
  provider?: string;
  model?: string;
  mode?: string;
}

function resolveConfigTarget(adapterId: string): { path: string; format: 'json' } {
  if (adapterId === 'claude') return { path: claudeConfigPath(), format: 'json' };
  if (adapterId === 'opencode') return { path: opencodeConfigPath(), format: 'json' };
  return { path: kiloConfigPath(), format: 'json' };
}

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export async function writeCapabilityConfig(adapterId: string, patch: WritePatch): Promise<AdapterCapabilities | null> {
  if (!isAdapterInstalled(adapterId)) return null;

  const { path, format } = resolveConfigTarget(adapterId);
  ensureDir(path);

  let cfg: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      cfg = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      cfg = {};
    }
  }

  if (adapterId === 'claude') {
    const env = { ...(typeof cfg.env === 'object' && cfg.env ? (cfg.env as Record<string, string>) : {}) };
    if (patch.model) env.ANTHROPIC_DEFAULT_SONNET_MODEL = patch.model;
    if (patch.mode) {
      if (patch.mode !== 'default') cfg.defaultMode = patch.mode;
      else delete cfg.defaultMode;
    }
    cfg.env = env;
  } else {
    const agents = (typeof cfg.agent === 'object' && cfg.agent ? cfg.agent : {}) as Record<
      string,
      Record<string, unknown>
    >;
    const spec =
      patch.provider && patch.model
        ? `${patch.provider}/${patch.model}`
        : patch.model
          ? patch.model
          : undefined;

    if (patch.mode && spec) {
      agents[patch.mode] = { ...(agents[patch.mode] ?? {}), model: spec };
      cfg.agent = agents;
      cfg.mode = patch.mode;
    } else if (spec) {
      const activeMode = String(patch.mode ?? cfg.mode ?? '');
      if (activeMode) {
        agents[activeMode] = { ...(agents[activeMode] ?? {}), model: spec };
        cfg.agent = agents;
      } else {
        cfg.model = spec;
      }
    } else if (patch.mode) {
      cfg.mode = patch.mode;
    }
  }

  writeFileSync(path, format === 'json' ? JSON.stringify(cfg, null, 2) : JSON.stringify(cfg, null, 2));
  console.log(`[CLI] Config written for ${adapterId}:`, patch);
  invalidateCapability(adapterId);
  return probeCapabilities(adapterId, true);
}