// Adapter capability resolution, driven entirely by live CLI discovery.
//
// There is deliberately no per-adapter knowledge in this file: modes, providers
// and models all come from `AgentAdapter.discover()`. A CLI that exposes no
// model catalog (Claude) reports zero models instead of a fabricated list, and a
// CLI that exposes no mode list reports zero modes.
import { findExecutable, adapterCommand } from '@opencli/discovery';
import type { AgentManifest, AgentMode, AgentModel } from '@opencli/domain';
import { getAdapter, setAdapterExecutable } from './adapters.js';

export interface Mode {
  id: string;
  name: string;
  type?: 'primary' | 'subagent';
  description?: string;
  source?: string;
}

export interface ModeModelConfig {
  provider: string;
  model: string;
  /** Exact spec to send back to the CLI, when it differs from provider/model. */
  spec?: string;
}

export interface AdapterCapabilities {
  /** User-selectable primary agents, as reported by the CLI. */
  modes: Mode[];
  /** Secondary agents the CLI exposes, for orchestration UIs. */
  subagents: Mode[];
  providers: string[];
  models: Record<string, string[]>;
  /** Per-mode model routing (from the CLI's own config). */
  modeModels: Record<string, ModeModelConfig>;
  current: {
    provider: string;
    model: string;
    mode: string;
  };
  configPath?: string;
  /** How the data above was obtained, and when. */
  source?: string;
  discoveredAt?: string;
  supportsInteractive?: boolean;
  /** Non-fatal problems encountered while probing. */
  warnings?: string[];
}

function isAdapterInstalled(adapterId: string): boolean {
  const cmd = adapterCommand(adapterId);
  if (!cmd) return false;
  if (findExecutable(cmd)) return true;
  return adapterId === 'kilocode' && !!findExecutable('kilocode');
}

/**
 * Resolve the CLI binary for an adapter.
 *
 * PATH resolution only; the adapter's own `discover()` remains authoritative for
 * config paths and catalogs.
 */
function resolveExecutable(adapterId: string): string | undefined {
  const cmd = adapterCommand(adapterId);
  if (!cmd) return undefined;
  const direct = findExecutable(cmd);
  if (direct) return direct;
  if (adapterId === 'kilocode') {
    const alt = findExecutable('kilocode');
    if (alt) return alt;
  }
  return undefined;
}

// --- manifest cache ---
//
// Discovery spawns real CLI processes (Kilo's catalog alone takes ~11s), so
// manifests are cached. The TTL is long because catalogs change rarely; `force`
// bypasses it when the user explicitly refreshes.

interface CacheEntry<T> {
  at: number;
  data: T;
}

const MANIFEST_CACHE = new Map<string, CacheEntry<AgentManifest>>();
const MANIFEST_TTL_MS = 5 * 60_000;

export function invalidateCapability(adapterId: string): void {
  MANIFEST_CACHE.delete(adapterId);
}

export function invalidateAllCapabilities(): void {
  MANIFEST_CACHE.clear();
}

/**
 * Live manifest for an adapter, from cache unless forced.
 *
 * Returns undefined when the adapter is unknown or its CLI is not installed.
 */
export async function getManifest(
  adapterId: string,
  force = false,
  workspacePath = process.cwd(),
): Promise<AgentManifest | undefined> {
  const adapter = getAdapter(adapterId);
  if (!adapter) return undefined;

  const cached = MANIFEST_CACHE.get(adapterId);
  if (!force && cached && Date.now() - cached.at < MANIFEST_TTL_MS) {
    return cached.data;
  }

  const executable = resolveExecutable(adapterId);
  if (!executable) return undefined;
  setAdapterExecutable(adapterId, executable);

  let manifest: AgentManifest;
  try {
    manifest = await adapter.discover({
      projectPath: workspacePath,
      workspacePath,
      environment: {},
    });
  } catch (err) {
    // A failed probe must not take down the route; report it as an empty
    // manifest so the UI can show the adapter with no data instead of erroring.
    manifest = {
      adapter: {
        id: adapterId,
        name: adapter.name(),
        version: '',
        executable: executable,
        installed: true,
      },
      modes: [],
      models: [],
      providers: [],
      capabilities: [],
      source: 'none',
      discoveredAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  MANIFEST_CACHE.set(adapterId, { at: Date.now(), data: manifest });
  return manifest;
}

function toMode(mode: AgentMode): Mode {
  return {
    id: mode.id,
    name: mode.name,
    type: mode.type ?? 'primary',
    description: mode.description,
    source: mode.source,
  };
}

/**
 * Model routing for each mode, taken from the CLI config the adapter read.
 *
 * Modes the CLI did not configure are left absent rather than being given an
 * invented default, so the UI can distinguish "unset" from "set".
 */
function modeModelsFrom(manifest: AgentManifest): Record<string, ModeModelConfig> {
  const out: Record<string, ModeModelConfig> = {};
  const source = manifest.modeModels ?? {};
  for (const [mode, value] of Object.entries(source)) {
    out[mode] = { provider: value.provider, model: value.model };
  }
  for (const mode of manifest.modes) {
    if (out[mode.id]) continue;
    const spec = manifest.current?.mode === mode.id ? manifest.current : undefined;
    if (spec && spec.model) {
      out[mode.id] = { provider: spec.provider, model: spec.model };
    }
  }
  return out;
}

/** Groups models by provider, keeping the CLI's ordering. */
function groupModels(models: AgentModel[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const model of models) {
    const bucket = grouped[model.providerId];
    const name = model.name ?? model.id;
    if (bucket) bucket.push(name);
    else grouped[model.providerId] = [name];
  }
  return grouped;
}

/** Exact CLI spec for a provider/name pair, so commands round-trip exactly. */
function specIndex(models: AgentModel[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const model of models) {
    index.set(`${model.providerId}/${model.name ?? model.id}`, model.id);
  }
  return index;
}

export async function probeCapabilities(
  adapterId: string,
  force = false,
  modesOverride?: Mode[],
): Promise<AdapterCapabilities> {
  const manifest = await getManifest(adapterId, force);
  if (!manifest) {
    return {
      modes: [],
      subagents: [],
      providers: [],
      models: {},
      modeModels: {},
      current: { provider: '', model: '', mode: '' },
      source: 'none',
    };
  }

  const allModes = manifest.modes.map(toMode);
  const modes = modesOverride?.length
    ? modesOverride
    : allModes.filter((mode) => (mode.type ?? 'primary') === 'primary');
  const subagents = allModes.filter((mode) => mode.type === 'subagent');

  const models = groupModels(manifest.models);
  const providers = manifest.providers.length
    ? manifest.providers.map((provider) => provider.id)
    : Object.keys(models);

  const specs = specIndex(manifest.models);
  const modeModels: Record<string, ModeModelConfig> = {};
  for (const [mode, value] of Object.entries(modeModelsFrom(manifest))) {
    modeModels[mode] = {
      provider: value.provider,
      model: value.model,
      spec: specs.get(`${value.provider}/${value.model}`),
    };
  }

  return {
    modes,
    subagents,
    providers,
    models,
    modeModels,
    current: {
      provider: manifest.current?.provider ?? '',
      model: manifest.current?.model ?? '',
      mode: manifest.current?.mode ?? modes[0]?.id ?? '',
    },
    configPath: manifest.configPath,
    source: manifest.source,
    discoveredAt: manifest.discoveredAt,
    supportsInteractive: manifest.supportsInteractive,
    warnings: manifest.error ? [manifest.error] : undefined,
  };
}
