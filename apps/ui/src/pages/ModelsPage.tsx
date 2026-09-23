import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../lib/icons';
import { AdapterIcon } from '../components/AdapterIcon';
import { api } from '../lib/api';
import type { AdapterCapabilities } from '../lib/types';

type RuntimeRouting = Record<string, Record<string, { provider: string; model: string }>>;

export function ModelsPage({ active }: { active: boolean }) {
  const { adapters, sessions, activeProject, showToast, loadSessions, setSessions } = useStore();
  const [caps, setCaps] = useState<Record<string, AdapterCapabilities | null>>({});
  const [routing, setRouting] = useState<RuntimeRouting>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Record<string, string | null>>({});

  const activeAdapters = adapters.filter(
    (a) => a.installed && a.active && sessions.some((s) => s.adapterId === a.id && s.status === 'running'),
  );

  useEffect(() => {
    if (!active || !activeProject) return;
    api.getModelRouting(activeProject.id)
      .then(setRouting)
      .catch((e: any) => showToast('Routing Load Failed', e?.message ?? 'Unable to load runtime model routing.', 'error'));
  }, [active, activeProject?.id, showToast]);

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
      const data = activeProject
        ? await api.getProjectAdapterCapabilities(activeProject.id, adapterId)
        : await api.getCapabilities(adapterId, false);
      setCaps((c) => ({ ...c, [adapterId]: data }));
    } catch (e: any) {
      setError((err) => ({ ...err, [adapterId]: e?.message ?? 'Failed to load capabilities' }));
    } finally {
      setLoading((l) => ({ ...l, [adapterId]: false }));
    }
  };

  const activateMode = async (adapterId: string, modeId: string) => {
    if (!activeProject) return;
    setLoading((l) => ({ ...l, [adapterId]: true }));
    try {
      await api.setSessionMode(activeProject.id, adapterId, modeId);
      await loadSessions(activeProject.id);
      showToast('Mode Switched', `${adapterId} is now using ${modeId}.`, 'success');
    } catch (e: any) {
      showToast('Mode Switch Failed', e?.message ?? 'Unable to switch the running session mode.', 'error');
    } finally {
      setLoading((l) => ({ ...l, [adapterId]: false }));
    }
  };

  const applyModelRouting = async (
    adapterId: string,
    modeId: string,
    provider: string,
    model: string,
  ) => {
    if (!activeProject) {
      showToast('No Project', 'Open a project first.', 'warning');
      return;
    }

    setLoading((l) => ({ ...l, [adapterId]: true }));
    try {
      const result = await api.setModelRouting(activeProject.id, adapterId, modeId, provider, model);
      setRouting((current) => ({
        ...current,
        [adapterId]: {
          ...(current[adapterId] ?? {}),
          [modeId]: { provider, model },
        },
      }));
      setSessions(sessions.map((session) =>
        session.adapterId === adapterId
          ? { ...session, activeProvider: provider, activeModel: model }
          : session,
      ));

      if (result.applied) {
        showToast('Model Applied', `${modeId}: ${provider}/${model} is active in the running session.`, 'success');
      } else if (result.applyError) {
        showToast(
          'Routing Saved',
          `${modeId}: ${provider}/${model} saved. Live session was not changed: ${result.applyError}`,
          'warning',
        );
      } else {
        showToast('Routing Saved', `${modeId}: ${provider}/${model} will be used for that mode.`, 'success');
      }
    } catch (e: any) {
      showToast('Model Change Failed', e?.message ?? 'Unable to update runtime model routing.', 'error');
    } finally {
      setLoading((l) => ({ ...l, [adapterId]: false }));
    }
  };

  return (
    <div className={`page-content flex-col h-full w-full ${active ? 'active' : ''}`}>
      <div className="h-12 border-b border-app-border flex items-center justify-between px-6 shrink-0 bg-app-bg/50 backdrop-blur">
        <h1 className="font-semibold text-app-textStrong">Adapter Model Configuration</h1>
        <span className="text-xs text-app-text border border-app-border px-2 py-0.5 rounded-full bg-app-surface">
          Installed Adapters
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-app-textStrong">Per-Adapter Model Routing</h2>
            <p className="text-sm text-app-text mt-1">
              Each agent mode has its own provider and model — same as running <code className="text-xs bg-app-bg px-1 rounded">/mode</code> then{' '}
              <code className="text-xs bg-app-bg px-1 rounded">/models provider/model</code> in the CLI.
            </p>
          </div>

          {activeAdapters.length === 0 ? (
            <div className="border border-dashed border-app-border rounded-xl p-16 flex flex-col items-center text-center">
              <Icon name="cpu" className="w-8 h-8 text-app-text/40 mb-3" />
              <p className="text-sm text-app-text">No active adapters. Activate an adapter in the Adapters page to configure its models.</p>
            </div>
          ) : (
            activeAdapters.map((adapter) => {
              const cap = caps[adapter.id];
              const isLoading = loading[adapter.id];
              const err = error[adapter.id];
              const session = sessions.find((s) => s.adapterId === adapter.id && (s.status === 'running' || s.status === 'starting'));
              const activeMode = session?.activeMode ?? cap?.current.mode ?? '';
              const activeProvider = session?.activeProvider ?? cap?.current.provider ?? '';
              const activeModel = session?.activeModel ?? cap?.current.model ?? '';
              const sessionRunning = session?.status === 'running' || session?.status === 'starting';

              return (
                <div key={adapter.id} className="bg-app-surface border border-app-border rounded-lg overflow-hidden shadow-sm mb-6">
                  <div className="px-5 py-3 border-b border-app-border bg-app-bg/50 flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-app-bg border border-app-border flex items-center justify-center overflow-hidden">
                      <AdapterIcon id={adapter.id} className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-app-textStrong truncate">{adapter.name}</h3>
                      <div className="text-xs text-app-text font-mono truncate">
                        {sessionRunning ? `Active: ${activeMode || '—'}` : 'Session not running'}
                        {activeProvider && activeModel ? ` • ${activeProvider}/${activeModel}` : ''}
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
                        <div className="px-3 py-2 text-xs text-app-text">No modes detected</div>
                      ) : (
                        (cap?.modes ?? []).map((m) => {
                          const modeCfg = routing[adapter.id]?.[m.id] ?? cap?.modeModels?.[m.id] ?? cap?.current ?? { provider: '', model: '' };
                          const isActive = activeMode === m.id;
                          const modelsForProvider = cap?.models?.[modeCfg.provider] ?? [];

                          return (
                            <div
                              key={m.id}
                              className={`${isActive ? 'bg-app-primary/5' : ''}`}
                            >
                              <button
                                type="button"
                                disabled={isLoading || !sessionRunning}
                                onClick={() => activateMode(adapter.id, m.id)}
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
                                      if (provider && model) applyModelRouting(adapter.id, m.id, provider, model);
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
                                      modeCfg.provider && e.target.value
                                        ? applyModelRouting(adapter.id, m.id, modeCfg.provider, e.target.value)
                                        : undefined
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
                    <div className="text-[11px] text-app-text/70 mt-3">
                      Provider/model selection is an OpenCLI runtime override; adapter config remains unchanged.
                    </div>
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
