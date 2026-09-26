import type { EventBus } from '@opencli/events';
import type { OpenCLIRepository } from '@opencli/db';
import type { Scheduler } from '@opencli/scheduler';
import type { ChatMessage, ChatThread, ConfirmationPolicy, InteractionMode, PlanStep, PlannerDecision, Task } from '@opencli/domain';
import { getSessionAgentModes, getSession, listSessions, setSessionMode, abortSessionTurn } from './sessions.js';
import { runAgentTurn, type ChatRuntimeDeps } from './chatRuntime.js';
import { assignDefaultAgents, buildPlannerPrompt, parsePlannerDecision } from './planner.js';
import { resolvedConfirmationPolicy, resolvedInteractionMode } from './settings.js';
import { refreshWorkflow, type WorkflowRuntime } from './workflow.js';
import { getManifest, probeCapabilities } from './cli.js';
import { primaryModes } from '@opencli/discovery';

export interface ChatDeps extends ChatRuntimeDeps {
  scheduler: Scheduler;
  workflowRuntime: WorkflowRuntime;
}

const MENTION_PATTERN = /@([a-z0-9_-]+)(?:\/([a-z0-9_-]+))?/i;

export function parseMention(text: string, knownAdapterIds: string[]): { targetAdapterId?: string; mode?: string; text: string } {
  const match = text.match(MENTION_PATTERN);
  if (!match) return { text };

  const mentioned = match[1].toLowerCase();
  const target = knownAdapterIds.find((id) => id.toLowerCase() === mentioned)
    ?? knownAdapterIds.find((id) => id.toLowerCase().startsWith(mentioned));
  if (!target) return { text };

  const mode = match[2] ? match[2].toLowerCase() : undefined;
  return { targetAdapterId: target, mode, text: text.replace(MENTION_PATTERN, '').trim() };
}

function threadTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return 'New Chat';
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

function runningAgents(projectId: string): string[] {
  return listSessions(projectId)
    .filter((session) => session.status === 'running')
    .map((session) => session.adapterId);
}

export function listThreads(deps: ChatDeps, projectId: string): ChatThread[] {
  return deps.db.listChatThreads(projectId);
}

export function listMessages(deps: ChatDeps, threadId: string): ChatMessage[] {
  return deps.db.listChatMessages(threadId);
}

export function createThread(deps: ChatDeps, projectId: string, title: string): ChatThread {
  const thread = deps.db.createChatThread({ projectId, title: threadTitle(title) });
  void deps.eventBus.emit({
    type: 'chat.thread_created',
    projectId,
    payload: { threadId: thread.id, title: thread.title },
  });
  return thread;
}

export function deleteThread(deps: ChatDeps, threadId: string): boolean {
  const thread = deps.db.getChatThread(threadId);
  if (!thread) return false;
  if (thread.workflowId) deps.scheduler.cancelWorkflow(thread.workflowId);
  return deps.db.deleteChatThread(threadId);
}

export function stopThread(deps: ChatDeps, threadId: string): { stopped: boolean; workflowId?: string } {
  const thread = deps.db.getChatThread(threadId);
  if (!thread) return { stopped: false };

  if (thread.workflowId) {
    deps.scheduler.cancelWorkflow(thread.workflowId);
    for (const task of deps.db.listWorkflowTasks(thread.workflowId)) {
      if (task.status === 'pending' || task.status === 'ready' || task.status === 'paused') {
        deps.db.updateTask(task.id, { status: 'cancelled' });
      }
    }
    deps.db.updateWorkflow(thread.workflowId, { status: 'cancelled' });
  }

  for (const message of deps.db.listChatMessages(threadId)) {
    if (message.status === 'streaming' || message.status === 'pending') {
      if (message.agentId) {
        void abortSessionTurn(thread.projectId, message.agentId);
      }
      deps.db.updateChatMessage(message.id, { status: 'interrupted' });
      void deps.eventBus.emit({
        type: 'chat.turn_interrupted',
        projectId: thread.projectId,
        taskId: message.taskId,
        agentId: message.agentId,
        payload: { threadId, messageId: message.id, agentId: message.agentId, reason: 'stopped-by-user' },
      });
    }
  }

  return { stopped: true, workflowId: thread.workflowId };
}

function systemMessage(deps: ChatDeps, thread: ChatThread, text: string): ChatMessage {
  const message = deps.db.createChatMessage({ threadId: thread.id, role: 'system', text, status: 'complete' });
  void deps.eventBus.emit({
    type: 'chat.user_message',
    projectId: thread.projectId,
    payload: { threadId: thread.id, messageId: message.id, role: 'system', text },
  });
  return message;
}

function userMessage(deps: ChatDeps, thread: ChatThread, text: string): ChatMessage {
  const message = deps.db.createChatMessage({ threadId: thread.id, role: 'user', text, status: 'complete' });
  void deps.eventBus.emit({
    type: 'chat.user_message',
    projectId: thread.projectId,
    payload: { threadId: thread.id, messageId: message.id, role: 'user', text },
  });
  return message;
}

function agentMessage(
  deps: ChatDeps,
  thread: ChatThread,
  opts: { role: 'planner' | 'agent'; adapterId: string; adapterName?: string; taskId?: string; label?: string },
): ChatMessage {
  const message = deps.db.createChatMessage({
    threadId: thread.id,
    role: opts.role,
    agentId: opts.adapterId,
    taskId: opts.taskId,
    text: opts.label ? `${opts.label}\n` : '',
    status: 'pending',
  });
  void deps.eventBus.emit({
    type: 'chat.assistant_started',
    projectId: thread.projectId,
    taskId: opts.taskId,
    agentId: opts.adapterId,
    payload: {
      threadId: thread.id,
      messageId: message.id,
      adapterId: opts.adapterId,
      adapterName: opts.adapterName,
      taskId: opts.taskId,
      role: opts.role,
    },
  });
  return message;
}

/**
 * Primary modes an adapter can be driven in, best source first.
 *
 * A live session knows its own agents best; otherwise the adapter's manifest is
 * asked directly. Only when the CLI publishes nothing does this stay empty,
 * because inventing mode names would produce commands the CLI rejects.
 */
async function agentModes(projectId: string, adapterId: string): Promise<string[]> {
  const runtimeModes = await getSessionAgentModes(projectId, adapterId);
  if (runtimeModes.length > 0) return runtimeModes.map((mode) => mode.id);

  try {
    const manifest = await getManifest(adapterId);
    const primary = primaryModes(manifest?.modes ?? []);
    if (primary.length > 0) return primary.map((mode) => mode.id);
  } catch {
    /* fall through to an empty list */
  }
  return [];
}

/** The mode a chat turn should use, never a hardcoded name. */
async function resolveAdapterMode(
  projectId: string,
  adapterId: string,
  requested?: string,
): Promise<string | undefined> {
  if (requested) return requested;
  const modes = await agentModes(projectId, adapterId);
  return modes[0];
}

/**
 * Model selection for a mode, with the exact CLI spec resolved.
 *
 * A routing stored before the spec column existed only has provider + model,
 * and concatenating those produces something the CLI rejects
 * (`default/big-pickle` instead of `opencode/big-pickle`). So when the stored row
 * has no spec, it is looked up in the adapter's live catalog before use. This
 * makes the lookup self-healing rather than depending on stored state.
 */
async function routingModel(
  db: OpenCLIRepository,
  projectId: string,
  adapterId: string,
  mode: string,
): Promise<{ provider: string; model: string; spec?: string } | undefined> {
  const stored = db.listModelRoutings(projectId)[adapterId]?.[mode];
  if (!stored) return undefined;
  if (stored.spec) return stored;

  try {
    const capabilities = await probeCapabilities(adapterId);
    const spec = capabilities.specs?.[`${stored.provider}/${stored.model}`];
    if (spec) return { ...stored, spec };
  } catch {
    /* fall through */
  }

  // The selection cannot be expressed in a form the CLI is guaranteed to
  // accept, so it is not forced. Sending `default/big-pickle` where the CLI
  // expects `opencode/big-pickle` only produces "Model not found"; deferring to
  // the CLI's own configured model is better than failing the turn.
  return undefined;
}/**
 * Turns planner steps into a workflow of tasks.
 *
 * `assignable` is the pool a step may be given to. Plan mode passes only the
 * chat adapter so the whole plan stays with one agent; Agent mode passes every
 * running adapter so the graph spreads across the team.
 */
export function createWorkflowForPlan(
  deps: ChatDeps,
  thread: ChatThread,
  userText: string,
  steps: PlanStep[],
  assignable: string[],
  start: boolean,
  defaultMode?: string,
): { workflowId: string; taskIds: string[] } {
  const workflow = deps.db.createWorkflow({
    projectId: thread.projectId,
    name: threadTitle(userText),
    description: 'Auto-generated from a chat prompt by the planner agent.',
    status: start ? 'running' : 'draft',
  });

  void deps.eventBus.emit({
    type: 'workflow.created',
    projectId: thread.projectId,
    workflowId: workflow.id,
    payload: { workflowId: workflow.id, name: workflow.name, source: 'chat', threadId: thread.id },
  });

  const assigned = assignDefaultAgents(steps, assignable);
  const created: string[] = [];

  assigned.forEach((step, index) => {
    // Prefer the planner's own choice, then spread across the assignable set so
    // parallel steps land on different adapters instead of piling onto one.
    const agentId =
      step.agentId && assignable.includes(step.agentId)
        ? step.agentId
        : assignable[index % assignable.length];
    const task = deps.db.createTask({
      projectId: thread.projectId,
      workflowId: workflow.id,
      title: step.title,
      description: step.description,
      status: 'pending',
      priority: assigned.length - index,
      dependencies: (step.dependsOn ?? [])
        .map((dependency) => created[dependency])
        .filter((id): id is string => Boolean(id)),
      agentId,
      modeId: step.modeId ?? defaultMode,
      fileScopes: step.fileScopes ?? [],
      kind: 'chat',
      retryCount: 0,
      maxRetries: 1,
    });
    created.push(task.id);

    agentMessage(deps, thread, {
      role: 'agent',
      adapterId: agentId,
      taskId: task.id,
      label: `Step ${index + 1}/${assigned.length}: ${step.title}`,
    });

    void deps.eventBus.emit({
      type: 'task.created',
      projectId: thread.projectId,
      workflowId: workflow.id,
      taskId: task.id,
      agentId,
      payload: { workflowId: workflow.id, taskId: task.id, title: step.title, agentId, source: 'chat' },
    });
  });

  deps.db.updateWorkflow(workflow.id, { status: start ? 'running' : 'draft' });
  deps.db.updateChatThread(thread.id, { workflowId: workflow.id });

  return { workflowId: workflow.id, taskIds: created };
}


export interface SendChatOptions {
  projectId: string;
  threadId: string;
  text: string;
  targetAdapterId?: string;
  mode?: string;
  interactionMode?: InteractionMode;
  confirmationPolicy?: ConfirmationPolicy;
}

interface PreparedMessage {
  thread: ChatThread;
  prompt: string;
  targetAdapterId?: string;
  mode?: string;
  interactionMode?: InteractionMode;
  confirmationPolicy?: ConfirmationPolicy;
  rejected?: boolean;
}

function prepareMessage(deps: ChatDeps, options: SendChatOptions): PreparedMessage {
  const thread = deps.db.getChatThread(options.threadId);
  if (!thread) throw new Error('Chat thread not found');

  const project = deps.db.getProject(options.projectId);
  if (!project) throw new Error('Project not found');

  const running = runningAgents(options.projectId);
  const mention = options.targetAdapterId
    ? { targetAdapterId: options.targetAdapterId, mode: options.mode, text: options.text.trim() }
    : parseMention(options.text, running);

  const prompt = mention.text.trim();
  if (!prompt) {
    systemMessage(deps, thread, 'Empty message. Tell the agents what to do.');
    return { thread, prompt: '', rejected: true };
  }

  userMessage(deps, thread, prompt);
  return {
    thread,
    prompt,
    targetAdapterId: mention.targetAdapterId,
    mode: mention.mode,
    interactionMode: resolvedInteractionMode(options.interactionMode),
    confirmationPolicy: resolvedConfirmationPolicy(options.confirmationPolicy),
  };
}

export function acceptChatMessage(deps: ChatDeps, options: SendChatOptions): { thread: ChatThread; messages: ChatMessage[] } {
  const prepared = prepareMessage(deps, options);
  if (!prepared.rejected) {
    void processChatMessage(deps, {
      projectId: options.projectId,
      thread: prepared.thread,
      prompt: prepared.prompt,
      targetAdapterId: prepared.targetAdapterId,
      mode: prepared.mode,
      interactionMode: prepared.interactionMode,
      confirmationPolicy: prepared.confirmationPolicy,
    }).catch((error: any) => {
      systemMessage(deps, prepared.thread, `Chat dispatch failed: ${error?.message ?? 'unknown error'}`);
    });
  }
  return {
    thread: deps.db.getChatThread(options.threadId) ?? prepared.thread,
    messages: deps.db.listChatMessages(options.threadId),
  };
}

export async function sendChatMessage(deps: ChatDeps, options: SendChatOptions): Promise<{ thread: ChatThread; messages: ChatMessage[] }> {
  const prepared = prepareMessage(deps, options);
  if (!prepared.rejected) {
    await processChatMessage(deps, {
      projectId: options.projectId,
      thread: prepared.thread,
      prompt: prepared.prompt,
      targetAdapterId: prepared.targetAdapterId,
      mode: prepared.mode,
      interactionMode: prepared.interactionMode,
      confirmationPolicy: prepared.confirmationPolicy,
    });
  }
  return {
    thread: deps.db.getChatThread(options.threadId) ?? prepared.thread,
    messages: deps.db.listChatMessages(options.threadId),
  };
}

/**
 * Resolves which single adapter a chat message is addressed to.
 *
 * Precedence: an explicit target, then the thread's remembered chat adapter,
 * then the first running adapter. A mention still wins because the user typed
 * it deliberately.
 */
function resolveChatAdapter(
  thread: ChatThread,
  running: string[],
  requested?: string,
): string | undefined {
  if (requested && running.includes(requested)) return requested;
  if (thread.chatAdapterId && running.includes(thread.chatAdapterId)) return thread.chatAdapterId;
  return running[0];
}

async function processChatMessage(
  deps: ChatDeps,
  input: {
    projectId: string;
    thread: ChatThread;
    prompt: string;
    targetAdapterId?: string;
    mode?: string;
    interactionMode?: InteractionMode;
    confirmationPolicy?: ConfirmationPolicy;
  },
): Promise<void> {
  const { projectId, thread, prompt } = input;
  const project = deps.db.getProject(projectId);
  if (!project) return;

  const running = runningAgents(projectId);
  const interactionMode = resolvedInteractionMode(input.interactionMode);
  const confirmationPolicy = resolvedConfirmationPolicy(input.confirmationPolicy);

  if (running.length === 0) {
    systemMessage(
      deps,
      thread,
      'No adapter session is running. Start one on the Adapters page first, then send your message again.',
    );
    return;
  }

  // Exactly one adapter owns this conversation. "Active" (many) and "chat
  // target" (one) are deliberately different concepts.
  const adapterId = resolveChatAdapter(thread, running, input.targetAdapterId);
  if (!adapterId) {
    systemMessage(deps, thread, 'No running adapter is available to chat with.');
    return;
  }

  const adapterMode = await resolveAdapterMode(projectId, adapterId, input.mode);

  deps.db.updateChatThread(thread.id, {
    chatAdapterId: adapterId,
    ...(adapterMode ? { adapterMode } : {}),
    interactionMode,
  });

  // An explicit target that is not running is a user mistake worth reporting,
  // rather than silently rerouting to somebody else.
  if (input.targetAdapterId && !running.includes(input.targetAdapterId)) {
    systemMessage(
      deps,
      thread,
      `${input.targetAdapterId} is not running. Start its session on the Adapters page first.`,
    );
    return;
  }

  // --- Ask: one adapter answers, nothing is orchestrated, no task is created.
  if (interactionMode === 'ask') {
    const message = agentMessage(deps, thread, { role: 'agent', adapterId });
    deps.db.updateChatThread(thread.id, { planStatus: 'none' });
    await runAgentTurn(deps, {
      projectId,
      threadId: thread.id,
      adapterId,
      messageId: message.id,
      text: prompt,
      mode: adapterMode ?? '',
      model: adapterMode ? await routingModel(deps.db, projectId, adapterId, adapterMode) : undefined,
      policy: confirmationPolicy,
    });
    return;
  }

  // --- Plan and Agent both go through the planner, run by the chat adapter
  // itself. No other adapter participates in producing the plan.
  deps.db.updateChatThread(thread.id, { planStatus: 'generating' });

  const existingWorkflow = thread.workflowId ? deps.db.getWorkflow(thread.workflowId) : undefined;
  if (existingWorkflow && ['draft', 'running', 'paused'].includes(existingWorkflow.status)) {
    const start = interactionMode === 'agent' && existingWorkflow.status === 'draft';
    await appendChatTodo(deps, thread, project, prompt, running, start, adapterId);
    return;
  }

  const { decision, plannerMessage } = await planDecision(
    deps,
    thread,
    project,
    prompt,
    running,
    confirmationPolicy,
    adapterId,
  );
  const steps = decision.steps ?? [];
  if (steps.length === 0) {
    deps.db.updateChatThread(thread.id, { planStatus: 'none' });
    deps.db.updateChatMessage(plannerMessage.id, {
      status: 'error',
      text: `${plannerMessage.text}\n\nCould not read a valid plan from this reply. Ask again, or mention an adapter directly (for example @${adapterId}).`,
    });
    void deps.eventBus.emit({
      type: 'chat.assistant_failed',
      projectId,
      agentId: plannerMessage.agentId,
      payload: { threadId: thread.id, messageId: plannerMessage.id, error: 'Planner reply did not contain a valid JSON plan' },
    });
    return;
  }

  const start = interactionMode === 'agent';
  // Plan keeps every step on the chat adapter. Agent lets the router spread the
  // graph across the active adapters, which is the only multi-adapter path.
  const assignable = start ? running : [adapterId];
  const { workflowId, taskIds } = createWorkflowForPlan(deps, thread, prompt, steps, assignable, start, adapterMode);

  deps.db.appendChatMessageText(plannerMessage.id, `\n\nWorkflow created with ${taskIds.length} step${taskIds.length === 1 ? '' : 's'}.`);
  void deps.eventBus.emit({
    type: 'chat.assistant_completed',
    projectId,
    workflowId,
    agentId: plannerMessage.agentId,
    payload: { threadId: thread.id, messageId: plannerMessage.id, workflowId, steps: taskIds.length },
  });

  if (!start) {
    deps.db.updateChatThread(thread.id, { planStatus: 'ready' });
    void deps.eventBus.emit({
      type: 'chat.plan_ready',
      projectId,
      workflowId,
      payload: { workflowId, threadId: thread.id, steps: taskIds.length },
    });
    systemMessage(
      deps,
      thread,
      `Plan ready with ${taskIds.length} step${taskIds.length === 1 ? '' : 's'}, all assigned to ${adapterId}. Nothing has run yet — review the todos on the Workflow board and execute, or switch to Agent mode to route them across your active adapters.`,
    );
    return;
  }

  deps.db.updateChatThread(thread.id, { planStatus: 'executing' });
  deps.scheduler.loadTasks(deps.db.listWorkflowTasks(workflowId));
  const startedResult = await deps.scheduler.startWorkflow(workflowId);
  if (!startedResult.started) {
    systemMessage(deps, thread, `The plan was created but could not start: ${startedResult.errors.join('; ')}`);
    return;
  }

  void deps.eventBus.emit({
    type: 'workflow.started',
    projectId,
    workflowId,
    payload: { workflowId, source: 'chat', threadId: thread.id },
  });
  refreshWorkflow(deps.workflowRuntime, workflowId);
}

async function planDecision(
  deps: ChatDeps,
  thread: ChatThread,
  project: { id: string; name: string; path: string },
  prompt: string,
  running: string[],
  confirmationPolicy: ConfirmationPolicy,
  plannerAdapterId: string,
): Promise<{ decision: PlannerDecision; plannerMessage: ChatMessage }> {
  const plannerMessage = agentMessage(deps, thread, {
    role: 'planner',
    adapterId: plannerAdapterId,
    label: `Planning with ${plannerAdapterId}...`,
  });

  // The planner is the chat adapter itself, not "whoever happens to be first",
  // so the plan is produced by the agent the user is talking to.
  const planningMode = (await agentModes(project.id, plannerAdapterId)).includes('plan')
    ? 'plan'
    : await resolveAdapterMode(project.id, plannerAdapterId);
  if (planningMode) await setSessionMode(project.id, plannerAdapterId, planningMode);

  const roster = await Promise.all(
    running.map(async (adapterId) => ({
      id: adapterId,
      name: getSession(project.id, adapterId)?.adapterName ?? adapterId,
      modes: await agentModes(project.id, adapterId),
    })),
  );

  const plannerPrompt = buildPlannerPrompt(prompt, {
    projectName: project.name,
    projectPath: project.path,
    agents: roster,
  });

  const planResult = await runAgentTurn(deps, {
    projectId: project.id,
    threadId: thread.id,
    adapterId: plannerAdapterId,
    messageId: plannerMessage.id,
    text: plannerPrompt,
    mode: planningMode ?? '',
    model: planningMode ? await routingModel(deps.db, project.id, plannerAdapterId, planningMode) : undefined,
    policy: confirmationPolicy,
  });

  if (!planResult.ok) {
    return { decision: { steps: [], reason: 'Planner run failed; nothing was planned.' }, plannerMessage };
  }

  const planText = planResult.text || deps.db.getChatMessage(plannerMessage.id)?.text || '';
  return { decision: parsePlannerDecision(planText, running), plannerMessage };
}

function leastBusyAdapter(deps: ChatDeps, projectId: string, running: string[]): string {
  if (running.length <= 1) return running[0];
  const counts = new Map(running.map((id) => [id, 0]));
  for (const task of deps.db.listTasks(projectId)) {
    if (task.agentId && counts.has(task.agentId) && (task.status === 'running' || task.status === 'ready')) {
      counts.set(task.agentId, counts.get(task.agentId)! + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

/**
 * Continuation: a new message on a thread that already has a (draft/running/paused)
 * workflow becomes a new Todo chained after the last one — agents cooperate through
 * dependency-context handoff instead of restarting the whole task.
 */
async function appendChatTodo(
  deps: ChatDeps,
  thread: ChatThread,
  project: { id: string; name: string; path: string },
  userText: string,
  running: string[],
  start: boolean,
  preferredAdapterId?: string,
): Promise<void> {
  if (!thread.workflowId) return;
  const workflow = deps.db.getWorkflow(thread.workflowId);
  if (!workflow) return;

  const tasks = deps.db.listWorkflowTasks(workflow.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastTask = tasks[tasks.length - 1];
  const dependencies = lastTask ? [lastTask.id] : [];
  // Follow the conversation's adapter when it is still available, so a thread
  // keeps talking to the same agent; otherwise spread the extra work.
  const agentId =
    preferredAdapterId && running.includes(preferredAdapterId)
      ? preferredAdapterId
      : leastBusyAdapter(deps, thread.projectId, running);
  const title = threadTitle(userText);

  const task = deps.db.createTask({
    projectId: thread.projectId,
    workflowId: workflow.id,
    title,
    description: userText,
    status: 'pending',
    priority: Math.max(1, lastTask ? lastTask.priority - 1 : 1),
    dependencies,
    agentId,
    modeId: thread.adapterMode,
    fileScopes: [],
    kind: 'chat',
    retryCount: 0,
    maxRetries: 1,
  });

  agentMessage(deps, thread, {
    role: 'agent',
    adapterId: agentId,
    taskId: task.id,
    label: `Continuation: ${title}`,
  });

  void deps.eventBus.emit({
    type: 'task.created',
    projectId: thread.projectId,
    workflowId: workflow.id,
    taskId: task.id,
    agentId,
    payload: { workflowId: workflow.id, taskId: task.id, title, agentId, source: 'chat-continuation' },
  });

  if (start && workflow.status === 'draft') {
    deps.scheduler.loadTasks(deps.db.listWorkflowTasks(workflow.id));
    const started = await deps.scheduler.startWorkflow(workflow.id);
    if (!started.started) {
      systemMessage(deps, thread, `The extended plan could not start: ${started.errors.join('; ')}`);
      return;
    }
    void deps.eventBus.emit({
      type: 'workflow.started',
      projectId: thread.projectId,
      workflowId: workflow.id,
      payload: { workflowId: workflow.id, source: 'chat-continuation', threadId: thread.id },
    });
    refreshWorkflow(deps.workflowRuntime, workflow.id);
    systemMessage(deps, thread, `Added a new todo ("${title}") after the last step and started the plan.`);
    return;
  }

  deps.scheduler.loadTasks([task]);
  refreshWorkflow(deps.workflowRuntime, workflow.id);
  systemMessage(
    deps,
    thread,
    start
      ? `Added a new todo ("${title}") after ${lastTask ? 'the last step' : 'no prior step'}. It runs once its dependencies complete.`
      : `Plan extended with a new todo ("${title}"). Nothing runs until you execute or switch to Agent mode.`,
  );
}

/** Executes a previously drafted plan (Plan mode review -> Execute). */
export async function executeChatPlan(
  deps: ChatDeps,
  threadId: string,
): Promise<{ started: boolean; workflowId?: string; errors?: string[] }> {
  const thread = deps.db.getChatThread(threadId);
  if (!thread) return { started: false, errors: ['Chat thread not found'] };
  if (!thread.workflowId) return { started: false, errors: ['This thread has no drafted plan to execute.'] };

  const workflow = deps.db.getWorkflow(thread.workflowId);
  if (!workflow) return { started: false, workflowId: thread.workflowId, errors: ['Plan workflow not found.'] };
  if (workflow.status === 'running') return { started: false, workflowId: workflow.id, errors: ['This plan is already running.'] };
  if (workflow.status === 'cancelled' || workflow.status === 'completed') {
    return { started: false, workflowId: workflow.id, errors: [`Cannot start a plan that has already been ${workflow.status}.`] };
  }

  if (workflow.status === 'paused') {
    deps.scheduler.loadTasks(deps.db.listWorkflowTasks(workflow.id));
    deps.scheduler.resumeWorkflow(workflow.id);
    void deps.eventBus.emit({
      type: 'workflow.started',
      projectId: thread.projectId,
      workflowId: workflow.id,
      payload: { workflowId: workflow.id, source: 'chat-execute', threadId: thread.id },
    });
    refreshWorkflow(deps.workflowRuntime, workflow.id);
    return { started: true, workflowId: workflow.id };
  }

  deps.scheduler.loadTasks(deps.db.listWorkflowTasks(workflow.id));
  const started = await deps.scheduler.startWorkflow(workflow.id);
  if (!started.started) return { started: false, workflowId: workflow.id, errors: started.errors };

  void deps.eventBus.emit({
    type: 'workflow.started',
    projectId: thread.projectId,
    workflowId: workflow.id,
    payload: { workflowId: workflow.id, source: 'chat-execute', threadId: thread.id },
  });
  refreshWorkflow(deps.workflowRuntime, workflow.id);
  return { started: true, workflowId: workflow.id };
}

