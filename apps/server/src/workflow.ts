import type { AgentContext } from '@opencli/adapter';
import type { OpenCLIRepository } from '@opencli/db';
import type { EventBus } from '@opencli/events';
import type { Scheduler } from '@opencli/scheduler';
import type { AdapterRegistry, AdapterRouter } from '@opencli/adapter';
import type { ProcessManager } from '@opencli/runtime';
import type { GitService } from '@opencli/git';
import type { WorkspaceService } from '@opencli/workspace';
import type { Task } from '@opencli/domain';
import { getSession } from './sessions.js';
import { runAgentTurn } from './chatRuntime.js';

export interface WorkflowRuntime {
  db: OpenCLIRepository;
  eventBus: EventBus;
  scheduler: Scheduler;
  adapterRegistry: AdapterRegistry;
  adapterRouter: AdapterRouter;
  runtime: ProcessManager;
  gitService: GitService;
  workspaceService: WorkspaceService;
}

export function configureWorkflowRuntime(deps: WorkflowRuntime): void {
  deps.scheduler.setPersistence((task) => {
    deps.db.updateTask(task.id, task);
    if (task.workflowId) refreshWorkflow(deps, task.workflowId);
  });

  deps.scheduler.setExecutor((task) => executeTask(deps, task));
  deps.scheduler.start();
}

export function restoreRunningWorkflows(deps: WorkflowRuntime): void {
  const runningWorkflowIds = new Set(listRunningWorkflows(deps).map((workflow) => workflow.id));

  for (const project of deps.db.listProjects()) {
    const tasks = deps.db.listTasks(project.id).map((task) => {
      if (task.workflowId && runningWorkflowIds.has(task.workflowId) && (task.status === 'running' || task.status === 'paused')) {
        return deps.db.updateTask(task.id, { status: 'pending' }) ?? task;
      }
      return task;
    });
    deps.scheduler.loadTasks(tasks);
  }

  for (const workflowId of runningWorkflowIds) {
    deps.scheduler.startWorkflow(workflowId).catch(() => undefined);
  }
}

function listRunningWorkflows(deps: WorkflowRuntime) {
  return deps.db.listProjects().flatMap((project) =>
    deps.db.listWorkflows(project.id).filter((workflow) => workflow.status === 'running'),
  );
}

async function executeTask(deps: WorkflowRuntime, task: Task): Promise<{ success: boolean; error?: string }> {
  if (task.kind === 'chat') return executeChatTask(deps, task);

  const project = deps.db.getProject(task.projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const requestedAdapterId = task.agentId ?? project.defaultAgent;
  const route = await deps.adapterRouter.resolve({
    preferredAdapterId: requestedAdapterId,
    requiredCapabilities: task.requiredCapabilities?.length ? task.requiredCapabilities : ['coding'],
  });

  if (!route) {
    return {
      success: false,
      error: requestedAdapterId
        ? `Adapter ${requestedAdapterId} is unavailable/inactive or lacks required capability: coding`
        : 'No active adapter with required capability: coding',
    };
  }

  const adapterId = route.adapterId;
  const adapter = route.adapter;

  const modes = await adapter.getModes();
  const mode = task.modeId ?? project.defaultMode ?? modes.find((item) => item.id === 'build')?.id ?? modes[0]?.id ?? 'build';
  const modelRoute = deps.db.listModelRoutings(project.id)[adapterId]?.[mode];

  deps.workspaceService.registerFileScope(task.id, task.fileScopes);

  const gitInfo = deps.gitService.getInfo(project.path);
  const shouldIsolate = gitInfo.isRepository && !gitInfo.hasUncommittedChanges;
  const worktree = shouldIsolate ? deps.gitService.createWorktree(project.path, task.id) : undefined;
  if (shouldIsolate && !worktree) {
    return { success: false, error: 'Could not create an isolated Git worktree for this task' };
  }
  const workspacePath = worktree?.path ?? project.path;

  if (gitInfo.isRepository && gitInfo.hasUncommittedChanges) {
    deps.eventBus.emit({
      type: 'workspace.created',
      projectId: project.id,
      taskId: task.id,
      workflowId: task.workflowId,
      agentId: adapterId,
      payload: { path: project.path, mode: 'shared-dirty-worktree', isolated: false },
    }).catch(() => undefined);
  }

  if (worktree) {
    const persisted = deps.db.createWorkspace({
      projectId: project.id,
      taskId: task.id,
      path: worktree.path,
      branch: worktree.branch,
      status: 'active',
    });
    deps.db.updateTask(task.id, { workspaceId: persisted.id });
    task.workspaceId = persisted.id;
  }

  const context: AgentContext = {
    projectPath: project.path,
    workspacePath,
    taskId: task.id,
    taskDescription: task.description ? `${task.title}\n\n${task.description}` : task.title,
    mode,
    model: modelRoute,
    environment: {},
    relevantFiles: [...task.fileScopes],
    projectMemory: {},
  };

  const command = adapter.buildCommand(context);
  const locks = task.fileScopes.map((resource) =>
    deps.workspaceService.acquireLock({
      projectId: project.id,
      resource,
      ownerType: 'task',
      ownerId: task.id,
      ttlMs: Math.max(command.timeout ?? 600_000, 300_000),
    }),
  );

  if (locks.some((lock) => !lock)) {
    for (const lock of locks) if (lock) deps.workspaceService.releaseLock(lock.id);
    return { success: false, error: 'Task resource conflict detected before execution' };
  }

  let processId: string | undefined;
  let sessionId: string | undefined;
  try {
    processId = await deps.runtime.spawn(command, adapterId, task.id, task.workflowId);
    const session = deps.db.createSession({
      agentId: adapterId,
      taskId: task.id,
      processId,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    sessionId = session.id;

    deps.eventBus.emit({
      type: 'task.started',
      projectId: project.id,
      workflowId: task.workflowId,
      taskId: task.id,
      agentId: adapterId,
      payload: {
        workflowId: task.workflowId,
        sessionId,
        processId,
        adapterId,
        mode,
        provider: modelRoute?.provider,
        model: modelRoute?.model,
        workspacePath,
      },
    }).catch(() => undefined);

    await waitForProcess(deps.runtime, processId, command.timeout ?? 600_000);
    const result = deps.runtime.getProcess(processId);
    const success = result?.status === 'completed' && result.exitCode === 0;

    deps.db.updateSession(sessionId, {
      status: success ? 'completed' : 'failed',
      endedAt: new Date().toISOString(),
      exitCode: result?.exitCode,
    });

    if (!success) {
      return {
        success: false,
        error: deps.runtime.getErrors(processId) || `Agent exited with code ${result?.exitCode ?? 'unknown'}`,
      };
    }

    if (worktree) {
      const changed = deps.gitService.hasChanges(worktree.path);
      if (changed) {
        const commit = deps.gitService.commit(worktree.path, `opencli: ${task.title}`);
        if (!commit.success && deps.gitService.hasChanges(worktree.path)) {
          if (task.workspaceId) deps.db.updateWorkspace(task.workspaceId, { status: 'conflict' });
          deps.eventBus.emit({ type: 'workspace.conflict', projectId: project.id, workflowId: task.workflowId, taskId: task.id, agentId: adapterId, payload: { branch: worktree.branch, error: commit.error } }).catch(() => undefined);
          return { success: false, error: commit.error ?? 'Could not commit workflow changes' };
        }
      }

      const merge = deps.gitService.merge(project.path, worktree.branch);
      if (!merge.success) {
        if (task.workspaceId) deps.db.updateWorkspace(task.workspaceId, { status: 'conflict' });
        deps.eventBus.emit({
          type: 'workspace.conflict',
          projectId: project.id,
          workflowId: task.workflowId,
          taskId: task.id,
          agentId: adapterId,
          payload: { branch: worktree.branch, error: merge.error },
        }).catch(() => undefined);
        return { success: false, error: merge.error ?? 'Could not merge workflow changes' };
      }

      deps.gitService.removeWorktree(project.path, task.id);
      if (task.workspaceId) deps.db.updateWorkspace(task.workspaceId, { status: 'released' });
      deps.eventBus.emit({
        type: 'workspace.released',
        projectId: project.id,
        workflowId: task.workflowId,
        taskId: task.id,
        agentId: adapterId,
        payload: { path: worktree.path, branch: worktree.branch },
      }).catch(() => undefined);
    }

    return { success: true };
  } catch (error: any) {
    if (sessionId) {
      deps.db.updateSession(sessionId, {
        status: 'failed',
        endedAt: new Date().toISOString(),
      });
    }
    return { success: false, error: error?.message ?? 'Agent execution failed' };
  } finally {
    for (const lock of locks) if (lock) deps.workspaceService.releaseLock(lock.id);
  }
}

/**
 * Cooperation handoff: a todo that depends on other steps receives their
 * completed outputs in its prompt, so adapters build on each other's work
 * instead of repeating the same task. This is what makes Agent mode a real
 * parallel team rather than N adapters working the same prompt.
 */
export function buildDependencyContext(deps: WorkflowRuntime, task: Task): string {
  if (task.dependencies.length === 0) return '';

  const parts: string[] = [];
  for (const dependencyId of task.dependencies) {
    const dependency = deps.db.getTask(dependencyId);
    if (!dependency || dependency.status !== 'completed') continue;
    const message = deps.db.getChatMessageByTaskId(dependencyId);
    const text = message?.text?.trim();
    if (!text || !message) continue;
    parts.push(`<from ${message.agentId ?? dependency.agentId ?? 'agent'} — ${dependency.title}>`);
    parts.push(text.slice(-4000));
  }

  if (parts.length === 0) return '';
  return `\n\nContext from the steps this todo depends on (build on this output, do not redo it):\n${parts.join('\n')}`;
}

async function executeChatTask(deps: WorkflowRuntime, task: Task): Promise<{ success: boolean; error?: string }> {
  const project = deps.db.getProject(task.projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const chatMessage = deps.db.getChatMessageByTaskId(task.id);
  const thread = chatMessage ? deps.db.getChatThread(chatMessage.threadId) : undefined;
  if (!thread || !chatMessage) {
    return { success: false, error: 'This chat task is no longer linked to a conversation' };
  }

  const adapterId = task.agentId ?? project.defaultAgent;
  if (!adapterId) return { success: false, error: 'No agent assigned to this step' };

  const session = getSession(project.id, adapterId);
  if (!session || session.status !== 'running') {
    const message = `${adapterId} is not running. Start its session on the Adapters page first.`;
    deps.eventBus.emit({
      type: 'agent.permission_requested',
      projectId: project.id,
      workflowId: task.workflowId,
      taskId: task.id,
      agentId: adapterId,
      payload: { threadId: thread.id, messageId: chatMessage.id, message },
    }).catch(() => undefined);
    return { success: false, error: message };
  }

  const locks = task.fileScopes.map((resource) =>
    deps.workspaceService.acquireLock({
      projectId: project.id,
      resource,
      ownerType: 'task',
      ownerId: task.id,
      ttlMs: 600_000,
    }),
  );
  if (locks.some((lock) => !lock)) {
    for (const lock of locks) if (lock) deps.workspaceService.releaseLock(lock.id);
    return { success: false, error: 'Another agent is already editing these file scopes' };
  }

  deps.workspaceService.registerFileScope(task.id, task.fileScopes);
  deps.eventBus.emit({
    type: 'workspace.created',
    projectId: project.id,
    workflowId: task.workflowId,
    taskId: task.id,
    agentId: adapterId,
    payload: { path: project.path, mode: 'shared-session', isolated: false },
  }).catch(() => undefined);

  const modelRoute = deps.db.listModelRoutings(project.id)[adapterId]?.[task.modeId ?? 'build'];
  const mode = task.modeId ?? project.defaultMode ?? 'build';
  const description =
    (task.description
      ? `${task.title}\n\n${task.description}\n\nWork only inside the file scopes assigned to this step: ${task.fileScopes.join(', ') || 'none (read only)'}.`
      : task.title) + buildDependencyContext(deps, task);

  const record = deps.db.createSession({
    agentId: adapterId,
    taskId: task.id,
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  try {
    const result = await runAgentTurn(deps, {
      projectId: project.id,
      threadId: thread.id,
      adapterId,
      messageId: chatMessage.id,
      text: description,
      taskId: task.id,
      mode,
      model: modelRoute,
    });

    deps.db.updateSession(record.id, {
      status: result.ok ? 'completed' : 'failed',
      endedAt: new Date().toISOString(),
    });

    if (!result.ok) {
      return { success: false, error: result.error ?? 'The agent session did not finish this step' };
    }
    return { success: true };
  } catch (error: any) {
    deps.db.updateSession(record.id, { status: 'failed', endedAt: new Date().toISOString() });
    return { success: false, error: error?.message ?? 'Chat task execution failed' };
  } finally {
    for (const lock of locks) if (lock) deps.workspaceService.releaseLock(lock.id);
  }
}

async function waitForProcess(runtime: ProcessManager, processId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs + 5_000;
  while (Date.now() < deadline) {
    const process = runtime.getProcess(processId);
    if (!process || ['completed', 'failed', 'crashed'].includes(process.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await runtime.cancel(processId);
}

export function refreshWorkflow(deps: WorkflowRuntime, workflowId: string): void {
  const workflow = deps.db.getWorkflow(workflowId);
  if (!workflow) return;
  if (workflow.status === 'cancelled') return;

  const tasks = deps.db.listWorkflowTasks(workflowId);
  if (tasks.length === 0) return;

  if (tasks.some((task) => task.status === 'failed' || task.status === 'blocked')) {
    if (workflow.status !== 'failed') {
      deps.db.updateWorkflow(workflowId, { status: 'failed' });
      deps.eventBus.emit({
        type: 'workflow.failed',
        projectId: workflow.projectId,
        workflowId,
        payload: { workflowId },
      }).catch(() => undefined);
    }
    return;
  }

  if (tasks.every((task) => task.status === 'completed')) {
    if (workflow.status !== 'completed') {
      deps.db.updateWorkflow(workflowId, { status: 'completed' });
      deps.eventBus.emit({
        type: 'workflow.completed',
        projectId: workflow.projectId,
        workflowId,
        payload: { workflowId },
      }).catch(() => undefined);
    }
    return;
  }

  if (workflow.status === 'running') return;
}
