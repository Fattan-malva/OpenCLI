import type { EventBus } from '@opencli/events';
import type { OpenCLIRepository } from '@opencli/db';
import type { Scheduler } from '@opencli/scheduler';
import type { ChatMessage, ChatThread, ConfirmationPolicy, InteractionMode, PlanStep, PlannerDecision, Task } from '@opencli/domain';
import { getSessionAgentModes, getSession, listSessions, setSessionMode, abortSessionTurn } from './sessions.js';
import { runAgentTurn, type ChatRuntimeDeps } from './chatRuntime.js';
import { assignDefaultAgents, buildPlannerPrompt, parsePlannerDecision } from './planner.js';
import { resolvedConfirmationPolicy, resolvedInteractionMode } from './settings.js';
import { refreshWorkflow, type WorkflowRuntime } from './workflow.js';

export interface ChatDeps extends ChatRuntimeDeps {
  scheduler: Scheduler;
  workflowRuntime: WorkflowRuntime;
}

const MENTION_PATTERN = /@([a-z0-9_-]+)/i;

export function parseMention(text: string, knownAdapterIds: string[]): { targetAdapterId?: string; text: string } {
  const match = text.match(MENTION_PATTERN);
  if (!match) return { text };

  const mentioned = match[1].toLowerCase();
  const target = knownAdapterIds.find((id) => id.toLowerCase() === mentioned)
    ?? knownAdapterIds.find((id) => id.toLowerCase().startsWith(mentioned));
  if (!target) return { text };

  return { targetAdapterId: target, text: text.replace(MENTION_PATTERN, '').trim() };
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

async function agentModes(projectId: string, adapterId: string): Promise<string[]> {
  const runtimeModes = await getSessionAgentModes(projectId, adapterId);
  if (runtimeModes.length > 0) return runtimeModes.map((mode) => mode.id);
  return ['build', 'plan'];
}

function pickPlannerAdapter(projectId: string, defaultAgent: string | undefined, running: string[]): string {
  if (defaultAgent && running.includes(defaultAgent)) return defaultAgent;
  return running[0];
}

function routingModel(
  db: OpenCLIRepository,
  projectId: string,
  adapterId: string,
  mode: string,
): { provider: string; model: string } | undefined {
  const routing = db.listModelRoutings(projectId)[adapterId] ?? {};
  return routing[mode] ?? routing.build ?? routing.plan;
}

function createWorkflowForPlan(
  deps: ChatDeps,
  thread: ChatThread,
  userText: string,
  steps: PlanStep[],
  running: string[],
  start: boolean,
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

  const assigned = assignDefaultAgents(steps, running);
  const created: string[] = [];

  assigned.forEach((step, index) => {
    const agentId = step.agentId && running.includes(step.agentId) ? step.agentId : running[index % running.length];
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
      modeId: step.modeId ?? 'build',
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

export function createWorkflowForBroadcast(
  deps: ChatDeps,
  thread: ChatThread,
  userText: string,
  running: string[],
  modes: Record<string, string>,
): { workflowId: string; taskIds: string[] } {
  const workflow = deps.db.createWorkflow({
    projectId: thread.projectId,
    name: threadTitle(userText),
    description: 'Broadcast run: the same prompt was sent to every running adapter in read-only plan mode.',
    status: 'draft',
  });

  void deps.eventBus.emit({
    type: 'workflow.created',
    projectId: thread.projectId,
    workflowId: workflow.id,
    payload: { workflowId: workflow.id, name: workflow.name, source: 'chat', threadId: thread.id },
  });

  const taskIds = running.map((adapterId, index) => {
    const task = deps.db.createTask({
      projectId: thread.projectId,
      workflowId: workflow.id,
      title: `${adapterId}: ${threadTitle(userText)}`,
      description: userText,
      status: 'pending',
      priority: running.length - index,
      dependencies: [],
      agentId: adapterId,
      modeId: modes[adapterId] ?? 'plan',
      fileScopes: [],
      kind: 'chat',
      broadcast: true,
      retryCount: 0,
      maxRetries: 0,
    });

    agentMessage(deps, thread, {
      role: 'agent',
      adapterId,
      taskId: task.id,
      label: `Broadcast: ${adapterId}`,
    });

    void deps.eventBus.emit({
      type: 'task.created',
      projectId: thread.projectId,
      workflowId: workflow.id,
      taskId: task.id,
      agentId: adapterId,
      payload: { workflowId: workflow.id, taskId: task.id, title: task.title, agentId: adapterId, source: 'chat', broadcast: true },
    });

    return task.id;
  });

  deps.db.updateWorkflow(workflow.id, { status: 'running' });
  deps.db.updateChatThread(thread.id, { workflowId: workflow.id });

  return { workflowId: workflow.id, taskIds };
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
    ? { targetAdapterId: options.targetAdapterId, text: options.text.trim() }
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
    mode: options.mode,
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

  if (input.targetAdapterId) {
    const adapterId = input.targetAdapterId;
    if (!running.includes(adapterId)) {
      systemMessage(deps, thread, `${adapterId} is not running. Start its session on the Adapters page first.`);
      return;
    }
    const message = agentMessage(deps, thread, { role: 'agent', adapterId });
    const directMode = input.mode ?? 'build';
    await runAgentTurn(deps, {
      projectId,
      threadId: thread.id,
      adapterId,
      messageId: message.id,
      text: prompt,
      mode: directMode,
      model: routingModel(deps.db, projectId, adapterId, directMode),
      policy: confirmationPolicy,
    });
    return;
  }

  if (running.length === 0) {
    systemMessage(deps, thread, 'No adapter session is running. Start one on the Adapters page first, then send your task again.');
    return;
  }

  if (interactionMode === 'ask') {
    await broadcastPrompt(deps, thread, project, prompt, running);
    return;
  }

  const existingWorkflow = thread.workflowId ? deps.db.getWorkflow(thread.workflowId) : undefined;
  if (existingWorkflow && ['draft', 'running', 'paused'].includes(existingWorkflow.status)) {
    const start = interactionMode === 'agent' && existingWorkflow.status === 'draft';
    await appendChatTodo(deps, thread, project, prompt, running, start);
    return;
  }

  const { decision, plannerMessage } = await planDecision(deps, thread, project, prompt, running, confirmationPolicy);
  const steps = decision.steps ?? [];
  if (steps.length === 0) {
    deps.db.updateChatMessage(plannerMessage.id, {
      status: 'error',
      text: `${plannerMessage.text}\n\nCould not read a valid plan from this reply. Ask the planner again or mention an agent directly (for example @opencode).`,
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
  const { workflowId, taskIds } = createWorkflowForPlan(deps, thread, prompt, steps, running, start);

  deps.db.appendChatMessageText(plannerMessage.id, `\n\nWorkflow created with ${taskIds.length} step${taskIds.length === 1 ? '' : 's'}.`);
  void deps.eventBus.emit({
    type: 'chat.assistant_completed',
    projectId,
    workflowId,
    agentId: plannerMessage.agentId,
    payload: { threadId: thread.id, messageId: plannerMessage.id, workflowId, steps: taskIds.length },
  });

  if (!start) {
    void deps.eventBus.emit({
      type: 'chat.plan_ready',
      projectId,
      workflowId,
      payload: { workflowId, threadId: thread.id, steps: taskIds.length },
    });
    systemMessage(
      deps,
      thread,
      `Plan ready with ${taskIds.length} step${taskIds.length === 1 ? '' : 's'}. Nothing has run yet — review the todos on the Workflow board and execute, or switch to Agent mode to run automatically.`,
    );
    return;
  }

  deps.scheduler.loadTasks(deps.db.listWorkflowTasks(workflowId));
  const started = await deps.scheduler.startWorkflow(workflowId);
  if (!started.started) {
    systemMessage(deps, thread, `The plan was created but could not start: ${started.errors.join('; ')}`);
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
): Promise<{ decision: PlannerDecision; plannerMessage: ChatMessage }> {
  const plannerAdapterId = pickPlannerAdapter(project.id, undefined, running);
  const plannerMessage = agentMessage(deps, thread, {
    role: 'planner',
    adapterId: plannerAdapterId,
    label: `Planning with ${plannerAdapterId}...`,
  });

  await setSessionMode(project.id, plannerAdapterId, 'plan');

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
    mode: 'plan',
    model: routingModel(deps.db, project.id, plannerAdapterId, 'plan'),
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
): Promise<void> {
  if (!thread.workflowId) return;
  const workflow = deps.db.getWorkflow(thread.workflowId);
  if (!workflow) return;

  const tasks = deps.db.listWorkflowTasks(workflow.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastTask = tasks[tasks.length - 1];
  const dependencies = lastTask ? [lastTask.id] : [];
  const agentId = leastBusyAdapter(deps, thread.projectId, running);
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
    modeId: 'build',
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

async function broadcastPrompt(
  deps: ChatDeps,
  thread: ChatThread,
  project: { id: string; name: string; path: string },
  prompt: string,
  running: string[],
): Promise<void> {
  const modes = new Map<string, string>();
  for (const adapterId of running) {
    const available = await agentModes(project.id, adapterId);
    modes.set(adapterId, available.includes('plan') ? 'plan' : available[0] ?? 'plan');
  }

  const { workflowId, taskIds } = createWorkflowForBroadcast(
    deps,
    thread,
    prompt,
    running,
    Object.fromEntries(modes),
  );

  deps.scheduler.loadTasks(deps.db.listWorkflowTasks(workflowId));
  const started = await deps.scheduler.startWorkflow(workflowId);
  if (!started.started) {
    systemMessage(deps, thread, `The broadcast could not start: ${started.errors.join('; ')}`);
    return;
  }

  void deps.eventBus.emit({
    type: 'workflow.started',
    projectId: project.id,
    workflowId,
    payload: { workflowId, source: 'chat', threadId: thread.id },
  });
  refreshWorkflow(deps.workflowRuntime, workflowId);
}
