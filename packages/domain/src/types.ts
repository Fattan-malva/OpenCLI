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
  /** manual = created by the user in the kanban UI; chat = created by the planner agent. */
  kind?: TaskKind;
  /** True when the same prompt was sent to every running adapter (read-only plan run). */
  broadcast?: boolean;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}

export type TaskKind = 'manual' | 'chat';

/** Global confirmation behaviour for permission requests and plan review. */
export type ConfirmationPolicy = 'default' | 'allowAll' | 'autoPilot';

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
  | 'agent.question'
  | 'agent.confirmation_requested'
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
  | 'chat.thread_created'
  | 'chat.user_message'
  | 'chat.plan_ready'
  | 'chat.assistant_started'
  | 'chat.assistant_output'
  | 'chat.assistant_completed'
  | 'chat.assistant_failed'
  | 'chat.turn_interrupted'
  | 'chat.turn_item'
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

export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  /** Workflow auto-created by the planner for this conversation. */
  workflowId?: string;
  /**
   * The single adapter this conversation talks to.
   *
   * "Active" adapters and the "chat" adapter are different concepts: many
   * adapters can be active and available to a workflow while the conversation
   * itself is addressed to exactly one of them.
   */
  chatAdapterId?: string;
  /**
   * The adapter's own primary mode for this conversation, discovered from the
   * CLI rather than assumed. Kept separate from `interactionMode` so names like
   * "ask" or "plan" cannot be ambiguous between the two layers.
   */
  adapterMode?: string;
  /** OpenCLI-level operating mode for this conversation. */
  interactionMode?: InteractionMode;
  /** Where the plan lifecycle currently stands. */
  planStatus?: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * OpenCLI's own operating modes.
 *
 * These belong to OpenCLI, not to any adapter, so they are fixed. Everything an
 * adapter contributes (primary agents, subagents, models, providers) is
 * discovered from the CLI instead.
 */
export type InteractionMode = 'ask' | 'plan' | 'agent';

/** Lifecycle of the plan attached to a conversation. */
export type PlanStatus =
  | 'none'
  | 'generating'
  | 'ready'
  | 'approved'
  | 'executing'
  | 'completed';

/**
 * One resolved chat target.
 *
 * `interactionMode` decides *how* the work is handled; `adapterId` and
 * `adapterMode` decide *who* handles it. Keeping them apart stops an adapter
 * mode name from being mistaken for an OpenCLI interaction mode.
 */
export interface ChatExecution {
  interactionMode: InteractionMode;
  /** The one adapter this message is addressed to. */
  adapterId: string;
  /** That adapter's own primary mode. */
  adapterMode?: string;
  /** Workflow created by a plan, when the interaction produced one. */
  workflowId?: string;
  planStatus?: PlanStatus;
}

export type ChatMessageRole = 'user' | 'planner' | 'agent' | 'system';

/**
 * Where a message is in its lifecycle.
 *
 * `awaiting_input` is distinct from `streaming`: the agent stopped and is
 * waiting for a person, so the reply box belongs to a question or a permission
 * rather than to a new message.
 */
export type ChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'awaiting_input'
  | 'complete'
  | 'error'
  | 'interrupted';

/**
 * What one thing the agent did looks like in the conversation.
 *
 * These are the only shapes the chat UI renders. An adapter's own output is
 * translated into them by the protocol layer, so the UI never has to recognise
 * a line, a glyph or a CLI's private format.
 */
export type ConversationItemKind =
  | 'message'
  | 'thinking'
  | 'tool'
  | 'skill'
  | 'todo'
  | 'file_change'
  | 'question'
  | 'permission'
  | 'status'
  | 'error';

export type ConversationItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ConversationTextItem {
  id: string;
  kind: 'message' | 'thinking';
  status: ConversationItemStatus;
  seq: number;
  text: string;
}

/**
 * What an adapter reported about one tool call.
 *
 * `status` is the adapter's own state string, kept verbatim so the conversation
 * can show what the CLI said instead of inferring completion.
 */
export interface ConversationToolData {
  name: string;
  status?: string;
  input?: unknown;
  /** Tool stdout / result. Present for anything that produced output. */
  output?: string;
  error?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationToolItem {
  id: string;
  kind: 'tool';
  status: ConversationItemStatus;
  seq: number;
  name: string;
  /** Real arguments, kept structured rather than stringified into a label. */
  input?: unknown;
  /** Pre-resolved for shell tools so the UI does not re-derive it per render. */
  command?: string;
  /** Tool stdout / result. Present for anything that produced output. */
  output?: string;
  error?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  /** True when `output` was clipped to the stored limit. */
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
  /** Empty when the agent asked freely; the UI then offers a text answer. */
  options: { id: string; label: string; description?: string }[];
  multiple?: boolean;
  /** What the person answered, kept so the transcript shows the resolution. */
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
  /** Whether it was allowed or refused, once resolved. */
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

/** A choice the agent offered, so the UI renders buttons rather than prose. */
export interface AgentOption {
  id: string;
  label: string;
  description?: string;
}


export interface ChatMessageMeta {
  agent?: string;
  mode?: string;
  provider?: string;
  model?: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatMessageRole;
  /** Adapter id for planner/agent messages. */
  agentId?: string;
  /** Workflow task this message belongs to (agent replies). */
  taskId?: string;
  /**
   * The assistant's prose only.
   *
   * Tool calls, reasoning and status are not part of this: they live in `items`
   * so a reader of the text gets the answer, not a transcript of the work.
   */
  text: string;
  status: ChatMessageStatus;
  meta?: ChatMessageMeta;
  /** Structured turn content, already folded from protocol events. */
  items?: ConversationItem[];
  /**
   * Permission/question the adapter is waiting on; shown instead of the reply
   * box. Kept alongside `items` so a pending request survives a reload even if
   * the item list is trimmed.
   */
  request?: ChatRequest;
  createdAt: string;
  updatedAt: string;
}

/** Structured request surfaced inside a chat bubble. */
export interface ChatRequest {
  type: 'question' | 'permission' | 'choice';
  message: string;
  command?: string;
  options?: string[];
  /** Correlates the answer with the control request that is waiting. */
  requestId?: string;
}

/** Plan step produced by the planner agent. */
export interface PlanStep {
  title: string;
  description?: string;
  agentId?: string;
  modeId?: string;
  fileScopes?: string[];
  /** Zero-based indexes into the same step list. */
  dependsOn?: number[];
}

export interface ExecutionPlan {
  steps: PlanStep[];
}

/**
 * Planner v3 decision: the planner only produces a step (Todo) list. Ask/Plan/Agent
 * is decided by the user, never by the model.
 */
export interface PlannerDecision {
  steps: PlanStep[];
  reason?: string;
}

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

/**
 * Whether an agent is offered to the user as a selectable mode.
 *
 * This is an OpenCLI-wide contract, not an adapter-specific concept. Every
 * agent CLI that reports `name (primary|subagent)` maps onto it, and OpenCLI
 * never needs to know which CLI an agent came from.
 */
export type AgentType = 'primary' | 'subagent';

/** Where a manifest value came from, so the UI can explain stale data. */
export type ManifestSource = 'runtime' | 'cli' | 'config' | 'declared' | 'none';

export interface AgentMode {
  id: string;
  name: string;
  /**
   * `primary` modes are user-selectable; `subagent` modes are invoked by an
   * agent rather than by a person. Defaults to `primary` so pre-existing
   * callers keep working.
   */
  type?: AgentType;
  description?: string;
  /**
   * Permission hints. Optional because discovered modes report whatever the
   * CLI exposes, and some CLIs expose no permission model at all.
   */
  permissions?: PermissionSet;
  /** True for the mode the CLI itself preselects. */
  default?: boolean;
  /** Free-form capability tags reported by the adapter. */
  capabilities?: string[];
  source?: ManifestSource;
}

export interface AgentModel {
  /**
   * Exact spec to hand back to the CLI, verbatim as the CLI printed it.
   *
   * Nothing may normalise this. Kilo prints `kilo/~anthropic/claude-opus-latest`
   * and rejects the shortened form, so `id` is what gets sent to the CLI.
   */
  id: string;
  /** Human readable model name, with any provider prefix removed. */
  name?: string;
  /** Grouping key for the UI, derived from the spec's provider segment. */
  providerId: string;
  capabilities?: Capability[];
  source?: ManifestSource;
}

export interface AgentProvider {
  id: string;
  name: string;
  models: string[];
  /** Whether the adapter believes credentials are present. */
  authenticated?: boolean;
  source?: ManifestSource;
}

export interface AdapterInfo {
  id: string;
  name: string;
  version?: string;
  executable?: string;
  /** False when the adapter is registered but its CLI is not on PATH. */
  installed?: boolean;
}

/**
 * Everything OpenCLI knows about one installed adapter, reported by the
 * adapter itself rather than declared in OpenCLI.
 *
 * The UI renders this structure directly, which is what allows a new adapter
 * to appear with no OpenCLI change.
 */
export interface AgentManifest {
  adapter: AdapterInfo;
  modes: AgentMode[];
  models: AgentModel[];
  providers: AgentProvider[];
  capabilities: Capability[];
  /** Model currently selected by the CLI or project routing. */
  current?: { provider: string; model: string; mode: string };
  /** Per-mode model selection as reported by the CLI or its config. */
  modeModels?: Record<string, { provider: string; model: string }>;
  /** True when the adapter can host a native TUI on a PTY. */
  supportsInteractive?: boolean;
  configPath?: string;
  source: ManifestSource;
  discoveredAt: string;
  /** Populated when discovery failed; the rest of the manifest stays usable. */
  error?: string;
}

/**
 * Declarative description of how to interrogate one CLI.
 *
 * This is data, not branching: the discovery engine picks strategies from
 * these fields, so no core code needs `if (adapter === 'kilo')`.
 */
export interface DiscoveryPlan {
  /** Arguments for the subcommand that lists agents, e.g. `['agent','list']`. */
  agentListArgs?: string[];
  /** Arguments for the subcommand that lists models, e.g. `['models']`. */
  modelsArgs?: string[];
  /**
   * A provider prefix the CLI puts in front of every model it lists, e.g. Kilo
   * prints `kilo/~anthropic/...`. Stripping it before grouping exposes the real
   * providers; the full spec is still preserved for sending back.
   */
  modelPrefix?: string;
  /** Arguments used to scrape declared choices from help output. */
  helpArgs?: string[];
  /**
   * Flag whose enumerated choices describe the agent modes, e.g.
   * `--permission-mode`. Only consulted when the CLI has no agent listing
   * command.
   */
  choiceFlag?: string;
  /** Agent ids that exist for CLI internals and must not be offered. */
  hiddenAgents?: string[];
  /** Set when the CLI can serve a live HTTP catalog. */
  supportsServe?: boolean;
  /** Per-probe timeouts in milliseconds. */
  timeouts?: { agentList?: number; models?: number; help?: number };
}

export interface DiscoveryContext {
  adapterId: string;
  executable: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Skip caches and re-probe. */
  force?: boolean;
  /** Project id, for project-scoped config lookups. */
  projectId?: string;
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
