import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../lib/icons';
import { AdapterIcon } from '../components/AdapterIcon';
import { api } from '../lib/api';
import type { AdapterCapabilities } from '../lib/types';

/** Build CLI slash-commands equivalent to typing /mode and /models in the TUI. */
function buildRuntimeCommands(
  adapterId: string,
  patch: { provider?: string; model?: string; mode?: string },
): string[] {
  const cmds: string[] = [];
  if (patch.mode && adapterId !== 'claude') {
    cmds.push(`/mode ${patch.mode}`);
  }
  if (patch.provider && patch.model) {
    if (adapterId === 'claude') {
      cmds.push(JSON.stringify({ type: 'config', model: `${patch.provider}/${patch.model}`, mode: patch.mode }));
    } else {
      cmds.push(`/models ${patch.provider}/${patch.model}`);
    }
  } else if (patch.mode) {
    if (adapterId === 'claude') {
      cmds.push(JSON.stringify({ type: 'mode', mode: patch.mode }));
    }
  }
  return cmds;
}

export function ModelsPage({ active }: { active: boolean }) {
  const { adapters, sessions, activeProject, showToast, loadSessions } = useStore();
  const [caps, setCaps] = useState<Record<string, AdapterCapabilities | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Record<string, string | null>>({});

  const runningAdapterIds = new Set(
    sessions.filter((s) => s.status === 'running' || s.status === 'starting').map((s) => s.adapterId),
  );
  const activeAdapters = adapters.filter((a) => a.installed && runningAdapterIds.has(a.id));

  useEffect(() => {
    if (!active) return;
    activeAdapters.forEach((a) => loadCaps(a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeProject?.id, ...activeAdapters.map((a) => a.id), ...sessions.map((s) => `${s.adapterId}-${s.status}`)]);

  useEffect(() => {
    if (!active || activeAdapters.length === 0) return;
    const interval = setInterval(() => {
      activeAdapters.forEach((a) => loadCaps(a.id));
    }, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...activeAdapters.map((a) => a.id)]);

  const loadCaps = async (adapterId: string) => {
    setLoading((l) => ({ ...l, [adapterId]: true }));
    setError((e) => ({ ...e, [adapterId]: null }));
    try {
      const data = await api.getCapabilities(adapterId, false);
      setCaps((c) => ({ ...c, [adapterId]: data }));
    } catch (e: any) {
      setError((err) => ({ ...err, [adapterId]: e?.message ?? 'Failed to load capabilities' }));
    } finally {
      setLoading((l) => ({ ...l, [adapterId]: false }));
    }
  };

  const applyChange = async (
    adapterId: string,
    patch: { provider?: string; model?: string; mode?: string },
  ) => {
    if (!activeProject) {
      showToast('No Project', 'Open a project first.', 'warning');
      return;
    }
    setLoading((l) => ({ ...l, [adapterId]: true }));
    try {
      // 1. Persist to adapter config (agent.{mode}.model) — same as /models in CLI
      const updated = await api.saveCapabilities(adapterId, patch);
      setCaps((c) => ({ ...c, [adapterId]: updated }));

      // 2. Notify running session with equivalent slash commands
      const cmds = buildRuntimeCommands(adapterId, patch);
      for (const cmd of cmds) {
        try {
          await api.sendRuntimeCommand(activeProject.id, adapterId, cmd);
        } catch {
          // serve-mode may not accept stdin; config write is the source of truth
        }
      }

      const label =
        patch.provider && patch.model
          ? `${patch.mode ? patch.mode + ': ' : ''}${patch.provider}/${patch.model}`
          : patch.mode ?? 'updated';
      showToast('Model Applied', label, 'success');
      await loadSessions(activeProject.id);
    } catch (e: any) {
      console.error('[UI] Config change error:', e);
      showToast('Failed', e?.message ?? 'Unable to apply model config.', 'error');
    } finally {
      setLoading((l) => ({ ...l, [adapterId]: false }));
    }
  };

  return (
    <div className={`page-content flex-col h-full w-full ${active ? 'active' : ''}`}>
      <div className="h-12 border-b border-app-border flex items-center justify-between px-6 shrink-0 bg-app-bg/50 backdrop-blur">
        <h1 className="font-semibold text-app-textStrong">Agent Model Configuration</h1>
        <span className="text-xs text-app-text border border-app-border px-2 py-0.5 rounded-full bg-app-surface">
          Running CLI Agents
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-app-textStrong">Per-Agent Model Routing</h2>
            <p className="text-sm text-app-text mt-1">
              Each agent mode has its own provider and model — same as running <code className="text-xs bg-app-bg px-1 rounded">/mode</code> then{' '}
              <code className="text-xs bg-app-bg px-1 rounded">/models provider/model</code> in the CLI.
            </p>
          </div>

          {activeAdapters.length === 0 ? (
            <div className="border border-dashed border-app-border rounded-xl p-16 flex flex-col items-center text-center">
              <Icon name="cpu" className="w-8 h-8 text-app-text/40 mb-3" />
              <p className="text-sm text-app-text">No running CLI agents. Start adapters in the Agents page to configure their models.</p>
            </div>
          ) : (
            activeAdapters.map((adapter) => {
              const cap = caps[adapter.id];
              const isLoading = loading[adapter.id];
              const err = error[adapter.id];
              const activeMode = cap?.current.mode ?? '';

              return (
                <div key={adapter.id} className="bg-app-surface border border-app-border rounded-lg overflow-hidden shadow-sm mb-6">
                  <div className="px-5 py-3 border-b border-app-border bg-app-bg/50 flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-app-bg border border-app-border flex items-center justify-center overflow-hidden">
                      <AdapterIcon id={adapter.id} className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-app-textStrong truncate">{adapter.name}</h3>
                      <div className="text-xs text-app-text font-mono truncate">
                        Active: {activeMode || '—'}
                        {cap?.current.provider && cap?.current.model
                          ? ` • ${cap.current.provider}/${cap.current.model}`
                          : ''}
                      </div>
                    </div>
                    {isLoading && <Icon name="loader-2" className="w-4 h-4 animate-spin text-app-text" />}
                  </div>
                  {err && (
                    <div className="px-5 py-2 text-xs text-app-danger border-b border-app-border bg-app-danger/5">{err}</div>
                  )}
                  <div className="p-4">
                    <label className="block text-[10px] uppercase tracking-wider text-app-text mb-2 font-semibold">
                      Agent Modes
                    </label>
                    <div className="border border-app-border rounded overflow-hidden bg-app-bg divide-y divide-app-border">
                      {(cap?.modes ?? []).length === 0 ? (
                        <div className="px-3 py-2 text-xs text-app-text">No agents detected</div>
                      ) : (
                        (cap?.modes ?? []).map((m) => {
                          const modeCfg = cap?.modeModels?.[m.id] ?? cap?.current ?? { provider: '', model: '' };
                          const isActive = activeMode === m.id;
                          const modelsForProvider = cap?.models?.[modeCfg.provider] ?? [];

                          return (
                            <div
                              key={m.id}
                              className={`${isActive ? 'bg-app-primary/5' : ''}`}
                            >
                              <button
                                type="button"
                                disabled={isLoading}
                                onClick={() => applyChange(adapter.id, { mode: m.id })}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors disabled:opacity-50 hover:bg-app-hover/50"
                              >
                                <span
                                  className={`w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center ${
                                    isActive ? 'border-app-primary' : 'border-app-border'
                                  }`}
                                >
                                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-app-primary" />}
                                </span>
                                <span className={`font-medium ${isActive ? 'text-app-primary' : 'text-app-textStrong'}`}>
                                  {m.name}
                                </span>
                                {modeCfg.provider && modeCfg.model && (
                                  <span className="ml-auto text-[11px] font-mono text-app-text truncate max-w-[45%]">
                                    {modeCfg.provider}/{modeCfg.model}
                                  </span>
                                )}
                              </button>
                              <div className="px-3 pb-3 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] uppercase tracking-wider text-app-text mb-1 font-semibold">
                                    Provider
                                  </label>
                                  <select
                                    value={modeCfg.provider}
                                    disabled={isLoading}
                                    onChange={(e) => {
                                      const provider = e.target.value;
                                      const model = cap?.models?.[provider]?.[0] ?? modeCfg.model;
                                      applyChange(adapter.id, { mode: m.id, provider, model });
                                    }}
                                    className="w-full bg-app-surface border border-app-border rounded px-2.5 py-1.5 text-xs text-app-textStrong focus:outline-none focus:border-app-primary disabled:opacity-50"
                                  >
                                    <option value="">-- select --</option>
                                    {(cap?.providers ?? []).map((p) => (
                                      <option key={p} value={p}>
                                        {p}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[10px] uppercase tracking-wider text-app-text mb-1 font-semibold">
                                    Model
                                  </label>
                                  <select
                                    value={modeCfg.model}
                                    disabled={isLoading || !modeCfg.provider}
                                    onChange={(e) =>
                                      applyChange(adapter.id, {
                                        mode: m.id,
                                        provider: modeCfg.provider,
                                        model: e.target.value,
                                      })
                                    }
                                    className="w-full bg-app-surface border border-app-border rounded px-2.5 py-1.5 text-xs text-app-textStrong focus:outline-none focus:border-app-primary disabled:opacity-50"
                                  >
                                    <option value="">-- select --</option>
                                    {modelsForProvider.map((model) => (
                                      <option key={model} value={model}>
                                        {model}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    {cap?.configPath && (
                      <div className="text-[11px] text-app-text/70 font-mono truncate mt-3">
                        Config: {cap.configPath}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
