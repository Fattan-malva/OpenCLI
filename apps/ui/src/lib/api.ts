import type {
  AdapterCapabilities,
  AgentManifest,
  AdapterInfo,
  AdapterSession,
  ChatMessage,
  ChatThread,
  ConfirmationPolicy,
  FsListResult,
  InteractionMode,
  ProjectRecord,
  SystemSettings,
  WorkflowRecord,
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
  /** Full manifest for one adapter: every mode, provider and model it reported. */
  getManifest(id: string, force = false) {
    return request<AgentManifest>(`/adapters/${encodeURIComponent(id)}/manifest${force ? '?force=1' : ''}`);
  },
  /** Manifests for every installed adapter in a single request. */
  getManifests(force = false) {
    return request<Record<string, AgentManifest>>(`/manifests${force ? '?force=1' : ''}`);
  },
  /** Drops the cache and re-probes the CLI. */
  refreshManifest(id: string) {
    return request<AgentManifest>(`/adapters/${encodeURIComponent(id)}/manifest/refresh`, { method: 'POST' });
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
  stopAllSessions(projectId: string) {
    return request<{ success: boolean }>(`/projects/${encodeURIComponent(projectId)}/sessions/stop-all`, {
      method: 'POST',
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
  listWorkflows(projectId: string) {
    return request<WorkflowRecord[]>(`/projects/${encodeURIComponent(projectId)}/workflows`);
  },
  createWorkflow(projectId: string, name: string, description?: string) {
    return request<WorkflowRecord>(`/projects/${encodeURIComponent(projectId)}/workflows`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  },
  getWorkflowTasks(workflowId: string) {
    return request<Array<{
      id: string;
      workflowId?: string;
      projectId: string;
      title: string;
      description?: string;
      status: string;
      priority: number;
      dependencies: string[];
      agentId?: string;
      modeId?: string;
      modelId?: string;
      workspaceId?: string;
      fileScopes: string[];
      retryCount: number;
      maxRetries: number;
      createdAt: string;
      updatedAt: string;
    }>>(`/workflows/${encodeURIComponent(workflowId)}/tasks`);
  },
  startWorkflow(workflowId: string) {
    return request<{ workflow: WorkflowRecord; stats: Record<string, unknown> }>(`/workflows/${encodeURIComponent(workflowId)}/start`, {
      method: 'POST',
    });
  },
  pauseWorkflow(workflowId: string) {
    return request<WorkflowRecord>(`/workflows/${encodeURIComponent(workflowId)}/pause`, { method: 'POST' });
  },
  resumeWorkflow(workflowId: string) {
    return request<WorkflowRecord>(`/workflows/${encodeURIComponent(workflowId)}/resume`, { method: 'POST' });
  },
  cancelWorkflow(workflowId: string) {
    return request<WorkflowRecord>(`/workflows/${encodeURIComponent(workflowId)}/cancel`, { method: 'POST' });
  },
  listEvents(projectId: string, limit = 200, workflowId?: string) {
    return request<Array<{
      id: string;
      type: string;
      projectId?: string;
      workflowId?: string;
      taskId?: string;
      agentId?: string;
      timestamp: string;
      payload: Record<string, unknown>;
    }>>(`/projects/${encodeURIComponent(projectId)}/events?limit=${Math.min(500, Math.max(1, limit))}${workflowId ? `&workflowId=${encodeURIComponent(workflowId)}` : ''}`);
  },

  listTasks(projectId: string) {
    return request<Array<{
      id: string;
      workflowId?: string;
      projectId: string;
      title: string;
      description?: string;
      status: string;
      priority: number;
      dependencies: string[];
      agentId?: string;
      modeId?: string;
      modelId?: string;
      workspaceId?: string;
      fileScopes: string[];
      retryCount: number;
      maxRetries: number;
      createdAt: string;
      updatedAt: string;
    }>>(`/projects/${encodeURIComponent(projectId)}/tasks`);
  },
  createTask(projectId: string, input: {
    title: string;
    description?: string;
    workflowId?: string;
    dependencies?: string[];
    agentId?: string;
    modeId?: string;
    modelId?: string;
    fileScopes?: string[];
    priority?: number;
  }) {
    return request<{
      id: string;
      workflowId?: string;
      projectId: string;
      title: string;
      description?: string;
      status: string;
      priority: number;
      dependencies: string[];
      agentId?: string;
      modeId?: string;
      modelId?: string;
      workspaceId?: string;
      fileScopes: string[];
      retryCount: number;
      maxRetries: number;
      createdAt: string;
      updatedAt: string;
    }>(`/projects/${encodeURIComponent(projectId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  sendRuntimeCommand(projectId: string, adapterId: string, command: string) {
    return request<{ ok: boolean; output?: string }>(`/projects/${encodeURIComponent(projectId)}/sessions/runtime`, {
      method: 'POST',
      body: JSON.stringify({ adapterId, command }),
    });
  },
  sendTaskInput(taskId: string, input: string) {
    return request<{ ok: boolean; output?: string }>(`/tasks/${encodeURIComponent(taskId)}/input`, {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
  },

  listChatThreads(projectId: string) {
    return request<ChatThread[]>(`/projects/${encodeURIComponent(projectId)}/chat`);
  },
  createChatThread(projectId: string, input: { title?: string; text?: string; adapterId?: string; mode?: string; interactionMode?: InteractionMode; confirmationPolicy?: ConfirmationPolicy }) {
    return request<{ thread: ChatThread; messages: ChatMessage[] }>(`/projects/${encodeURIComponent(projectId)}/chat`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  listChatMessages(projectId: string, threadId: string) {
    return request<ChatMessage[]>(
      `/projects/${encodeURIComponent(projectId)}/chat/${encodeURIComponent(threadId)}/messages`,
    );
  },
  sendChatMessage(projectId: string, threadId: string, input: { text: string; adapterId?: string; mode?: string; interactionMode?: InteractionMode; confirmationPolicy?: ConfirmationPolicy }) {
    return request<{ thread: ChatThread; messages: ChatMessage[] }>(
      `/projects/${encodeURIComponent(projectId)}/chat/${encodeURIComponent(threadId)}/messages`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },
  executeChatPlan(projectId: string, threadId: string) {
    return request<{ started: boolean; workflowId?: string; errors?: string[] }>(
      `/projects/${encodeURIComponent(projectId)}/chat/${encodeURIComponent(threadId)}/execute`,
      { method: 'POST' },
    );
  },
  stopChatThread(projectId: string, threadId: string) {
    return request<{ success: boolean; workflowId?: string }>(
      `/projects/${encodeURIComponent(projectId)}/chat/${encodeURIComponent(threadId)}/stop`,
      { method: 'POST' },
    );
  },
  deleteChatThread(projectId: string, threadId: string) {
    return request<{ success: boolean }>(
      `/projects/${encodeURIComponent(projectId)}/chat/${encodeURIComponent(threadId)}`,
      { method: 'DELETE' },
    );
  },
};