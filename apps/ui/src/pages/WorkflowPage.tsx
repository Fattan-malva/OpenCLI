import { TaskList } from '../components/TaskCard';
import { Icon } from '../lib/icons';
import { useStore } from '../store';

export function WorkflowPage({ active }: { active: boolean }) {
  const { tasks, paused, togglePauseAll, openModal } = useStore();

  return (
    <div className={`page-content flex-col h-full w-full ${active ? 'active' : ''}`}>
      <div className="h-12 border-b border-app-border flex items-center justify-between px-6 shrink-0 bg-app-bg/50 backdrop-blur">
        <div className="flex items-center space-x-4">
          <h1 className="font-semibold text-app-textStrong">Current Plan: Feature Development</h1>
          <span className="text-xs text-app-text border border-app-border px-2 py-0.5 rounded-full">
            {tasks.length} Tasks
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={togglePauseAll}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded bg-app-surface border border-app-border hover:bg-app-hover transition-colors text-xs font-medium ${
              paused ? 'text-amber-400' : 'text-app-text'
            }`}
          >
            <Icon name={paused ? 'play' : 'pause'} className="w-3.5 h-3.5" />
            <span>{paused ? 'Resume All' : 'Pause All'}</span>
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
          <TaskList />
        </div>
      </div>
    </div>
  );
}