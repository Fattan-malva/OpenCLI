import { useState, useEffect, useCallback } from 'react';
import type { Project, Agent, Task } from './types';

const API = '/api';

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function useSSE(url: string, onMessage: (data: any) => void) {
  useEffect(() => {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    es.onerror = () => { /* reconnect handled by EventSource */ };
    return () => es.close();
  }, [url, onMessage]);
}

export default function App() {
  const [page, setPage] = useState<'dashboard' | 'projects' | 'agents'>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load data
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [projs, ags] = await Promise.all([
        fetchJSON<Project[]>('/projects'),
        fetchJSON<Agent[]>('/agents'),
      ]);
      setProjects(projs);
      setAgents(ags);
      if (projs.length > 0 && !selectedProject) {
        setSelectedProject(projs[0].id);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => { load(); }, []);

  // Load tasks when project changes
  useEffect(() => {
    if (!selectedProject) return;
    fetchJSON<Task[]>(`/projects/${selectedProject}/tasks`)
      .then(setTasks)
      .catch(() => {});
  }, [selectedProject]);

  // SSE for live events
  useSSE('/events/stream', (event) => {
    setEvents((prev) => [event, ...prev].slice(0, 100));
  });

  const stats = {
    total: tasks.length,
    running: tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    pending: tasks.filter((t) => t.status === 'pending' || t.status === 'ready').length,
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 0, margin: 0, minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '12px 24px', borderBottom: '1px solid #222', background: '#111' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#fff' }}>OpenCLI</h1>
        <nav style={{ display: 'flex', gap: '8px' }}>
          {(['dashboard', 'projects', 'agents'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                background: page === p ? '#2563eb' : 'transparent',
                color: page === p ? '#fff' : '#888',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      <main style={{ padding: '24px' }}>
        {loading && <p style={{ color: '#666' }}>Loading...</p>}
        {error && <p style={{ color: '#ef4444' }}>Error: {error}</p>}

        {/* Dashboard */}
        {page === 'dashboard' && (
          <div>
            <h2 style={{ fontSize: '16px', marginBottom: '16px', color: '#fff' }}>Dashboard</h2>

            {/* Stats cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '24px' }}>
              {[
                { label: 'Total', value: stats.total, color: '#6b7280' },
                { label: 'Running', value: stats.running, color: '#2563eb' },
                { label: 'Completed', value: stats.completed, color: '#22c55e' },
                { label: 'Failed', value: stats.failed, color: '#ef4444' },
                { label: 'Pending', value: stats.pending, color: '#eab308' },
              ].map((s) => (
                <div key={s.label} style={{ background: '#161616', borderRadius: '8px', padding: '16px', border: '1px solid #222' }}>
                  <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>{s.label}</div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Agents */}
            <h3 style={{ fontSize: '14px', marginBottom: '12px', color: '#ccc' }}>Agents</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginBottom: '24px' }}>
              {agents.map((a) => (
                <div key={a.id} style={{ background: '#161616', borderRadius: '8px', padding: '12px', border: '1px solid #222' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: '#fff' }}>{a.name}</span>
                    <span style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '99px',
                      background: a.installed ? '#064e3b' : '#451a03',
                      color: a.installed ? '#34d399' : '#fbbf24',
                    }}>
                      {a.installed ? 'Installed' : 'Not found'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    {a.version ?? 'unknown'} &middot; {a.executable}
                  </div>
                </div>
              ))}
              {agents.length === 0 && <p style={{ color: '#555', fontSize: '13px' }}>No agents detected yet. Run discovery scan.</p>}
            </div>

            {/* Recent events */}
            <h3 style={{ fontSize: '14px', marginBottom: '12px', color: '#ccc' }}>Recent Activity</h3>
            <div style={{ background: '#161616', borderRadius: '8px', border: '1px solid #222', padding: '12px', maxHeight: '300px', overflow: 'auto' }}>
              {events.length === 0 && <p style={{ color: '#555', fontSize: '13px' }}>No events yet.</p>}
              {events.map((e, i) => (
                <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #1a1a1a', fontSize: '12px' }}>
                  <span style={{ color: '#666' }}>{e.timestamp?.split('T')[1]?.split('.')[0] ?? ''}</span>{' '}
                  <span style={{ color: '#2563eb' }}>{e.type}</span>{' '}
                  {e.agentId && <span style={{ color: '#a78bfa' }}>[{e.agentId}]</span>}
                  {e.taskId && <span style={{ color: '#fbbf24' }}>({e.taskId})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Projects */}
        {page === 'projects' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: '#fff' }}>Projects</h2>
              <button
                onClick={async () => {
                  const name = prompt('Project name:');
                  const path = prompt('Project path:');
                  if (name && path) {
                    await fetchJSON('/projects', { method: 'POST', body: JSON.stringify({ name, path }) });
                    load();
                  }
                }}
                style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: '13px' }}
              >
                + New Project
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {projects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => { setSelectedProject(p.id); setPage('dashboard'); }}
                  style={{ background: '#161616', borderRadius: '8px', padding: '16px', border: `1px solid ${selectedProject === p.id ? '#2563eb' : '#222'}`, cursor: 'pointer' }}
                >
                  <div style={{ fontWeight: 600, color: '#fff', marginBottom: '4px' }}>{p.name}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{p.path}</div>
                  <div style={{ fontSize: '11px', color: '#555', marginTop: '8px' }}>{p.status}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agents */}
        {page === 'agents' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: '#fff' }}>Agents</h2>
              <button
                onClick={async () => {
                  await fetchJSON('/discovery/scan', { method: 'POST' });
                  load();
                }}
                style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: '13px' }}
              >
                Scan for Agents
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {agents.map((a) => (
                <div key={a.id} style={{ background: '#161616', borderRadius: '8px', padding: '16px', border: '1px solid #222' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, color: '#fff' }}>{a.name}</span>
                    <span style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '99px',
                      background: a.status === 'ready' ? '#064e3b' : a.status === 'error' ? '#7f1d1d' : '#1e1e1e',
                      color: a.status === 'ready' ? '#34d399' : a.status === 'error' ? '#fca5a5' : '#888',
                    }}>
                      {a.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                    Executable: <span style={{ color: '#ccc' }}>{a.executable}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                    Version: <span style={{ color: '#ccc' }}>{a.version ?? 'unknown'}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#888' }}>
                    Path: <span style={{ color: '#ccc' }}>{a.path ?? 'N/A'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
