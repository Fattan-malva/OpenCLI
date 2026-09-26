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
  /** `provider/model` to the exact spec the CLI printed, for sending back. */
  specs: Record<string, string>;
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
export type ChatMessageStatus =
  | 'pending'
  | 'streaming'
  /** The agent stopped and is waiting for a person to answer. */
  | 'awaiting_input'
  | 'complete'
  | 'error'
  | 'interrupted';

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
  /** The single adapter this conversation talks to. */
  chatAdapterId?: string;
  /** That adapter's own primary mode, discovered from the CLI. */
  adapterMode?: string;
  interactionMode?: InteractionMode;
  planStatus?: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

/** Lifecycle of the plan attached to a conversation. */
export type PlanStatus = 'none' | 'generating' | 'ready' | 'approved' | 'executing' | 'completed';

/**
 * One thing the agent did, already translated by the server.
 *
 * The UI renders these directly. It does not look for glyphs, prefixes or
 * adapter-specific line formats, because a tool call that is stored as prose
 * cannot be collapsed, expanded or styled as a tool call.
 */
export type ConversationItem =
  | ConversationTextItem
  | ConversationToolItem
  | ConversationSkillItem
  | ConversationTodoItem
  | ConversationFileChangeItem
  | ConversationQuestionItem
  | ConversationPermissionItem
  | ConversationStatusItem
  | ConversationErrorItem;

export type ConversationItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ConversationTextItem {
  id: string;
  kind: 'message' | 'thinking';
  status: ConversationItemStatus;
  seq: number;
  text: string;
}

export interface ConversationToolItem {
  id: string;
  kind: 'tool';
  status: ConversationItemStatus;
  seq: number;
  name: string;
  input?: unknown;
  /** Resolved on the server for shell tools, so the UI does not re-derive it. */
  command?: string;
  output?: string;
  error?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  truncated?: boolean;
}

export interface ConversationSkillItem {
  id: string;
  kind: 'skill';
  status: ConversationItemStatus;
  seq: number;
  name: string;
  skillId?: string;
  detail?: string;
}

export interface ConversationTodoEntry {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: string;
}

export interface ConversationTodoItem {
  id: string;
  kind: 'todo';
  status: ConversationItemStatus;
  seq: number;
  items: ConversationTodoEntry[];
}

export interface ConversationFileChangeItem {
  id: string;
  kind: 'file_change';
  status: ConversationItemStatus;
  seq: number;
  path: string;
  action: 'created' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
  patch?: string;
}

export interface ConversationQuestionItem {
  id: string;
  kind: 'question';
  status: ConversationItemStatus;
  seq: number;
  requestId: string;
  question: string;
  options: { id: string; label: string; description?: string }[];
  multiple?: boolean;
  answer?: string;
}

export interface ConversationPermissionItem {
  id: string;
  kind: 'permission';
  status: ConversationItemStatus;
  seq: number;
  requestId: string;
  tool?: string;
  command?: string;
  detail?: string;
  answer?: string;
}

export interface ConversationStatusItem {
  id: string;
  kind: 'status';
  status: ConversationItemStatus;
  seq: number;
  label: string;
  detail?: string;
}

export interface ConversationErrorItem {
  id: string;
  kind: 'error';
  status: ConversationItemStatus;
  seq: number;
  message: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatMessageRole;
  agentId?: string;
  taskId?: string;
  /** The agent's prose only; tool calls and reasoning live in `items`. */
  text: string;
  status: ChatMessageStatus;
  meta?: ChatMessageMeta;
  /** Everything the agent did this turn, in the order it happened. */
  items?: ConversationItem[];
  request?: AdapterRequest;
  createdAt: string;
  updatedAt: string;
}
