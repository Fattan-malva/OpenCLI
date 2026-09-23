import { TaskList } from '../components/TaskCard';
import { Icon } from '../lib/icons';
import { useStore } from '../store';
import { api } from '../lib/api';

export function WorkflowPage({ active }: { active: boolean }) {
  const {
    tasks,
    paused,
    togglePauseAll,
    openModal,
    activeProject,
    workflows,
    activeWorkflow,
    loadWorkflows,
    loadTasks,
    showToast,
    selectWorkflow,
  } = useStore();

  return (
    <div className={`page-content flex-col h-full w-full ${active ? 'active' : ''}`}>
      <div className="h-12 border-b border-app-border flex items-center justify-between px-6 shrink-0 bg-app-bg/50 backdrop-blur">
        <div className="flex items-center space-x-4">
          <div className="min-w-0">
            <h1 className="font-semibold text-app-textStrong truncate">
              {activeWorkflow?.name ?? 'Workflow'}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] uppercase tracking-wider text-app-text">
                {activeWorkflow?.status ?? 'no workflow'}
              </span>
              <span className="text-[10px] text-app-text border border-app-border px-1.5 py-0.5 rounded-full">
                {tasks.length} Tasks
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {activeWorkflow && (activeWorkflow.status === 'draft' || activeWorkflow.status === 'paused') && (
            <button
              onClick={async () => {
                try {
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
                } catch (error: any) {
                  showToast('Workflow Error', error?.message ?? 'Unable to resume workflow.', 'error');
                }
              }}
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
              <span>Pause</span>
            </button>
          )}
          {activeWorkflow && !['completed', 'failed', 'cancelled'].includes(activeWorkflow.status) && (
            <button
              onClick={async () => {
                try {
                  await api.cancelWorkflow(activeWorkflow.id);
                  if (activeProject) {
                    await Promise.all([loadWorkflows(activeProject.id), loadTasks(activeProject.id)]);
                  }
                  showToast('Workflow Cancelled', 'Pending tasks were cancelled.', 'info');
                } catch (error: any) {
                  showToast('Workflow Error', error?.message ?? 'Unable to cancel workflow.', 'error');
                }
              }}
              className="flex items-center space-x-1 px-3 py-1.5 rounded bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition-colors text-xs font-medium text-rose-400"
            >
              <Icon name="square" className="w-3.5 h-3.5" />
              <span>Stop</span>
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4 relative">
          {workflows.length > 1 && (
            <div className="flex items-center gap-2 mb-1 overflow-x-auto">
              {workflows.map((workflow) => (
                <button
                  key={workflow.id}
                  onClick={() => {
                    void selectWorkflow(workflow);
                  }}
                  className={`shrink-0 px-2.5 py-1.5 rounded border text-xs transition-colors ${
                    activeWorkflow?.id === workflow.id
                      ? 'border-app-primary/40 bg-app-primary/10 text-app-textStrong'
                      : 'border-app-border bg-app-surface text-app-text hover:bg-app-hover'
                  }`}
                >
                  {workflow.name}
                </button>
              ))}
            </div>
          )}
          {!activeWorkflow && (
            <div className="rounded-lg border border-dashed border-app-border bg-app-surface/50 px-6 py-10 text-center">
              <Icon name="workflow" className="w-8 h-8 mx-auto mb-3 text-app-text" />
              <div className="text-sm font-medium text-app-textStrong">No workflow yet</div>
              <div className="text-xs text-app-text mt-1">Add a task to create the first persisted workflow.</div>
            </div>
          )}
          <TaskList />
        </div>
      </div>
    </div>
  );
}