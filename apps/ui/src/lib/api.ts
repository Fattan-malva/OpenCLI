import type {
  AdapterCapabilities,
  AdapterInfo,
  AdapterSession,
  FsListResult,
  ProjectRecord,
  SystemSettings,
} from './types';

const TOKEN_KEY = 'opencli.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      detail = body?.error;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login(pin: string) {
    return request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ pin }) });
  },
  logout() {
    return request<{ success: boolean }>('/auth/logout', { method: 'POST' });
  },
  authStatus() {
    return request<{ authenticated: boolean }>('/auth/status');
  },
  changePin(currentPin: string, newPin: string) {
    return request<{ success: boolean }>('/auth/change-pin', {
      method: 'POST',
      body: JSON.stringify({ currentPin, newPin }),
    });
  },
  getSettings() {
    return request<SystemSettings>('/settings');
  },
  saveSettings(settings: Partial<SystemSettings>) {
    return request<{ success: boolean; settings: SystemSettings }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },
  listProjects() {
    return request<ProjectRecord[]>('/projects');
  },
  createProject(name: string, path: string) {
    return request<ProjectRecord>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, path }),
    });
  },
  deleteProject(id: string) {
    return request<{ success: boolean }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  fsList(path?: string) {
    return request<FsListResult>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`);
  },
  fsMkdir(parentPath: string, name: string) {
    return request<{ name: string; path: string; created: boolean }>('/fs/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path: parentPath, name }),
    });
  },
  listAdapters() {
    return request<AdapterInfo[]>('/adapters');
  },
  setAdapterActive(id: string, active: boolean) {
    return request<{ id: string; active: boolean }>(`/adapters/${encodeURIComponent(id)}/active`, {
      method: 'POST',
      body: JSON.stringify({ active }),
    });
  },
  getCapabilities(id: string, force = false) {
    return request<AdapterCapabilities>(`/adapters/${encodeURIComponent(id)}/capabilities${force ? '?force=1' : ''}`);
  },
  getProjectAdapterCapabilities(projectId: string, adapterId: string) {
    return request<AdapterCapabilities>(
      `/projects/${encodeURIComponent(projectId)}/adapters/${encodeURIComponent(adapterId)}/capabilities`,
    );
  },
  getModelRouting(projectId: string) {
    return request<Record<string, Record<string, { provider: string; model: string }>>>(
      `/projects/${encodeURIComponent(projectId)}/model-routing`,
    );
  },
  setModelRouting(
    projectId: string,
    agentId: string,
    modeId: string,
    provider: string,
    model: string,
  ) {
    return request<{
      routing: { projectId: string; agentId: string; modeId: string; provider: string; model: string; updatedAt: string };
      applied: boolean;
      applyError?: string;
    }>(
      `/projects/${encodeURIComponent(projectId)}/model-routing/${encodeURIComponent(agentId)}/${encodeURIComponent(modeId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ provider, model }),
      },
    );
  },
  setSessionMode(projectId: string, adapterId: string, mode: string) {
    return request<{ success: boolean; adapterId: string; mode: string }>(
      `/projects/${encodeURIComponent(projectId)}/sessions/mode`,
      {
        method: 'POST',
        body: JSON.stringify({ adapterId, mode }),
      },
    );
  },
  startSession(projectId: string, adapterId: string, adapterName?: string) {
    return request<AdapterSession>(`/projects/${encodeURIComponent(projectId)}/sessions/start`, {
      method: 'POST',
      body: JSON.stringify({ adapterId, adapterName }),
    });
  },
  stopSession(projectId: string, adapterId: string) {
    return request<{ success: boolean }>(`/projects/${encodeURIComponent(projectId)}/sessions/stop`, {
      method: 'POST',
      body: JSON.stringify({ adapterId }),
    });
  },
  listSessions(projectId: string) {
    return request<AdapterSession[]>(`/projects/${encodeURIComponent(projectId)}/sessions`);
  },
  startAllSessions(projectId: string) {
    return request<AdapterSession[]>(`/projects/${encodeURIComponent(projectId)}/sessions/start-all`, {
      method: 'POST',
    });
  },
  sendRuntimeCommand(projectId: string, adapterId: string, command: string) {
    return request<{ ok: boolean; output?: string }>(`/projects/${encodeURIComponent(projectId)}/sessions/runtime`, {
      method: 'POST',
      body: JSON.stringify({ adapterId, command }),
    });
  },
};