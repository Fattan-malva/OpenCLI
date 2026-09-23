import { AGENTS, providerRegistry, useStore } from '../store';
import { Icon } from '../lib/icons';

export function ModelsPage({ active }: { active: boolean }) {
  const { agentConfigs, updateAgentRoute } = useStore();

  return (
    <div className={`page-content flex-col h-full w-full ${active ? 'active' : ''}`}>
      <div className="h-12 border-b border-app-border flex items-center justify-between px-6 shrink-0 bg-app-bg/50 backdrop-blur">
        <h1 className="font-semibold text-app-textStrong">Agent Model Configuration</h1>
        <span className="text-xs text-app-text border border-app-border px-2 py-0.5 rounded-full bg-app-surface">
          Routing Policy
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-app-textStrong">Agent Routing Policy</h2>
            <p className="text-sm text-app-text mt-1">Map each agent's execution mode to a specific provider and model.</p>
          </div>

          {Object.entries(agentConfigs).map(([agentId, config]) => {
            const agent = AGENTS[agentId];
            if (!agent) return null;
            return (
              <div key={agentId} className="bg-app-surface border border-app-border rounded-lg overflow-hidden shadow-sm mb-6">
                <div className="px-5 py-3 border-b border-app-border bg-app-bg/50 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded ${agent.bg} ${agent.border} ${agent.color} flex items-center justify-center border`}>
                    <Icon name={agent.icon} className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-medium text-app-textStrong">{agent.name}</h3>
                    <div className="text-xs text-app-text font-mono">Agent ID: {agentId}</div>
                  </div>
                </div>
                <div className="divide-y divide-app-border">
                  {Object.entries(config.modes).map(([mode, route]) => (
                    <div
                      key={mode}
                      className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-app-surface hover:bg-app-hover/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 md:w-1/4">
                        <div className="px-2.5 py-1 rounded bg-app-bg border border-app-border text-xs font-semibold uppercase tracking-wider text-app-textStrong">
                          mode: {mode}
                        </div>
                      </div>
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider text-app-text mb-1.5 font-semibold">
                            Provider
                          </label>
                          <select
                            value={route.provider}
                            onChange={(e) => updateAgentRoute(agentId, mode, 'provider', e.target.value)}
                            className="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-textStrong focus:outline-none focus:border-app-primary"
                          >
                            {Object.keys(providerRegistry).map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider text-app-text mb-1.5 font-semibold">
                            Model
                          </label>
                          <select
                            value={route.model}
                            onChange={(e) => updateAgentRoute(agentId, mode, 'model', e.target.value)}
                            className="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-textStrong focus:outline-none focus:border-app-primary"
                          >
                            {(providerRegistry[route.provider] || []).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}