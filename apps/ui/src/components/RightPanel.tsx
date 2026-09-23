import type { ReactNode } from 'react';
import { AGENTS, useStore } from '../store';
import { logTypeColor } from '../store';
import { Icon } from '../lib/icons';
import type { LogEntry } from '../lib/types';


function HighlightJson({ json }: { json: string }) {
  const token =
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = token.exec(json)) !== null) {
    if (m.index > last) nodes.push(json.slice(last, m.index));
    let cls = 'text-blue-400';
    if (/^"/.test(m[0])) cls = /:$/.test(m[0]) ? 'text-indigo-300 font-medium' : 'text-emerald-400';
    else if (/true|false/.test(m[0])) cls = 'text-amber-400';
    else if (/null/.test(m[0])) cls = 'text-rose-400';
    nodes.push(
      <span key={key++} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < json.length) nodes.push(json.slice(last));
  return <>{nodes}</>;
}

function LogLine({ entry }: { entry: LogEntry }) {
  const { time, type, message, agentId, taskId } = entry;
  const typeColor = logTypeColor(type);
  const shortType = type.split('.').pop() ?? type;
  const agent = agentId ? AGENTS[agentId] : undefined;

  return (
    <div className="mb-1 hover:bg-white/[0.02] -mx-4 px-4 py-0.5 rounded transition-colors">
      <span className="text-slate-600 select-none mr-2">{time}</span>
      <span className={`${typeColor} font-semibold w-24 inline-block align-top`}>{shortType}</span>
      {taskId && <span className="text-slate-500 mx-1">[{taskId}]</span>}
      {agent && (
        <span
          className={`${agent.color} ${agent.bg} border ${agent.border} px-1.5 py-0.5 rounded mx-1 text-[9px] font-bold uppercase tracking-wider`}
        >
          {agentId}
        </span>
      )}
      {typeof message === 'object' ? (
        <>
          <br />
          <span className="text-slate-500 pl-4 whitespace-pre-wrap">{JSON.stringify(message, null, 2)}</span>
        </>
      ) : (
        <span className="text-slate-300 break-words">{message}</span>
      )}
    </div>
  );
}

export function RightPanel() {
  const { rightTab, switchRightTab, logs, clearLogs, terminalRef, tasks, activeProject, activeWorkflow } = useStore();

  const todoGroups = {
    progress: tasks.filter((task) => ['RUNNING', 'ASK', 'REVIEW'].includes(task.status)),
    todo: tasks.filter((task) => ['PENDING', 'READY'].includes(task.status)),
    done: tasks.filter((task) => task.status === 'COMPLETED'),
  };

  const contextData = {
    project: activeProject
      ? {
          name: activeProject.name,
          path: activeProject.path,
          settings: { maxParallelAgents: 4, defaultMode: 'build' },
        }
      : {
          name: '—',
          path: '—',
          settings: { maxParallelAgents: 4, defaultMode: 'build' },
        },
    workflow: activeWorkflow
      ? {
          id: activeWorkflow.id,
          name: activeWorkflow.name,
          status: activeWorkflow.status,
        }
      : null,
    activeTasks: tasks
      .filter((task) => ['RUNNING', 'ASK', 'REVIEW'].includes(task.status))
      .map((task) => ({
        id: task.id,
        title: task.title,
        adapter: task.agentId,
        mode: task.mode,
      })),
    taskSummary: {
      total: tasks.length,
      completed: tasks.filter((task) => task.status === 'COMPLETED').length,
      running: tasks.filter((task) => ['RUNNING', 'ASK', 'REVIEW'].includes(task.status)).length,
      pending: tasks.filter((task) => ['PENDING', 'READY'].includes(task.status)).length,
      blocked: tasks.filter((task) => task.status === 'BLOCKED').length,
    },
    eventCount: logs.length,
  };

  return (
    <aside className="w-80 lg:w-96 border-l border-app-border flex flex-col bg-app-surface shrink-0 z-10">
      {/* Panel Header / Tabs */}
      <div className="flex h-10 border-b border-app-border shrink-0 text-xs font-medium overflow-x-auto scrollbar-none">
        <button
          onClick={() => switchRightTab('todo')}
          className={`shrink-0 px-3 flex items-center justify-center gap-1.5 transition-colors ${
            rightTab === 'todo'
              ? 'border-b-2 border-app-primary text-app-textStrong bg-app-hover'
              : 'border-b-2 border-transparent text-app-text hover:text-app-textStrong hover:bg-app-hover'
          }`}
        >
          <Icon name="list-checks" className="w-4 h-4" /> Todo
        </button>
        <button
          onClick={() => switchRightTab('logs')}
          className={`shrink-0 px-3 flex items-center justify-center gap-1.5 transition-colors ${
            rightTab === 'logs'
              ? 'border-b-2 border-app-primary text-app-textStrong bg-app-hover'
              : 'border-b-2 border-transparent text-app-text hover:text-app-textStrong hover:bg-app-hover'
          }`}
        >
          <Icon name="terminal" className="w-4 h-4" /> Event Bus Logs
        </button>
        <button
          onClick={() => switchRightTab('context')}
          className={`shrink-0 px-3 flex items-center justify-center gap-1.5 transition-colors ${
            rightTab === 'context'
              ? 'border-b-2 border-app-primary text-app-textStrong bg-app-hover'
              : 'border-b-2 border-transparent text-app-text hover:text-app-textStrong hover:bg-app-hover'
          }`}
        >
          <Icon name="file-json" className="w-4 h-4" /> Context
        </button>
      </div>

      {/* AI Todo List — backed by workflow task state */}
      {rightTab === 'todo' && (
        <div className="flex-1 overflow-y-auto p-4 bg-[#09090b]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-app-textStrong">Agent Todo</div>
              <div className="text-[10px] text-app-text mt-0.5">AI-generated execution plan</div>
            </div>
            <span className="text-[10px] font-mono text-app-text bg-app-bg border border-app-border rounded px-2 py-1">
              {todoGroups.done.length}/{tasks.length}
            </span>
          </div>

          <div className="space-y-4">
            {(['progress', 'todo', 'done'] as const).map((status) => {
              const items = todoGroups[status];
              if (!items.length) return null;
              const config = {
                progress: { label: 'In Progress', icon: 'loader-circle', color: 'text-app-primary' },
                todo: { label: 'Todo', icon: 'circle', color: 'text-app-text' },
                done: { label: 'Done', icon: 'circle-check', color: 'text-emerald-400' },
              }[status];

              return (
                <section key={status}>
                  <div className={`flex items-center gap-2 mb-2 text-[10px] uppercase tracking-wider font-semibold ${config.color}`}>
                    <Icon name={config.icon} className="w-3.5 h-3.5" />
                    {config.label}
                    <span className="text-app-text ml-auto">{items.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {items.map((task) => (
                      <div key={task.id} className="flex items-start gap-2.5 rounded-md border border-app-border/70 bg-app-bg/60 px-3 py-2.5">
                        <Icon
                          name={status === 'done' ? 'circle-check' : status === 'progress' ? 'circle-dot' : 'circle'}
                          className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${config.color}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs leading-relaxed ${status === 'done' ? 'text-app-text line-through opacity-60' : 'text-app-textStrong'}`}>
                            {task.title}
                          </div>
                          <div className="text-[9px] font-mono text-app-text mt-0.5 truncate">{task.id}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {/* Terminal Output Area */}
      {rightTab === 'logs' && (
        <div
          ref={terminalRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed relative bg-[#09090b]"
        >
          <div className="sticky top-0 w-full flex justify-end pb-2 opacity-50 hover:opacity-100 transition-opacity z-10">
            <button
              onClick={clearLogs}
              className="p-1.5 rounded bg-app-border text-app-text hover:text-white hover:bg-app-hover backdrop-blur"
              title="Clear Logs"
            >
              <Icon name="trash-2" className="w-3 h-3" />
            </button>
          </div>
          {logs.map((entry, i) => (
            <LogLine key={i} entry={entry} />
          ))}
        </div>
      )}

      {/* Context Output Area */}
      {rightTab === 'context' && (
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed relative bg-[#09090b]">
          <pre className="text-app-info">
            <HighlightJson json={JSON.stringify(contextData, null, 2)} />
          </pre>
        </div>
      )}

      {/* Workflow Resource Monitor */}
      <div className="h-36 border-t border-app-border bg-app-surface p-4 flex flex-col gap-2 text-xs">
        <div className="text-app-textStrong font-medium mb-1 flex items-center">
          <Icon name="activity" className="w-3.5 h-3.5 mr-1.5" /> Workflow Resources
        </div>
        <div className="flex justify-between text-app-text">
          <span>Active Tasks</span>
          <span className="text-app-textStrong">{tasks.filter((task) => ['RUNNING', 'ASK', 'REVIEW'].includes(task.status)).length}</span>
        </div>
        <div className="flex justify-between text-app-text">
          <span>Completed</span>
          <span className="text-emerald-400">{tasks.filter((task) => task.status === 'COMPLETED').length} / {tasks.length}</span>
        </div>
        <div className="w-full bg-app-bg rounded-full h-1.5">
          <div
            className="bg-app-primary h-1.5 rounded-full transition-all"
            style={{ width: `${tasks.length ? Math.round((tasks.filter((task) => task.status === 'COMPLETED').length / tasks.length) * 100) : 0}%` }}
          />
        </div>
        <div className="text-[10px] text-app-text mt-1">
          Token/quota telemetry will be supplied by the resource manager in a later phase.
        </div>
      </div>
    </aside>
  );
}