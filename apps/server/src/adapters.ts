// Single owner of adapter instances for the server.
//
// Every consumer (capability probing, manifest routes, session launch, PTY
// hosting) resolves adapters from here so that an adapter is constructed once
// and its detected executable path is shared.
import { AdapterRegistry, type AgentAdapter } from '@opencli/adapter';
import { OpenCodeAdapter } from '@opencli/adapter-opencode';
import { KiloCodeAdapter } from '@opencli/adapter-kilocode';
import { ClaudeAdapter } from '@opencli/adapter-claude';

export const adapterRegistry = new AdapterRegistry();

adapterRegistry.register(new OpenCodeAdapter());
adapterRegistry.register(new KiloCodeAdapter());
adapterRegistry.register(new ClaudeAdapter());

export function getAdapter(adapterId: string): AgentAdapter | undefined {
  return adapterRegistry.get(adapterId);
}

export function allAdapters(): AgentAdapter[] {
  return adapterRegistry.list();
}

/** Adapters that expose a `setExecutablePath` hook for resolved binaries. */
export type SettableAdapter = AgentAdapter & { setExecutablePath(path: string): void };

export function setAdapterExecutable(adapterId: string, path: string): void {
  const adapter = getAdapter(adapterId) as SettableAdapter | undefined;
  adapter?.setExecutablePath?.(path);
}
