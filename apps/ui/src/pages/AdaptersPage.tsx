import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../lib/icons';
import { AdapterIcon } from '../components/AdapterIcon';
import { api } from '../lib/api';

export function AdaptersPage({ active }: { active: boolean }) {
  const { adapters, loadAdapters, sessions, activeProject, showToast, setSessions, setAdapterActive } = useStore();
  const [installAdapterId, setInstallAdapterId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const adapter = installAdapterId ? adapters.find((a) => a.id === installAdapterId) ?? null : null;

  const runningIds = new Set(sessions.filter((s) => s.status === 'running').map((s) => s.adapterId));
  const failedByAdapter = Object.fromEntries(
    sessions.filter((s) => s.status === 'failed').map((s) => [s.adapterId, s.error ?? s.command ?? 'Failed to start']),
  );
  const projectMissing = activeProject?.pathExists === false;

  const toggleActive = async (id: string, currentActive: boolean) => {
    if (!activeProject) {
      showToast('No Project', 'Open a project first to start/stop adapters.', 'warning');
      return;
    }
    const adapter = adapters.find((a) => a.id === id);
    if (!adapter?.installed) {
      showToast('Not Installed', 'Install the adapter before activating it.', 'warning');
      return;
    }
    setBusyId(id);
    try {
      if (!currentActive) {
        // Activation is explicit and persisted so other pages (Models/Providers)
        // can show only adapters selected by the user.
        console.log(`[UI] Starting ${adapter.name}...`);
        const session = await api.startSession(activeProject.id, id, adapter.name);
        console.log('[UI] Session started:', session);
        if (session.status === 'running') {
          await setAdapterActive(id, true);
          showToast('CLI Agent Started', `${session.command ?? adapter.name} running (PID: ${session.pid || 'unknown'}).`, 'success');
        } else {
          await setAdapterActive(id, false);
          showToast('Start Failed', session.error ?? `${adapter.name} failed to start.`, 'error');
        }
      } else {
        console.log(`[UI] Stopping ${adapter.name}...`);
        await api.stopSession(activeProject.id, id);
        await setAdapterActive(id, false);
        showToast('CLI Agent Stopped', `${adapter.name} has been stopped.`, 'info');
      }
      // Reload sessions to get updated status
      await loadSessionsFor(activeProject.id);
    } catch (e: any) {
      if (!currentActive) {
        await setAdapterActive(id, false).catch(() => undefined);
      }
      console.error('[UI] Toggle error:', e);
      showToast('Failed', e?.message ?? 'Unable to change adapter state.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (active && activeProject) {
      loadSessionsFor(activeProject.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeProject?.id]);

  // Auto-refresh sessions secara periodik untuk status real-time
  useEffect(() => {
    if (!active || !activeProject) return;

    const interval = setInterval(() => {
      loadSessionsFor(activeProject.id);
    }, 2000); // Refresh setiap 2 detik untuk response lebih cepat

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeProject?.id]);

  const loadSessionsFor = async (projectId: string) => {
    try {
      const list = await api.listSessions(projectId);
      setSessions(list);
    } catch {
      // ignore
    }
  };

  return (
    <div className={`page-content flex-col h-full w-full ${active ? 'active' : ''}`}>
      <div className="h-12 border-b border-app-border flex items-center justify-between px-6 shrink-0 bg-app-bg/50 backdrop-blur">
        <h1 className="font-semibold text-app-textStrong">Adapter Control</h1>
        <button
          onClick={async () => {
            await loadAdapters();
            if (activeProject) await loadSessionsFor(activeProject.id);
            showToast('Refreshed', 'Adapter detection re-scanned.', 'success');
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-app-hover text-app-textStrong hover:bg-app-border transition-colors"
        >
          <Icon name="refresh-cw" className="w-3.5 h-3.5" /> Rescan
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          {projectMissing && activeProject && (
            <div className="mb-4 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-200">
              <span className="font-medium">Project folder not found:</span>{' '}
              <span className="font-mono text-xs">{activeProject.path}</span>
              <p className="text-xs text-amber-200/80 mt-1">
                Buat folder ini atau buka project dengan path yang valid sebelum menjalankan adapter.
              </p>
            </div>
          )}
          {adapters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Icon name="cpu" className="w-10 h-10 text-app-text/40 mb-3" />
              <p className="text-sm text-app-text">No adapter data available. Start OpenCLI server and open a project.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {adapters.map((adapter) => {
                const isRunning = runningIds.has(adapter.id);
                const isBusy = busyId === adapter.id;
                const failedError = failedByAdapter[adapter.id];
                const runCmd =
                  adapter.id === 'claude'
                    ? 'claude'
                    : adapter.id === 'kilocode'
                      ? 'kilo serve --port 0'
                      : adapter.id === 'opencode'
                        ? 'opencode serve --port 0'
                        : adapter.executable;
                return (
                  <div
                    key={adapter.id}
                    className={`adapter-card bg-app-surface border rounded-lg p-5 flex flex-col transition-colors ${
                      isBusy
                        ? 'adapter-card-shimmer border-app-primary/40'
                        : isRunning
                          ? 'border-app-border hover:border-[#3f3f46]'
                          : 'border-app-border opacity-70'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded bg-app-bg border border-app-border flex items-center justify-center overflow-hidden">
                          <AdapterIcon id={adapter.id} className="w-7 h-7" />
                        </div>
                        <div>
                          <h3 className="font-medium text-app-textStrong">{adapter.name}</h3>
                          <p className="text-xs text-app-text font-mono">
                            ID: {adapter.id}
                            {adapter.installed && adapter.version ? ` • v${adapter.version}` : ' • not installed'}
                          </p>
                        </div>
                      </div>
                      {isBusy ? (
                        <span className="flex items-center text-indigo-300 text-xs font-medium bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20">
                          <Icon name="loader-2" className="w-3 h-3 mr-1.5 animate-spin" /> {isRunning ? 'Stopping…' : 'Activating…'}
                        </span>
                      ) : isRunning ? (
                        <span className="flex items-center text-indigo-400 text-xs font-medium bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mr-1.5 animate-pulse"></span> Active
                        </span>
                      ) : failedError ? (
                        <span className="flex items-center text-rose-400 text-xs font-medium bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20">
                          Failed
                        </span>
                      ) : (
                        <span className="flex items-center text-slate-400 text-xs font-medium bg-slate-500/10 px-2 py-1 rounded border border-slate-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mr-1.5"></span> Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-app-text mb-1 uppercase tracking-wider font-semibold">Run command</div>
                      <code className="block text-[11px] font-mono text-app-textStrong bg-app-bg border border-app-border rounded px-2 py-1 mb-3 truncate">
                        {runCmd}
                      </code>
                      {failedError && (
                        <div className="text-xs text-rose-400 mb-3 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">
                          {failedError}
                        </div>
                      )}
                      <div className="text-xs text-app-text mb-2 uppercase tracking-wider font-semibold">Capabilities</div>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {adapter.capabilities.length === 0 ? (
                          <span className="px-2 py-0.5 rounded bg-app-bg border border-app-border text-xs text-app-text">
                            general
                          </span>
                        ) : (
                          adapter.capabilities.map((cap) => (
                            <span
                              key={cap}
                              className="px-2 py-0.5 rounded bg-app-bg border border-app-border text-xs text-app-text"
                            >
                              {cap}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="pt-4 border-t border-app-border flex justify-between items-center">
                      <span
                        className={`text-xs flex items-center ${
                          adapter.installed ? 'text-app-success' : 'text-amber-400'
                        }`}
                      >
                        <Icon
                          name={adapter.installed ? 'check-circle' : 'alert-triangle'}
                          className="w-3.5 h-3.5 mr-1"
                        />
                        {adapter.installed ? `Installed${adapter.path ? ` • ${adapter.executable}` : ''}` : 'Not Installed'}
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="relative inline-flex items-center cursor-pointer" title={isRunning ? 'Deactivate' : 'Activate'}>
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={isRunning}
                            disabled={!adapter.installed || isBusy || projectMissing}
                            onChange={() => toggleActive(adapter.id, isRunning)}
                          />
                          <div className="w-9 h-5 bg-app-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-app-primary"></div>
                        </label>
                        {adapter.installed ? (
                          <button
                            onClick={() => showToast(adapter.name, `Adapter ${adapter.name} already installed.`, 'info')}
                            className="px-3 py-1.5 rounded text-xs font-medium bg-app-hover text-app-textStrong hover:bg-app-border transition-colors"
                          >
                            Installed
                          </button>
                        ) : (
                          <button
                            onClick={() => setInstallAdapterId(adapter.id)}
                            className="px-3 py-1.5 rounded text-xs font-medium bg-app-primary hover:bg-indigo-600 text-white transition-colors shadow-sm"
                          >
                            Install
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {adapter && <InstallModal adapter={adapter} onClose={() => setInstallAdapterId(null)} />}
    </div>
  );
}

function InstallModal({
  adapter,
  onClose,
}: {
  adapter: { id: string; name: string; installCommands: string[] };
  onClose: () => void;
}) {
  const { showToast } = useStore();
  const commands = adapter.installCommands.length > 0 ? adapter.installCommands : ['npm install -g ' + adapter.id];
  const [copied, setCopied] = useState(false);

  const copy = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      showToast('Command Copied', `Install command for ${adapter.name} copied.`, 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Copy Failed', 'Clipboard is not available.', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 modal-overlay" onClick={onClose}></div>
      <div className="relative bg-app-surface border border-app-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-surface">
          <h2 className="text-base font-semibold text-app-textStrong">Install {adapter.name}</h2>
          <button onClick={onClose} className="text-app-text hover:text-white transition-colors">
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          <p className="text-sm text-app-text mb-4">
            Open your terminal and run the command below. OpenCLI will detect the adapter next time you rescan.
          </p>
          {commands.map((cmd, i) => (
            <div
              key={i}
              className="group flex items-center justify-between gap-3 bg-app-bg border border-app-border rounded px-3 py-2.5 mb-3"
            >
              <code className="text-xs text-app-textStrong font-mono break-all">{cmd}</code>
              <button
                onClick={() => copy(cmd)}
                className="shrink-0 px-2.5 py-1 rounded text-xs font-medium bg-app-hover text-app-textStrong hover:bg-app-border transition-colors"
              >
                <Icon name={copied ? 'check-circle' : 'copy'} className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="text-xs text-app-text">
            After installing, make sure the CLI is on your PATH, then{' '}
            <span className="text-app-textStrong font-medium">Rescan</span> to update the registry.
          </div>
        </div>
        <div className="px-6 py-4 border-t border-app-border bg-app-bg flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded text-app-text hover:text-white transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}