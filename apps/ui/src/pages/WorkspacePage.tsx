import { useEffect, useMemo, useRef, useState } from 'react';
import { TaskList } from '../components/TaskCard';
import { ChatThread } from '../components/ChatThread';
import { ChatComposer } from '../components/ChatComposer';
import { ChatThreadList } from '../components/ChatThreadList';
import { AdapterIcon } from '../components/AdapterIcon';
import { Icon } from '../lib/icons';
import { STATUS, useStore } from '../store';
import { adapterMeta } from '../lib/data';
import { TerminalPanel } from '../components/TerminalPanel';
import { api } from '../lib/api';

export function WorkspacePage({ active }: { active: boolean }) {
  const {
    tasks,
    paused,
    togglePauseAll,
    openModal,
    activeProject,
    activeWorkflow,
    loadWorkflows,
    loadTasks,
    showToast,
    activeThread,
    createChat,
    stopChat,
  } = useStore();
  const [view, setView] = useState<'chat' | 'workflow'>('chat');

  const headerAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error: any) {
      showToast('Workflow Error', error?.message ?? 'Action failed.', 'error');
    }
  };

  return (
    <div className={`page-content flex-col h-full w-full ${active ? 'active' : ''}`}>
      <div className="h-12 border-b border-app-border flex items-center justify-between px-6 shrink-0 bg-app-bg/50 backdrop-blur">
        <div className="flex items-center space-x-4 min-w-0">
          <div className="min-w-0">
            <h1 className="font-semibold text-app-textStrong truncate">
              {view === 'chat' ? (activeThread?.title ?? 'Agent Chat') : (activeWorkflow?.name ?? 'Workflow')}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              {view === 'chat' ? (
                <span className="text-[10px] uppercase tracking-wider text-app-text">
                  {activeThread?.workflowId ? 'workflow linked' : 'planner driven'}
                </span>
              ) : (
                <>
                  <span className="text-[10px] uppercase tracking-wider text-app-text">
                    {activeWorkflow?.status ?? 'no workflow'}
                  </span>
                  <span className="text-[10px] text-app-text border border-app-border px-1.5 py-0.5 rounded-full">
                    {tasks.length} Tasks
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {view === 'chat' ? (
            <>
              <button
                onClick={() => setView('workflow')}
                className="flex items-center space-x-1 px-3 py-1.5 rounded bg-app-surface border border-app-border hover:bg-app-hover transition-colors text-xs font-medium text-app-text"
              >
                <Icon name="list-checks" className="w-3.5 h-3.5" />
                <span>Workflow</span>
              </button>
              <button
                onClick={() => void createChat()}
                className="flex items-center space-x-1 px-3 py-1.5 rounded bg-app-surface border border-app-border hover:bg-app-hover text-app-text transition-colors text-xs font-medium"
              >
                <Icon name="plus" className="w-3.5 h-3.5" />
                <span>New Chat</span>
              </button>
              <button
                onClick={() => void stopChat()}
                disabled={!activeThread}
                className="flex items-center space-x-1 px-3 py-1.5 rounded bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition-colors text-xs font-medium text-rose-400 disabled:opacity-40 disabled:hover:bg-rose-500/10"
              >
                <Icon name="square" className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setView('chat')}
                className="flex items-center space-x-1 px-3 py-1.5 rounded bg-app-surface border border-app-border hover:bg-app-hover transition-colors text-xs font-medium text-app-text"
              >
                <Icon name="message-square-dashed" className="w-3.5 h-3.5" />
                <span>Chat</span>
              </button>
              {activeWorkflow && (activeWorkflow.status === 'draft' || activeWorkflow.status === 'paused') && (
                <button
                  onClick={() =>
                    void headerAction(async () => {
                      if (activeWorkflow.status === 'draft') {
                        await api.startWorkflow(activeWorkflow.id);
                      } else {
                        await api.resumeWorkflow(activeWorkflow.id);
                      }
                      if (activeProject) {
                        await Promise.all([loadWorkflows(activeProject.id), loadTasks(activeProject.id)]);
                      }
                      showToast(
                        activeWorkflow.status === 'draft' ? 'Workflow Started' : 'Workflow Resumed',
                        'Scheduler will dispatch ready tasks.',
                        'success',
                      );
                    })
                  }
                  className="flex items-center space-x-1 px-3 py-1.5 rounded bg-app-surface border border-app-border hover:bg-app-hover transition-colors text-xs font-medium text-app-text"
                >
                  <Icon name="play" className="w-3.5 h-3.5" />
                  <span>{activeWorkflow.status === 'draft' ? 'Start Workflow' : 'Resume'}</span>
                </button>
              )}
              {activeWorkflow?.status === 'running' && (
                <button
                  onClick={togglePauseAll}
                  className="flex items-center space-x-1 px-3 py-1.5 rounded bg-app-surface border border-app-border hover:bg-app-hover transition-colors text-xs font-medium text-amber-400"
                >
                  <Icon name="pause" className="w-3.5 h-3.5" />
                  <span>{paused ? 'Paused' : 'Pause'}</span>
                </button>
              )}
              <button
                onClick={() => openModal({ title: 'New Workflow', kind: 'newWorkflow' })}
                className="flex items-center space-x-1 px-3 py-1.5 rounded bg-app-surface border border-app-border hover:bg-app-hover text-app-text transition-colors text-xs font-medium"
              >
                <Icon name="workflow" className="w-3.5 h-3.5" />
                <span>New Workflow</span>
              </button>
              <button
                onClick={() => openModal({ title: 'Add New Task', kind: 'addTask' })}
                className="flex items-center space-x-1 px-3 py-1.5 rounded bg-app-primary hover:bg-indigo-600 text-white transition-colors text-xs font-medium shadow-sm shadow-indigo-500/20"
              >
                <Icon name="plus" className="w-3.5 h-3.5" />
                <span>Add Task</span>
              </button>
            </>
          )}
        </div>
      </div>

      {view === 'chat' ? (
        <div className="flex-1 flex min-h-0">
          <ChatThreadList />
          <div className="flex-1 flex flex-col min-w-0">
            <ChatThread />
            <ChatComposer />
          </div>
          <LivePanels />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <WorkflowSidebar />
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-4">
              {!activeWorkflow && (
                <div className="rounded-lg border border-dashed border-app-border bg-app-surface/50 px-6 py-10 text-center">
                  <Icon name="workflow" className="w-8 h-8 mx-auto mb-3 text-app-text" />
                  <div className="text-sm font-medium text-app-textStrong">No workflow yet</div>
                  <div className="text-xs text-app-text mt-1">Send a task in the chat, or add one manually.</div>
                </div>
              )}
              <TaskList />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const WORKFLOW_STATUS_CLASSES: Record<string, string> = {
  draft: 'text-slate-400',
  running: 'text-emerald-400',
  paused: 'text-amber-400',
  completed: 'text-cyan-400',
  failed: 'text-rose-400',
  cancelled: 'text-app-text',
};

function WorkflowSidebar() {
  const { workflows, tasks, activeWorkflow, selectWorkflow, openModal } = useStore();

  return (
    <div className="w-56 shrink-0 border-r border-app-border flex flex-col bg-app-surface/40 hidden md:flex">
      <div className="h-12 border-b border-app-border flex items-center justify-between px-3 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-app-text font-semibold">Workflows</span>
        <button
          onClick={() => openModal({ title: 'New Workflow', kind: 'newWorkflow' })}
          className="p-1 rounded text-app-text hover:text-app-textStrong hover:bg-app-hover transition-colors"
          title="New workflow"
        >
          <Icon name="plus" className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {workflows.length === 0 && <div className="text-[11px] text-app-text px-2 py-3">No workflows yet.</div>}
        {workflows.map((workflow) => {
          const active = activeWorkflow?.id === workflow.id;
          const count = tasks.filter((task) => task.workflowId === workflow.id).length;
          return (
            <div
              key={workflow.id}
              className={`rounded-lg px-2 py-2 cursor-pointer transition-colors ${
                active ? 'bg-app-hover border border-app-border' : 'hover:bg-app-hover/60 border border-transparent'
              }`}
            >
              <button onClick={() => void selectWorkflow(workflow)} className="w-full text-left">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon name="workflow" className="w-3.5 h-3.5 shrink-0 text-app-primary" />
                  <span className="text-xs text-app-textStrong truncate flex-1">{workflow.name}</span>
                  <span className="text-[10px] font-mono text-app-text shrink-0">{count}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] capitalize">
                  <span className={WORKFLOW_STATUS_CLASSES[workflow.status] ?? 'text-app-text'}>{workflow.status}</span>
                  <span className="text-app-text/60 truncate">{workflow.description}</span>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LivePanels() {
  const { sessions, tasks } = useStore();
  const running = useMemo(() => sessions.filter((session) => session.status === 'running'), [sessions]);

  return (
    <div className="hidden xl:flex flex-col w-80 shrink-0 border-l border-app-border bg-app-bg/40 min-h-0">
      <div className="h-12 border-b border-app-border flex items-center justify-between px-4 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-app-text">Live adapters</span>
        <span className="text-[10px] font-mono text-app-text">{running.length} running</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {running.length === 0 && (
          <div className="rounded-lg border border-dashed border-app-border px-4 py-8 text-center text-xs text-app-text">
            No adapter session is running.
            <br />
            Start one on the Adapters page to see its live stream here.
          </div>
        )}
        {running.map((session) => (
          <LivePanel key={session.adapterId} adapterId={session.adapterId} tasks={tasks} />
        ))}
      </div>
    </div>
  );
}

function LivePanel({ adapterId, tasks }: { adapterId: string; tasks: ReturnType<typeof useStore>['tasks'] }) {
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const meta = adapterMeta(adapterId);
  const { activeProject, capabilities } = useStore();
  const [view, setView] = useState<'output' | 'terminal'>('output');
  const chatTask = useMemo(() => {
    const agentTasks = tasks.filter((task) => task.agentId === adapterId && task.liveOutput);
    return agentTasks[agentTasks.length - 1];
  }, [tasks, adapterId]);

  const output = chatTask?.liveOutput ?? '';
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const statusInfo = STATUS[chatTask?.status ?? 'PENDING'];
  const canHost = capabilities[adapterId]?.supportsInteractive !== false;

  return (
    <div className="rounded-lg border border-app-border bg-app-surface/70 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-app-border">
        <AdapterIcon id={adapterId} className="w-3.5 h-3.5 shrink-0" />
        {/* Named once. The raw id used to sit beside the display name, which
            read as two adapters rather than one described twice. */}
        <span className={`text-xs font-semibold ${meta.color}`}>{meta.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setView('output')}
            className={`text-[10px] px-1.5 py-0.5 rounded ${view === 'output' ? 'bg-app-border text-app-textStrong' : 'text-app-text'}`}
          >
            Output
          </button>
          {activeProject && canHost && (
            <button
              onClick={() => setView('terminal')}
              className={`text-[10px] px-1.5 py-0.5 rounded ${view === 'terminal' ? 'bg-app-border text-app-textStrong' : 'text-app-text'}`}
            >
              Terminal
            </button>
          )}
          <span className="flex items-center gap-1 text-[10px] text-app-text ml-1">
            <Icon name={statusInfo.icon} className="w-3 h-3" />
            {chatTask ? statusInfo.label : 'idle'}
          </span>
        </div>
      </div>
      {view === 'terminal' && activeProject ? (
        <div className="h-72">
          <TerminalPanel
            projectId={activeProject.id}
            adapterId={adapterId}
            capabilities={capabilities[adapterId]}
          />
        </div>
      ) : (
        <pre
          ref={scrollRef}
          className="max-h-64 overflow-y-auto px-3 py-2 text-[11px] leading-relaxed font-mono text-app-textStrong whitespace-pre-wrap break-words"
        >
          {output || 'Waiting for live output…'}
        </pre>
      )}
    </div>
  );
}