import type { AgentContext } from '@opencli/adapter';
import type { OpenCLIRepository } from '@opencli/db';
import type { EventBus } from '@opencli/events';
import type { Scheduler } from '@opencli/scheduler';
import type { AdapterRegistry, AdapterRouter } from '@opencli/adapter';
import type { ProcessManager } from '@opencli/runtime';
import type { GitService } from '@opencli/git';
import type { WorkspaceService } from '@opencli/workspace';
import type { Task } from '@opencli/domain';

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
  const project = deps.db.getProject(task.projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const requestedAdapterId = task.agentId ?? project.defaultAgent;
  const route = await deps.adapterRouter.resolve({
    preferredAdapterId: requestedAdapterId,
    requiredCapabilities: ['coding'],
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
  const route = deps.db.listModelRoutings(project.id)[adapterId]?.[mode];

  deps.workspaceService.registerFileScope(task.id, task.fileScopes);

  const gitInfo = deps.gitService.getInfo(project.path);
  const worktree = gitInfo.isRepository ? deps.gitService.createWorktree(project.path, task.id) : undefined;
  const workspacePath = worktree?.path ?? project.path;

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
    model: route,
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
    processId = await deps.runtime.spawn(command, adapterId, task.id);
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
        provider: route?.provider,
        model: route?.model,
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

    return success
      ? { success: true }
      : { success: false, error: deps.runtime.getErrors(processId) || `Agent exited with code ${result?.exitCode ?? 'unknown'}` };
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
