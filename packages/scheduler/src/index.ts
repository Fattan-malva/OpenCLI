// Task scheduler: DAG resolution, queue, priority, retry (06-task-workflow.md)
import type { Task, TaskStatus, EventType } from '@opencli/domain';
import type { EventBus } from '@opencli/events';

export interface SchedulerOptions {
  maxConcurrent?: number;
  maxRetries?: number;
}

export type TaskExecutor = (task: Task) => Promise<{ success: boolean; error?: string }>;

export class Scheduler {
  private tasks = new Map<string, Task>();
  private running = new Set<string>();
  private maxConcurrent: number;
  private maxRetries: number;
  private executor?: TaskExecutor;
  private tickInterval?: ReturnType<typeof setInterval>;

  constructor(
    private eventBus: EventBus,
    options?: SchedulerOptions,
  ) {
    this.maxConcurrent = options?.maxConcurrent ?? 4;
    this.maxRetries = options?.maxRetries ?? 3;
  }

  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  addTask(task: Task): void {
    this.tasks.set(task.id, task);
    this.eventBus.emit({
      type: 'task.created',
      taskId: task.id,
      projectId: task.projectId,
      agentId: task.agentId,
      payload: { title: task.title, status: task.status },
    });
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return this.listTasks().filter((t) => t.status === status);
  }

  // Check if all dependencies of a task are completed
  private areDependenciesMet(task: Task): boolean {
    return task.dependencies.every((depId) => {
      const dep = this.tasks.get(depId);
      return dep?.status === 'completed';
    });
  }

  // Check if any dependency has failed (blocking the task)
  private hasDependencyFailed(task: Task): boolean {
    return task.dependencies.some((depId) => {
      const dep = this.tasks.get(depId);
      return dep?.status === 'failed' || dep?.status === 'cancelled';
    });
  }

  // Get ready tasks: pending tasks with all deps met, not blocked by failures
  getReadyTasks(): Task[] {
    return this.listTasks().filter((t) => {
      if (t.status !== 'pending' && t.status !== 'ready') return false;
      if (this.hasDependencyFailed(t)) return false;
      return this.areDependenciesMet(t);
    });
  }

  // Get tasks that are blocked (have failed dependencies)
  getBlockedTasks(): Task[] {
    return this.listTasks().filter((t) => {
      if (t.status !== 'pending' && t.status !== 'ready') return false;
      return this.hasDependencyFailed(t);
    });
  }

  // Update task status with proper state transitions
  updateTaskStatus(id: string, newStatus: TaskStatus): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    const oldStatus = task.status;
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();

    const eventType = `task.${newStatus}` as EventType;
    this.eventBus.emit({
      type: eventType,
      taskId: id,
      projectId: task.projectId,
      agentId: task.agentId,
      payload: { from: oldStatus, to: newStatus },
    });

    return task;
  }

  // Mark task as ready (deps satisfied)
  markReady(id: string): Task | undefined {
    return this.updateTaskStatus(id, 'ready');
  }

  // Mark task as running
  markRunning(id: string): Task | undefined {
    const task = this.updateTaskStatus(id, 'running');
    if (task) this.running.add(id);
    return task;
  }

  // Mark task as completed
  markCompleted(id: string): Task | undefined {
    const task = this.updateTaskStatus(id, 'completed');
    if (task) this.running.delete(id);
    // After completing, check if any downstream tasks become ready
    this.checkDownstream(id);
    return task;
  }

  // Mark task as failed, with retry logic
  markFailed(id: string, error?: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    this.running.delete(id);

    // Retry if possible
    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      task.status = 'pending';
      task.updatedAt = new Date().toISOString();

      this.eventBus.emit({
        type: 'task.retried',
        taskId: id,
        projectId: task.projectId,
        agentId: task.agentId,
        payload: { retryCount: task.retryCount, error },
      });

      return task;
    }

    return this.updateTaskStatus(id, 'failed');
  }

  // Mark task as blocked
  markBlocked(id: string): Task | undefined {
    return this.updateTaskStatus(id, 'blocked');
  }

  // Cancel a task
  cancel(id: string): Task | undefined {
    this.running.delete(id);
    return this.updateTaskStatus(id, 'cancelled');
  }

  // Check downstream tasks when a task completes
  private checkDownstream(completedTaskId: string): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' && task.dependencies.includes(completedTaskId)) {
        if (this.areDependenciesMet(task)) {
          this.markReady(task.id);
        }
      }
    }
  }

  // Start the scheduler tick loop
  start(executor?: TaskExecutor): void {
    if (executor) this.executor = executor;
    this.tick();
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
  }

  // One scheduler tick: check ready tasks and dispatch
  private async tick(): Promise<void> {
    if (!this.executor) return;

    // Check ready tasks → mark them pending
    for (const task of this.getReadyTasks()) {
      if (task.status === 'pending') {
        this.markReady(task.id);
      }
    }

    // Dispatch ready tasks if we have capacity
    const readyTasks = this.getTasksByStatus('ready')
      .sort((a, b) => b.priority - a.priority); // Higher priority first

    for (const task of readyTasks) {
      if (this.running.size >= this.maxConcurrent) break;

      this.markRunning(task.id);

      // Execute async
      this.executeTask(task).catch(() => {});
    }
  }

  private async executeTask(task: Task): Promise<void> {
    if (!this.executor) {
      this.markFailed(task.id, 'No executor configured');
      return;
    }

    try {
      const result = await this.executor(task);
      if (result.success) {
        this.markCompleted(task.id);
      } else {
        this.markFailed(task.id, result.error);
      }
    } catch (err: any) {
      this.markFailed(task.id, err.message);
    }
  }

  // Get the full task graph for visualization
  getGraph(): {
    nodes: Array<{ id: string; status: TaskStatus; title: string; priority: number }>;
    edges: Array<{ from: string; to: string }>;
  } {
    const nodes = this.listTasks().map((t) => ({
      id: t.id,
      status: t.status,
      title: t.title,
      priority: t.priority,
    }));

    const edges: Array<{ from: string; to: string }> = [];
    for (const task of this.tasks.values()) {
      for (const depId of task.dependencies) {
        edges.push({ from: depId, to: task.id });
      }
    }

    return { nodes, edges };
  }

  // Get statistics
  getStats(): {
    total: number;
    byStatus: Record<TaskStatus, number>;
    running: number;
    maxConcurrent: number;
  } {
    const byStatus = {} as Record<TaskStatus, number>;
    for (const task of this.tasks.values()) {
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    }
    return {
      total: this.tasks.size,
      byStatus,
      running: this.running.size,
      maxConcurrent: this.maxConcurrent,
    };
  }
}
