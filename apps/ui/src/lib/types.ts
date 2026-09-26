export type PageId = 'workspace' | 'adapters' | 'models' | 'workspaces' | 'settings';
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
  /** `primary` modes are user-selectable; `subagent` ones are orchestration targets. */
  type?: 'primary' | 'subagent';
  description?: string;
  /** Where the mode came from: the CLI's own listing, its help output, or a default. */
  source?: string;
}

export interface ModeModelConfig {
  provider: string;
  model: string;
  /** Exact spec to hand back to the CLI, when it differs from `provider/model`. */
  spec?: string;
}

export interface AdapterCapabilities {
  /** User-selectable primary agents, as reported by the CLI. */
  modes: AdapterMode[];
  /** Secondary agents the CLI exposes, shown in their own section. */
  subagents: AdapterMode[];
  providers: string[];
  models: Record<string, string[]>;
  modeModels: Record<string, ModeModelConfig>;
  current: {
    provider: string;
    model: string;
    mode: string;
  };
  configPath?: string;
  /** How the data was obtained (`cli`, `config`, `none`) and when. */
  source?: string;
  discoveredAt?: string;
  /** True when the adapter can host a native TUI on a PTY. */
  supportsInteractive?: boolean;
  /** Non-fatal problems hit while probing. */
  warnings?: string[];
}

export interface AgentModelEntry {
  /** Exact spec to send back to the CLI, verbatim as the CLI printed it. */
  id: string;
  name?: string;
  providerId: string;
  source?: string;
}

export interface AgentProviderEntry {
  id: string;
  name: string;
  models: string[];
  authenticated?: boolean;
  source?: string;
}

/**
 * Everything one installed CLI reported about itself.
 *
 * The UI renders this structure directly, which is what lets a new CLI appear
 * with no OpenCLI change.
 */
export interface AgentManifest {
  adapter: {
    id: string;
    name: string;
    version?: string;
    executable?: string;
    installed?: boolean;
  };
  modes: AdapterMode[];
  models: AgentModelEntry[];
  providers: AgentProviderEntry[];
  capabilities: { id: string; name: string }[];
  current?: { provider: string; model: string; mode: string };
  modeModels?: Record<string, { provider: string; model: string }>;
  supportsInteractive?: boolean;
  configPath?: string;
  source: string;
  discoveredAt: string;
  /** Populated when discovery failed; the rest of the manifest stays usable. */
  error?: string;
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

export type ChatMessageRole = 'user' | 'planner' | 'agent' | 'system';
export type ChatMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'interrupted';

export type InteractionMode = 'ask' | 'plan' | 'agent';
export type ConfirmationPolicy = 'default' | 'allowAll' | 'autoPilot';

export interface ChatMessageMeta {
  agent?: string;
  mode?: string;
  provider?: string;
  model?: string;
}

export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  workflowId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatMessageRole;
  agentId?: string;
  taskId?: string;
  text: string;
  status: ChatMessageStatus;
  meta?: ChatMessageMeta;
  request?: AdapterRequest;
  createdAt: string;
  updatedAt: string;
}
