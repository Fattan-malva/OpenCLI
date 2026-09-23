export type PageId = 'workflow' | 'agents' | 'models' | 'workspaces';
export type RightTab = 'logs' | 'context';
export type ToastType = 'info' | 'success' | 'error' | 'warning';
export type TaskStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'ASK' | 'REVIEW' | 'COMPLETED' | 'FAILED';
export type AgentRequestType = 'question' | 'permission' | 'choice';

export interface AgentRequest {
  type: AgentRequestType;
  message?: string;
  command?: string;
  options?: string[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string;
  mode: string;
  workspace: string;
  dependencies: string[];
  agentRequest?: AgentRequest;
  agentDiff?: string[];
}

export interface AgentMeta {
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

export type AgentConfigs = Record<string, { modes: Record<string, RouteConfig> }>;

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