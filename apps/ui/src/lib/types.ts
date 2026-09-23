export type PageId = 'workflow' | 'adapters' | 'models' | 'workspaces' | 'settings';
export type RightTab = 'todo' | 'logs' | 'context';
export type ToastType = 'info' | 'success' | 'error' | 'warning';
export type TaskStatus = 'PENDING' | 'READY' | 'RUNNING' | 'PAUSED' | 'ASK' | 'REVIEW' | 'BLOCKED' | 'COMPLETED' | 'FAILED';
export type AdapterRequestType = 'question' | 'permission' | 'choice';

export interface AdapterRequest {
  type: AdapterRequestType;
  message?: string;
  command?: string;
  options?: string[];
}

export interface Task {
  id: string;
  workflowId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string;
  mode: string;
  workspace: string;
  dependencies: string[];
  agentRequest?: AdapterRequest;
  agentDiff?: string[];
  liveOutput?: string;
  liveRequest?: AdapterRequest;
}

export interface AdapterMeta {
  name: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
}

export interface Workspace {
  id: string;
  branch: string;
  path: string;
  status: 'clean' | 'modified' | 'conflict';
  locks: string[];
}

export interface RouteConfig {
  provider: string;
  model: string;
}

export type AdapterConfigs = Record<string, { modes: Record<string, RouteConfig> }>;

export interface LogEntry {
  time: string;
  type: string;
  message: string | Record<string, unknown>;
  agentId?: string;
  taskId?: string;
}

export interface Toast {
  id: number;
  title: string;
  message: string;
  type: ToastType;
}

export interface GlobalStatus {
  text: string;
  color: 'indigo' | 'amber' | 'sky';
  icon: string;
  pulse: boolean;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  pathExists?: boolean;
  gitRepository?: string;
  defaultAgent?: string;
  defaultMode?: string;
  defaultModel?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemSettings {
  maxParallelAgents: number;
  defaultModePolicy: string;
  telemetry: boolean;
}

export interface FsEntry {
  name: string;
  path: string;
}

export interface FsListResult {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

export interface AdapterInfo {
  id: string;
  name: string;
  icon: string;
  homepage?: string;
  installed: boolean;
  version?: string;
  path?: string;
  executable: string;
  capabilities: string[];
  installCommands: string[];
  active: boolean;
}

export interface AdapterMode {
  id: string;
  name: string;
}

export interface ModeModelConfig {
  provider: string;
  model: string;
}

export interface AdapterCapabilities {
  modes: AdapterMode[];
  providers: string[];
  models: Record<string, string[]>;
  modeModels: Record<string, ModeModelConfig>;
  current: {
    provider: string;
    model: string;
    mode: string;
  };
  configPath?: string;
}

export interface AdapterSession {
  projectId: string;
  adapterId: string;
  adapterName: string;
  pid: number | null;
  status: 'starting' | 'running' | 'exited' | 'failed';
  startedAt: string;
  endedAt?: string;
  command?: string;
  error?: string;
  serverUrl?: string;
  sessionId?: string;
  activeMode?: string;
  activeProvider?: string;
  activeModel?: string;
}
export interface WorkflowRecord {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}
