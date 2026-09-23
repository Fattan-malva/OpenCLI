// Types mirrored from @opencli/domain for frontend use

export interface Project {
  id: string;
  name: string;
  path: string;
  gitRepository?: string;
  defaultAgent?: string;
  defaultMode?: string;
  defaultModel?: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  executable: string;
  path?: string;
  version?: string;
  status: 'discovered' | 'ready' | 'running' | 'error' | 'unavailable';
  capabilities: { id: string; name: string }[];
  modes: { id: string; name: string }[];
  adapterId: string;
  installed: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: 'pending' | 'ready' | 'running' | 'paused' | 'failed' | 'blocked' | 'review' | 'completed' | 'cancelled';
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
}

export interface OpenCLIEvent {
  id: string;
  type: string;
  projectId?: string;
  taskId?: string;
  agentId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
