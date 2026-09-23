// Entity types based on 03-domain-model.md

export interface Project {
  id: string;
  name: string;
  path: string;
  gitRepository?: string;
  defaultAgent?: string;
  defaultMode?: string;
  defaultModel?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'active' | 'archived';

export interface Agent {
  id: string;
  name: string;
  executable: string;
  path?: string;
  version?: string;
  status: AgentStatus;
  capabilities: Capability[];
  modes: AgentMode[];
  adapterId: string;
  installed: boolean;
}

export type AgentStatus = 'discovered' | 'ready' | 'running' | 'error' | 'unavailable';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  credentialRef?: string;
}

export type ProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible';

export interface Model {
  id: string;
  providerId: string;
  name: string;
  contextWindow?: number;
  capabilities: Capability[];
  metadata?: Record<string, unknown>;
}

export interface Mode {
  id: string;
  name: string;
  permissions: PermissionSet;
  systemPolicy?: string;
  defaultModel?: string;
}

export interface Workflow {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  projectId: string;
  workflowId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: number;
  dependencies: string[];
  agentId?: string;
  modeId?: string;
  modelId?: string;
  workspaceId?: string;
  fileScopes: string[];
  requiredCapabilities?: string[];
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'paused'
  | 'failed'
  | 'blocked'
  | 'review'
  | 'completed'
  | 'cancelled';

export interface Workspace {
  id: string;
  projectId: string;
  taskId?: string;
  path: string;
  branch?: string;
  status: WorkspaceStatus;
  createdAt: string;
}

export type WorkspaceStatus = 'created' | 'active' | 'released' | 'conflict';

export interface Lock {
  id: string;
  projectId: string;
  resource: string;
  ownerType: LockOwnerType;
  ownerId: string;
  expiresAt?: string;
  createdAt: string;
}

export type LockOwnerType = 'task' | 'agent' | 'session';

export interface OpenCLIEvent {
  id: string;
  type: EventType;
  projectId?: string;
  taskId?: string;
  workflowId?: string;
  agentId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export type EventType =
  | 'agent.discovered'
  | 'agent.started'
  | 'agent.output'
  | 'agent.tool_called'
  | 'agent.file_changed'
  | 'agent.permission_requested'
  | 'agent.paused'
  | 'agent.resumed'
  | 'agent.stopped'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.crashed'
  | 'task.created'
  | 'task.ready'
  | 'task.started'
  | 'task.blocked'
  | 'task.completed'
  | 'task.failed'
  | 'task.retried'
  | 'task.cancelled'
  | 'workspace.created'
  | 'workspace.locked'
  | 'workspace.released'
  | 'workspace.conflict'
  | 'git.changed'
  | 'git.commit_created'
  | 'git.merge_conflict'
  | 'git.integrated'
  | 'workflow.created'
  | 'workflow.started'
  | 'workflow.paused'
  | 'workflow.resumed'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.cancelled'
  | 'installation.started'
  | 'installation.completed'
  | 'installation.failed';

export interface Session {
  id: string;
  agentId: string;
  taskId?: string;
  processId?: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
}

export type SessionStatus = 'running' | 'paused' | 'completed' | 'failed' | 'crashed';

export interface Artifact {
  id: string;
  taskId: string;
  type: ArtifactType;
  path: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type ArtifactType = 'file' | 'commit' | 'note' | 'test_result' | 'decision' | 'warning';

export interface Capability {
  id: string;
  name: string;
  description?: string;
}

export interface AgentMode {
  id: string;
  name: string;
  permissions: PermissionSet;
}

export interface PermissionSet {
  read: boolean;
  write: boolean;
  delete: boolean;
  terminal: boolean;
  network: boolean;
  git: boolean;
  install: boolean;
  system: boolean;
}

export interface PermissionClass {
  id: string;
  description: string;
}

export type ApprovalLevel = 'once' | 'task' | 'project' | 'global';

export interface CommandSpec {
  executable: string;
  arguments: string[];
  workingDirectory: string;
  environment: Record<string, string>;
  timeout?: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface DetectionResult {
  detected: boolean;
  executable?: string;
  path?: string;
  version?: string;
}

export interface HealthResult {
  healthy: boolean;
  message?: string;
}
