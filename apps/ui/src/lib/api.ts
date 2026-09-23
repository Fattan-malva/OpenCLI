import type { FsListResult, ProjectRecord, SystemSettings } from './types';

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
};