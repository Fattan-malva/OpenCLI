// Workflow scheduler: persistent-ready DAG execution with concurrency and file-scope conflict awareness.
import type { Task, TaskStatus, EventType } from '@opencli/domain';
import type { EventBus } from '@opencli/events';

export interface SchedulerOptions {
  maxConcurrent?: number;
  maxRetries?: number;
  onTaskUpdated?: (task: Task) => void;
}

export type TaskExecutor = (task: Task) => Promise<{ success: boolean; error?: string }>;

function normalizeScope(scope: string): string {
  return scope.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\*\*/g, '*').replace(/\/+$|\/+$/g, '').toLowerCase();
}

function scopesOverlap(a: string, b: string): boolean {
  const left = normalizeScope(a);
  const right = normalizeScope(b);
  if (!left || !right) return false;
  if (left === '*' || right === '*') return true;

  const leftParts = left.split('*').filter(Boolean);
  const rightParts = right.split('*').filter(Boolean);
  if (left.startsWith(right) || right.startsWith(left)) return true;
  if (leftParts.some((part) => right.includes(part)) || rightParts.some((part) => left.includes(part))) return true;

  return false;
}

function tasksConflict(a: Task, b: Task): boolean {
  if (a.projectId !== b.projectId) return false;
  if (a.fileScopes.length === 0 || b.fileScopes.length === 0) return false;
  return a.fileScopes.some((aScope) => b.fileScopes.some((bScope) => scopesOverlap(aScope, bScope)));
}

export class Scheduler {
  private tasks = new Map<string, Task>();
  private running = new Set<string>();
  private activeWorkflows = new Set<string>();
  private maxConcurrent: number;
  private maxRetries: number;
  private executor?: TaskExecutor;
  private tickInterval?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(
    private eventBus: EventBus,
    options?: SchedulerOptions,
  ) {
    this.maxConcurrent = Math.max(1, options?.maxConcurrent ?? 4);
    this.maxRetries = Math.max(0, options?.maxRetries ?? 3);
    this.onTaskUpdated = options?.onTaskUpdated;
  }

  private onTaskUpdated?: (task: Task) => void;

  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  setPersistence(onTaskUpdated: (task: Task) => void): void {
    this.onTaskUpdated = onTaskUpdated;
  }

  setMaxConcurrent(maxConcurrent: number): void {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  }

  loadTasks(tasks: Task[]): void {
    for (const task of tasks) {
      this.tasks.set(task.id, { ...task, dependencies: [...task.dependencies], fileScopes: [...task.fileScopes] });
      if (task.status === 'running') this.running.add(task.id);
      else this.running.delete(task.id);
    }
  }

  addTask(task: Task): void {
    this.tasks.set(task.id, { ...task, dependencies: [...task.dependencies], fileScopes: [...task.fileScopes] });
    this.eventBus.emit({
      type: 'task.created',
      taskId: task.id,
      workflowId: task.workflowId,
      projectId: task.projectId,
      agentId: task.agentId,
      payload: { title: task.title, status: task.status, workflowId: task.workflowId },
    }).catch(() => undefined);
    this.persist(task);
  }

  removeTask(id: string): void {
    this.running.delete(id);
    this.tasks.delete(id);
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getTasksByWorkflow(workflowId: string): Task[] {
    return this.listTasks().filter((task) => task.workflowId === workflowId);
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return this.listTasks().filter((t) => t.status === status);
  }

  getReadyTasks(workflowId?: string): Task[] {
    return this.listTasks().filter((task) => {
      if (workflowId && task.workflowId !== workflowId) return false;
      if (task.status !== 'pending' && task.status !== 'ready') return false;
      if (this.hasDependencyFailed(task)) return false;
      return this.areDependenciesMet(task);
    });
  }

  getBlockedTasks(workflowId?: string): Task[] {
    return this.listTasks().filter((task) => {
      if (workflowId && task.workflowId !== workflowId) return false;
      if (task.status !== 'pending' && task.status !== 'ready') return false;
      return this.hasDependencyFailed(task);
    });
  }

  validateWorkflow(workflowId: string): { valid: boolean; errors: string[] } {
    const tasks = this.getTasksByWorkflow(workflowId);
    const ids = new Set(tasks.map((task) => task.id));
    const errors: string[] = [];

    for (const task of tasks) {
      for (const dependency of task.dependencies) {
        if (!ids.has(dependency)) {
          errors.push(`Task ${task.id} depends on missing task ${dependency}`);
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const byId = new Map(tasks.map((task) => [task.id, task]));

    const visit = (id: string): void => {
      if (visiting.has(id)) {
        errors.push(`Dependency cycle detected at task ${id}`);
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dep of byId.get(id)?.dependencies ?? []) {
        if (byId.has(dep)) visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const task of tasks) visit(task.id);
    return { valid: errors.length === 0, errors: [...new Set(errors)] };
  }

  canRunTask(task: Task): { ok: boolean; conflicts: string[] } {
    const conflicts: string[] = [];
    for (const runningId of this.running) {
      const running = this.tasks.get(runningId);
      if (!running) continue;
      if (tasksConflict(task, running)) conflicts.push(running.id);
    }
    return { ok: conflicts.length === 0, conflicts };
  }

  updateTaskStatus(id: string, newStatus: TaskStatus): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    if (task.status === newStatus) return task;

    const oldStatus = task.status;
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();

    const eventByStatus: Partial<Record<TaskStatus, EventType>> = {
      ready: 'task.ready',
      running: 'task.started',
      blocked: 'task.blocked',
      completed: 'task.completed',
      failed: 'task.failed',
      cancelled: 'task.cancelled',
    };
    const eventType = eventByStatus[newStatus];
    if (eventType) {
      this.eventBus.emit({
        type: eventType,
        taskId: id,
        workflowId: task.workflowId,
        projectId: task.projectId,
        agentId: task.agentId,
        payload: { from: oldStatus, to: newStatus, workflowId: task.workflowId },
      }).catch(() => undefined);
    }

    this.persist(task);
    return task;
  }

  markReady(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'pending') return task;
    return this.updateTaskStatus(id, 'ready');
  }

  markRunning(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'ready') return task;
    this.running.add(id);
    return this.updateTaskStatus(id, 'running');
  }

  markCompleted(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    this.running.delete(id);
    const completed = this.updateTaskStatus(id, 'completed');
    this.checkDownstream(id);
    return completed;
  }

  markFailed(id: string, error?: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    this.running.delete(id);

    if (task.retryCount < Math.min(task.maxRetries, this.maxRetries)) {
      task.retryCount += 1;
      task.status = 'pending';
      task.updatedAt = new Date().toISOString();
      this.persist(task);
      this.eventBus.emit({
        type: 'task.retried',
        taskId: id,
        workflowId: task.workflowId,
        projectId: task.projectId,
        agentId: task.agentId,
        payload: {
          retryCount: task.retryCount,
          maxRetries: Math.min(task.maxRetries, this.maxRetries),
          error,
          workflowId: task.workflowId,
        },
      }).catch(() => undefined);
      return task;
    }

    const failed = this.updateTaskStatus(id, 'failed');
    for (const downstream of this.tasks.values()) {
      if (downstream.dependencies.includes(id) && downstream.status === 'pending') {
        this.updateTaskStatus(downstream.id, 'blocked');
      }
    }
    return failed;
  }

  markBlocked(id: string): Task | undefined {
    return this.updateTaskStatus(id, 'blocked');
  }

  cancel(id: string): Task | undefined {
    this.running.delete(id);
    return this.updateTaskStatus(id, 'cancelled');
  }

  private areDependenciesMet(task: Task): boolean {
    return task.dependencies.every((dependency) => this.tasks.get(dependency)?.status === 'completed');
  }

  private hasDependencyFailed(task: Task): boolean {
    return task.dependencies.some((dependency) => {
      const status = this.tasks.get(dependency)?.status;
      return status === 'failed' || status === 'cancelled' || status === 'blocked';
    });
  }

  private checkDownstream(completedTaskId: string): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' && task.dependencies.includes(completedTaskId) && this.areDependenciesMet(task)) {
        this.markReady(task.id);
      }
    }
  }

  start(executor?: TaskExecutor): void {
    if (executor) this.executor = executor;
    if (this.tickInterval) return;
    this.tick().catch(() => undefined);
    this.tickInterval = setInterval(() => {
      this.tick().catch(() => undefined);
    }, 500);
  }

  async startWorkflow(workflowId: string): Promise<{ started: boolean; errors: string[] }> {
    const validation = this.validateWorkflow(workflowId);
    if (!validation.valid) return { started: false, errors: validation.errors };

    this.activeWorkflows.add(workflowId);
    this.eventBus.emit({
      type: 'workflow.started',
      workflowId,
      payload: { workflowId },
    }).catch(() => undefined);

    await this.tick();
    return { started: true, errors: [] };
  }

  pauseWorkflow(workflowId: string): void {
    this.activeWorkflows.delete(workflowId);
    for (const task of this.getTasksByWorkflow(workflowId)) {
      if (task.status === 'ready' || task.status === 'pending') this.updateTaskStatus(task.id, 'paused');
    }
    this.eventBus.emit({
      type: 'workflow.paused',
      workflowId,
      payload: { workflowId },
    }).catch(() => undefined);
  }

  resumeWorkflow(workflowId: string): void {
    this.activeWorkflows.add(workflowId);
    for (const task of this.getTasksByWorkflow(workflowId)) {
      if (task.status === 'paused') this.updateTaskStatus(task.id, 'ready');
    }
    this.eventBus.emit({
      type: 'workflow.resumed',
      workflowId,
      payload: { workflowId },
    }).catch(() => undefined);
    this.tick().catch(() => undefined);
  }

  cancelWorkflow(workflowId: string): void {
    this.activeWorkflows.delete(workflowId);
    for (const task of this.getTasksByWorkflow(workflowId)) {
      if (task.status === 'pending' || task.status === 'ready' || task.status === 'paused') {
        this.cancel(task.id);
      }
    }
    this.eventBus.emit({
      type: 'workflow.cancelled',
      workflowId,
      payload: { workflowId },
    }).catch(() => undefined);
  }

  isWorkflowActive(workflowId: string): boolean {
    return this.activeWorkflows.has(workflowId);
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = undefined;
    this.activeWorkflows.clear();
  }

  private async tick(): Promise<void> {
    if (this.ticking || !this.executor) return;
    this.ticking = true;

    try {
      for (const workflowId of this.activeWorkflows) {
        for (const task of this.getReadyTasks(workflowId)) {
          if (task.status === 'pending') this.markReady(task.id);
        }
      }

      const candidates = this.listTasks()
        .filter((task) => task.status === 'ready' && task.workflowId && this.activeWorkflows.has(task.workflowId))
        .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));

      for (const task of candidates) {
        if (this.running.size >= this.maxConcurrent) break;

        const gate = this.canRunTask(task);
        if (!gate.ok) {
          continue;
        }

        this.markRunning(task.id);
        this.executeTask(task).catch((error) => {
          this.markFailed(task.id, error?.message ?? 'Task execution failed');
        });
      }
    } finally {
      this.ticking = false;
    }
  }

  private async executeTask(task: Task): Promise<void> {
    if (!this.executor) {
      this.markFailed(task.id, 'No task executor configured');
      return;
    }

    try {
      const result = await this.executor(task);
      if (result.success) this.markCompleted(task.id);
      else this.markFailed(task.id, result.error);
    } catch (error: any) {
      this.markFailed(task.id, error?.message ?? 'Task execution failed');
    }
  }

  private persist(task: Task): void {
    try {
      this.onTaskUpdated?.(task);
    } catch {
      // Persistence failures must not crash the scheduler.
    }
  }

  getGraph(workflowId?: string): {
    nodes: Array<{ id: string; status: TaskStatus; title: string; priority: number; workflowId?: string }>;
    edges: Array<{ from: string; to: string }>;
  } {
    const tasks = workflowId ? this.getTasksByWorkflow(workflowId) : this.listTasks();
    const ids = new Set(tasks.map((task) => task.id));
    const nodes = tasks.map((task) => ({
      id: task.id,
      status: task.status,
      title: task.title,
      priority: task.priority,
      workflowId: task.workflowId,
    }));

    const edges: Array<{ from: string; to: string }> = [];
    for (const task of tasks) {
      for (const dependency of task.dependencies) {
        if (ids.has(dependency)) edges.push({ from: dependency, to: task.id });
      }
    }

    return { nodes, edges };
  }

  getStats(): {
    total: number;
    byStatus: Record<TaskStatus, number>;
    running: number;
    maxConcurrent: number;
    activeWorkflows: number;
  } {
    const byStatus = {} as Record<TaskStatus, number>;
    for (const task of this.tasks.values()) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    return {
      total: this.tasks.size,
      byStatus,
      running: this.running.size,
      maxConcurrent: this.maxConcurrent,
      activeWorkflows: this.activeWorkflows.size,
    };
  }
}
