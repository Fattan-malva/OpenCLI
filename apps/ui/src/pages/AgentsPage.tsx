import { AGENTS, useStore } from '../store';
import { Icon } from '../lib/icons';

export function AgentsPage({ active }: { active: boolean }) {
  const { tasks, agentConfigs, openModal } = useStore();

  return (
    <div className={`page-content flex-col h-full w-full ${active ? 'active' : ''}`}>
      <div className="h-12 border-b border-app-border flex items-center px-6 shrink-0 bg-app-bg/50 backdrop-blur">
        <h1 className="font-semibold text-app-textStrong">Agent Registry & Status</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(AGENTS)
            .filter(([id]) => id !== 'system')
            .map(([id, agent]) => {
              const isRunning = tasks.some((t) => t.agentId === id && t.status === 'RUNNING');
              const agentModes = agentConfigs[id] ? Object.keys(agentConfigs[id].modes) : ['general'];
              return (
                <div
                  key={id}
                  className="bg-app-surface border border-app-border rounded-lg p-5 flex flex-col hover:border-[#3f3f46] transition-colors"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded ${agent.bg} ${agent.border} ${agent.color} flex items-center justify-center border`}>
                        <Icon name={agent.icon} className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-medium text-app-textStrong">{agent.name}</h3>
                        <p className="text-xs text-app-text font-mono">ID: {id} • v1.4.2</p>
                      </div>
                    </div>
                    {isRunning ? (
                      <span className="flex items-center text-indigo-400 text-xs font-medium bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mr-1.5 animate-pulse"></span> Working
                      </span>
                    ) : (
                      <span className="flex items-center text-slate-400 text-xs font-medium bg-slate-500/10 px-2 py-1 rounded border border-slate-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mr-1.5"></span> Idle
                      </span>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-app-text mb-2 uppercase tracking-wider font-semibold">Capabilities</div>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {agentModes.map((mode) => (
                        <span
                          key={mode}
                          className="px-2 py-0.5 rounded bg-app-bg border border-app-border text-xs text-app-text"
                        >
                          {mode}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="pt-4 border-t border-app-border flex justify-between items-center">
                    <span className="text-xs text-app-success flex items-center">
                      <Icon name="check-circle" className="w-3.5 h-3.5 mr-1" /> Health OK
                    </span>
                    <button
                      onClick={() => openModal({ title: `Configure ${agent.name}`, kind: 'agentConfig', agentId: id })}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-app-hover text-app-textStrong hover:bg-app-border transition-colors"
                    >
                      Configure
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}