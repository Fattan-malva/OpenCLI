import { useState } from 'react';
import { Icon } from '../lib/icons';
import { useStore, COLOR_CLASSES } from '../store';

export function Header() {
  const { globalStatus, openModal, activeProject, goToProjects, logout, showToast } = useStore();
  const [logoutOpen, setLogoutOpen] = useState(false);
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
        {activeProject ? (
          <button
            onClick={goToProjects}
            className="flex items-center space-x-2 text-app-text hover:text-app-textStrong transition-colors group"
            title="Switch project"
          >
            <Icon name="folder-git-2" className="w-4 h-4 group-hover:text-app-primary" />
            <span className="font-medium text-app-textStrong">{activeProject.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-app-border text-app-text font-mono max-w-52 truncate hidden md:block">
              {activeProject.path}
            </span>
          </button>
        ) : (
          <div className="flex items-center space-x-2 text-app-text">
            <Icon name="folder-git-2" className="w-4 h-4" />
            <span className="font-medium text-app-textStrong">No workspace</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3">
        {icon === 'dot' ? (
          <div className={`${base} ${COLOR_CLASSES[color]}`}>
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></div>
            <span>{text}</span>
          </div>
        ) : (
          <div className={`${base} ${COLOR_CLASSES[color]} ${text === 'Input Required' ? 'status-shimmer' : ''}`}>
            <Icon name={icon} className="w-3.5 h-3.5" />
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
        <button
          onClick={() => setLogoutOpen(true)}
          className="p-1.5 rounded hover:bg-app-hover text-app-text transition-colors"
          title="Logout"
        >
          <Icon name="log-out" className="w-4 h-4" />
        </button>
      </div>
      {logoutOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 modal-overlay" onClick={() => setLogoutOpen(false)} />
        <div className="relative w-full max-w-sm mx-4 bg-app-surface border border-app-border rounded-xl shadow-2xl p-5">
          <h2 className="font-semibold text-app-textStrong">Logout OpenCLI?</h2>
          <p className="text-sm text-app-text mt-2">Adapter yang sedang berjalan akan dihentikan sebelum logout.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setLogoutOpen(false)} className="px-3 py-1.5 rounded text-xs text-app-text hover:bg-app-hover">Cancel</button>
            <button onClick={async () => { setLogoutOpen(false); await logout(); showToast('Logged Out', 'Session ended and adapters were stopped.', 'info'); }} className="px-3 py-1.5 rounded text-xs bg-rose-600 hover:bg-rose-500 text-white">Logout</button>
          </div>
        </div>
      </div>}
    </header>
  );
}