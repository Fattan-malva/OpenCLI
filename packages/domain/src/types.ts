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

/** How adapters cooperate for a chat prompt (user-driven, not AI-chosen). */
export type InteractionMode = 'ask' | 'plan' | 'agent';

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
  createdAt: string;
  updatedAt: string;
}

export type ChatMessageRole = 'user' | 'planner' | 'agent' | 'system';

export type ChatMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'interrupted';

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
  text: string;
  status: ChatMessageStatus;
  meta?: ChatMessageMeta;
  /** Permission/question the adapter is waiting on; shown instead of the reply box. */
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
