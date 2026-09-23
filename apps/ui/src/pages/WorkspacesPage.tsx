import { workspacesData } from '../lib/data';
import { useStore } from '../store';
import { Icon } from '../lib/icons';

export function WorkspacesPage({ active }: { active: boolean }) {
  const { showToast } = useStore();

  return (
    <div className={`page-content flex-col h-full w-full ${active ? 'active' : ''}`}>
      <div className="h-12 border-b border-app-border flex items-center px-6 shrink-0 bg-app-bg/50 backdrop-blur">
        <h1 className="font-semibold text-app-textStrong">Git Isolation & Worktrees</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {workspacesData.map((ws) => {
            const statusIcon =
              ws.status === 'clean'
                ? 'check-circle text-emerald-400'
                : ws.status === 'modified'
                  ? 'edit-2 text-indigo-400'
                  : 'alert-octagon text-rose-400';
            const [iconName, iconColor] = statusIcon.split(' ');
            return (
              <div
                key={ws.id}
                className="bg-app-surface border border-app-border rounded-lg p-4 flex items-center justify-between hover:bg-app-hover transition-colors"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Icon name="folder-git-2" className="w-4 h-4 text-app-text" />
                    <span className="font-mono text-app-textStrong font-medium text-sm">{ws.id}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#1e1e24] border border-app-border text-[10px] text-app-text font-mono">
                      {ws.branch}
                    </span>
                  </div>
                  <span className="text-xs text-app-text font-mono">{ws.path}</span>
                  {ws.locks.length > 0 && (
                    <div className="flex items-center gap-2 mt-2">
                      <Icon name="lock" className="w-3 h-3 text-amber-400" />
                      <span className="text-[10px] text-amber-400 font-medium tracking-wide uppercase">
                        Locked: {ws.locks.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
                    <Icon name={iconName} className={`w-3.5 h-3.5 ${iconColor}`} />
                    <span className={iconColor}>{ws.status}</span>
                  </div>
                  <button
                    onClick={() => showToast('Workspace Synced', `Successfully synced ${ws.id}`, 'success')}
                    className="text-xs text-app-text hover:text-app-textStrong underline underline-offset-2"
                  >
                    Sync & Validate
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