import { Icon } from '../lib/icons';
import { useStore } from '../store';
import type { PageId } from '../lib/types';

const NAV: { id: PageId; label: string; icon: string; count?: string }[] = [
  { id: 'workspace', label: 'WorkSpace', icon: 'layout-dashboard' },
  { id: 'adapters', label: 'Adapters', icon: 'bot' },
  { id: 'models', label: 'Models & Providers', icon: 'cpu' },
  { id: 'workspaces', label: 'Workspaces', icon: 'git-merge' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function Sidebar() {
  const { page, showPage, adapters } = useStore();
  // Counts come from the server, never from a hardcoded total.
  const installedCount = adapters.filter((a) => a.installed).length;

  return (
    <aside className="w-14 sm:w-60 border-r border-app-border bg-app-surface flex flex-col shrink-0 transition-all duration-300">
      <nav className="flex-1 py-4 space-y-1">
        {NAV.map((item) => {
          const active = page === item.id;
          return (
            <button
              key={item.id}
              onClick={() => showPage(item.id)}
              className={`w-full flex items-center px-4 py-2 border-r-2 transition-colors group ${
                active
                  ? 'bg-app-hover text-app-textStrong border-app-primary'
                  : 'text-app-text hover:bg-app-hover hover:text-app-textStrong border-transparent'
              }`}
            >
              <Icon
                name={item.icon}
                className={`w-5 h-5 mr-3 ${active && item.id === 'workspace' ? 'text-app-primary' : 'group-hover:text-app-textStrong'}`}
              />
              <span className="hidden sm:block font-medium">{item.label}</span>
              {item.id === 'adapters' && installedCount > 0 && (
                <span className="hidden sm:flex ml-auto bg-app-border text-xs px-1.5 py-0.5 rounded-full">
                  {installedCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="p-4 border-t border-app-border">
        <div className="hidden sm:flex items-center space-x-2 text-xs text-app-text">
          <div className="w-2 h-2 rounded-full bg-app-success"></div>
          <span>Core Engine Online</span>
        </div>
      </div>
    </aside>
  );
}