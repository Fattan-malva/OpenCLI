import { Icon } from '../lib/icons';
import { useStore, COLOR_CLASSES } from '../store';

export function Header() {
  const { globalStatus, openModal } = useStore();
  const base = `flex items-center space-x-2 text-xs font-medium px-2.5 py-1 rounded-full border`;
  const { color, icon, text, pulse } = globalStatus;

  return (
    <header className="h-12 border-b border-app-border bg-app-surface flex items-center justify-between px-4 shrink-0 z-10">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2 text-app-textStrong font-semibold">
          <Icon name="terminal-square" className="w-5 h-5 text-app-primary" />
          <span>OpenCLI</span>
        </div>
        <div className="h-4 w-px bg-app-border"></div>
        <div className="flex items-center space-x-2 text-app-text">
          <Icon name="folder-git-2" className="w-4 h-4" />
          <span className="font-medium text-app-textStrong">marketplace-v2</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-app-border text-app-text">master</span>
        </div>
      </div>

      <div className="flex items-center space-x-3">
        {icon === 'dot' ? (
          <div className={`${base} ${COLOR_CLASSES[color]}`}>
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></div>
            <span>{text}</span>
          </div>
        ) : (
          <div className={`${base} ${COLOR_CLASSES[color]}`}>
            <Icon name={icon} className={`w-3.5 h-3.5 ${pulse ? 'animate-spin' : ''}`} />
            <span>{text}</span>
          </div>
        )}
        <button
          onClick={() => openModal({ title: 'Orchestrator Settings', kind: 'settings' })}
          className="p-1.5 rounded hover:bg-app-hover text-app-text transition-colors"
          title="Settings"
        >
          <Icon name="settings" className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}