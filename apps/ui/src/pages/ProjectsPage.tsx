import { useEffect, useState } from 'react';
import { Icon } from '../lib/icons';
import { useStore } from '../store';
import { api } from '../lib/api';
import type { FsListResult, ProjectRecord } from '../lib/types';

export function ProjectsPage() {
  const { projects, loadProjects, openProject, screen, createProject, deleteProject, logout, openModal, showToast } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  useEffect(() => {
    if (screen === 'projects') loadProjects();
  }, [screen, loadProjects]);

  const refresh = async () => {
    setRefreshing(true);
    await loadProjects();
    setRefreshing(false);
  };

  return (
    <div className="h-screen flex flex-col bg-app-bg">
      <header className="h-12 border-b border-app-border bg-app-surface flex items-center justify-between px-4 shrink-0 z-10">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-app-textStrong font-semibold">
            <Icon name="terminal-square" className="w-5 h-5 text-app-primary" />
            <span>OpenCLI</span>
          </div>
          <div className="h-4 w-px bg-app-border"></div>
          <div className="flex items-center space-x-2 text-app-text">
            <Icon name="folder-git-2" className="w-4 h-4" />
            <span className="font-medium text-app-textStrong">Projects</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => openModal({ title: 'Orchestrator Settings', kind: 'settings' })}
            className="p-2 rounded hover:bg-app-hover text-app-text transition-colors"
            title="Settings"
          >
            <Icon name="settings" className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              logout();
              showToast('Logged Out', 'Session PIN ended.', 'info');
            }}
            className="p-2 rounded hover:bg-app-hover text-app-text transition-colors"
            title="Logout"
          >
            <Icon name="log-out" className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-app-textStrong flex items-center gap-3">
                <Icon name="folder-open" className="w-6 h-6 text-app-primary" />
                Open Project
              </h1>
              <p className="text-sm text-app-text mt-1">
                Pilih project untuk dibuka, atau buat project baru.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={refresh}
                className="p-2 rounded hover:bg-app-hover text-app-text transition-colors"
                title="Refresh"
              >
                <Icon name="refresh-cw" className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setNewProjectOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-app-primary hover:bg-indigo-600 text-white text-sm font-medium transition-colors shadow-sm"
              >
                <Icon name="plus" className="w-4 h-4" />
                New Project
              </button>
            </div>
          </div>

          {projects.length === 0 ? (
            <div className="border border-dashed border-app-border rounded-xl p-16 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-app-hover flex items-center justify-center mb-4">
                <Icon name="folder-plus" className="w-7 h-7 text-app-text" />
              </div>
              <h3 className="text-base font-medium text-app-textStrong mb-1">Belum ada project</h3>
              <p className="text-sm text-app-text mb-6">
                Buat project pertama untuk mulai menggunakan OpenCLI.
              </p>
              <button
                onClick={() => setNewProjectOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-app-primary hover:bg-indigo-600 text-white text-sm font-medium transition-colors shadow-sm"
              >
                <Icon name="folder-plus" className="w-4 h-4" />
                Create Project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => openProject(project)}
                  onDelete={async () => {
                    const ok = await deleteProject(project.id);
                    if (ok) showToast('Project Deleted', `"${project.name}" removed from OpenCLI.`, 'info');
                    else showToast('Delete Failed', 'Gagal menghapus project.', 'error');
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {newProjectOpen && (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreate={async (name, path) => {
            const ok = await createProject(name, path);
            if (ok) {
              setNewProjectOpen(false);
              showToast('Project Created', `Workspace "${name}" opened.`, 'success');
            } else {
              showToast('Create Failed', 'Gagal membuat project. Cek folder tujuan.', 'error');
            }
            return ok;
          }}
          onOpen={async (name, path) => {
            const ok = await createProject(name, path);
            if (ok) {
              setNewProjectOpen(false);
              showToast('Project Opened', `Workspace "${name}" opened.`, 'success');
            } else {
              showToast('Open Failed', 'Gagal membuka folder sebagai project.', 'error');
            }
            return ok;
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: ProjectRecord;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const created = new Date(project.createdAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return (
    <div className="group border border-app-border rounded-xl bg-app-surface hover:border-app-primary/50 hover:shadow-lg transition-all p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-app-hover flex items-center justify-center shrink-0">
            <Icon name="folder" className="w-5 h-5 text-app-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-app-textStrong truncate">{project.name}</h3>
            <p className="text-xs font-mono text-app-text truncate mt-0.5">{project.path}</p>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="p-1.5 rounded text-app-text opacity-0 group-hover:opacity-100 hover:text-app-danger hover:bg-app-danger/10 transition-all"
          title="Delete project (folder di disk tetap ada)"
        >
          <Icon name="trash-2" className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-app-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] text-app-text/70 shrink-0">{created}</span>
          <span className="text-[10px] text-app-text/40 truncate" title="Hanya dihapus dari OpenCLI, folder di disk tetap utuh">
            DB only
          </span>
        </div>
        <button
          onClick={onOpen}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-app-primary/10 text-app-primary hover:bg-app-primary hover:text-white border border-app-primary/20 transition-colors"
        >
          <Icon name="folder-open" className="w-3.5 h-3.5" />
          Open
        </button>
      </div>
    </div>
  );
}

interface NewProjectModalProps {
  onClose: () => void;
  onCreate: (name: string, path: string) => Promise<boolean>;
  onOpen: (name: string, path: string) => Promise<boolean>;
}

function NewProjectModal({ onClose, onCreate, onOpen }: NewProjectModalProps) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState<FsListResult | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = async (path?: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.fsList(path);
      setFolder(res);
      setSelectedPath(res.path);
    } catch (e: any) {
      setError(e?.message ?? 'Gagal membaca folder.');
    }
    setBusy(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openExisting = async () => {
    if (!selectedPath || creating) return;
    setCreating(true);
    setError('');
    const fallback = selectedPath.split(/[\\/]/).filter(Boolean).pop() || 'project';
    const ok = await onOpen(name.trim() || fallback, selectedPath);
    if (ok) onClose();
    setCreating(false);
  };

  const submit = async () => {
    if (!selectedPath || !name.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const mk = await api.fsMkdir(selectedPath, name.trim());
      const ok = await onCreate(name.trim(), mk.path);
      if (ok) onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Gagal membuat folder project.');
    }
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 modal-overlay" onClick={onClose}></div>
      <div className="relative bg-app-surface border border-app-border rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-surface">
          <h2 className="text-base font-semibold text-app-textStrong flex items-center gap-2">
            <Icon name="folder-plus" className="w-5 h-5 text-app-primary" />
            Create New Project
          </h2>
          <button onClick={onClose} className="text-app-text hover:text-white transition-colors">
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-app-text mb-1.5 font-medium text-sm">Project Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="project-name"
              className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary"
            />
          </div>

          <div>
            <label className="block text-app-text mb-1.5 font-medium text-sm">
              Project location{' '}
              <span className="text-app-text/60 font-normal">— klik folder untuk membuka & memilihnya</span>
            </label>
            <div className="border border-app-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-app-bg border-b border-app-border">
                <span className="font-mono text-xs text-app-info truncate" title={folder?.path}>
                  {folder?.path}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {folder?.parent && (
                    <button
                      onClick={() => load(folder.parent!)}
                      className="p-1.5 rounded hover:bg-app-hover text-app-text"
                      title="Up"
                    >
                      <Icon name="chevrons-up" className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => load()}
                    className="p-1.5 rounded hover:bg-app-hover text-app-text"
                    title="Home"
                  >
                    <Icon name="hard-drive" className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {!busy &&
                  (folder?.entries.length ? (
                    folder.entries.map((entry) => {
                      const isSelected = selectedPath === entry.path;
                      return (
                        <button
                          key={entry.path}
                          onClick={() => load(entry.path)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                            isSelected
                              ? 'bg-app-primary/10 text-app-primary'
                              : 'text-app-text hover:bg-app-hover hover:text-app-textStrong'
                          }`}
                        >
                          <Icon
                            name={isSelected ? 'folder-open' : 'folder'}
                            className={`w-4 h-4 ${isSelected ? 'text-app-primary' : 'text-app-primary'}`}
                          />
                          <span className="truncate">{entry.name}</span>
                          {isSelected ? (
                            <Icon name="check" className="w-4 h-4 ml-auto text-app-primary" />
                          ) : (
                            <Icon name="chevron-right" className="w-4 h-4 ml-auto text-app-text/40" />
                          )}
                        </button>
                      );
                    })
                  ) : (
                    !busy && <div className="px-3 py-6 text-center text-xs text-app-text/60">Empty folder</div>
                  ))}
                {busy && <div className="px-3 py-6 text-center text-xs text-app-text/60">Loading...</div>}
              </div>
            </div>
            {error && <p className="text-xs text-app-danger mt-2">{error}</p>}
          </div>

          {selectedPath ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-app-success/10 border border-app-success/30 text-xs text-app-success">
              <Icon name="check" className="w-4 h-4 shrink-0" />
              <span>
                Folder terpilih: <span className="font-mono">{selectedPath}</span> — klik{' '}
                <span className="font-semibold">Open</span> untuk memakainya langsung, atau{' '}
                <span className="font-semibold">Create</span> untuk membuat subfolder
                <span className="font-mono"> {name.trim() || '<nama>'}</span> di dalamnya.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-app-bg border border-app-border text-xs text-app-text">
              <Icon name="folder-open" className="w-4 h-4 shrink-0" />
              Buka folder tujuan dengan mengkliknya pada daftar di atas.
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-app-border bg-app-bg flex justify-end space-x-3">
          <button onClick={onClose} className="px-4 py-2 rounded text-app-text hover:text-white transition-colors text-sm">
            Cancel
          </button>
          <button
            onClick={openExisting}
            disabled={!selectedPath || creating || busy}
            className="px-4 py-2 rounded text-sm text-app-text bg-app-hover hover:bg-app-border transition-colors disabled:opacity-50 flex items-center gap-2"
            title="Pakai folder terpilih langsung sebagai workspace (folder tidak dibuat baru)"
          >
            <Icon name="folder-open" className="w-4 h-4" />
            Open
          </button>
          <button
            onClick={submit}
            disabled={!selectedPath || !name.trim() || creating || busy}
            className="px-4 py-2 rounded bg-app-primary hover:bg-indigo-600 text-white text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
            title="Buat folder baru <nama> di lokasi terpilih, lalu jadikan workspace"
          >
            {creating ? <Icon name="loader-2" className="w-4 h-4 animate-spin" /> : <Icon name="plus" className="w-4 h-4" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}