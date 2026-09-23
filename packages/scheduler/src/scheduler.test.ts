import { describe, it, expect, vi } from 'vitest';
import { Scheduler } from './index.js';
import { EventBus } from '@opencli/events';
import type { Task } from '@opencli/domain';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'proj-1',
    title: overrides.title ?? 'Test task',
    status: overrides.status ?? 'pending',
    priority: overrides.priority ?? 0,
    dependencies: overrides.dependencies ?? [],
    fileScopes: overrides.fileScopes ?? [],
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Scheduler', () => {
  it('adds and lists tasks', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus);
    const task = makeTask({ id: 'T1' });
    scheduler.addTask(task);
    expect(scheduler.listTasks()).toHaveLength(1);
    expect(scheduler.getTask('T1')).toBeDefined();
  });

  it('detects ready tasks when deps are met', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus);
    scheduler.addTask(makeTask({ id: 'T1', status: 'completed' }));
    scheduler.addTask(makeTask({ id: 'T2', dependencies: ['T1'] }));
    scheduler.addTask(makeTask({ id: 'T3', dependencies: ['T1', 'T2'] }));

    // T2 depends on T1 which is completed → ready
    const ready = scheduler.getReadyTasks();
    expect(ready.map((t) => t.id)).toContain('T2');
    expect(ready.map((t) => t.id)).not.toContain('T3'); // T3 still blocked on T2
  });

  it('detects blocked tasks when deps failed', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus);
    scheduler.addTask(makeTask({ id: 'T1', status: 'failed' }));
    scheduler.addTask(makeTask({ id: 'T2', dependencies: ['T1'] }));

    const blocked = scheduler.getBlockedTasks();
    expect(blocked.map((t) => t.id)).toContain('T2');
  });

  it('marks completed and checks downstream', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus);
    scheduler.addTask(makeTask({ id: 'T1', status: 'running' }));
    scheduler.addTask(makeTask({ id: 'T2', dependencies: ['T1'] }));

    scheduler.markCompleted('T1');
    expect(scheduler.getTask('T1')?.status).toBe('completed');
    // T2 should now be ready
    expect(scheduler.getTask('T2')?.status).toBe('ready');
  });

  it('retries on failure', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus);
    scheduler.addTask(makeTask({ id: 'T1', status: 'running', maxRetries: 2 }));

    scheduler.markFailed('T1', 'error');
    expect(scheduler.getTask('T1')?.retryCount).toBe(1);
    expect(scheduler.getTask('T1')?.status).toBe('pending'); // Will be retried

    scheduler.markFailed('T1', 'error');
    expect(scheduler.getTask('T1')?.retryCount).toBe(2);
    expect(scheduler.getTask('T1')?.status).toBe('pending');

    scheduler.markFailed('T1', 'error');
    expect(scheduler.getTask('T1')?.status).toBe('failed'); // Max retries exceeded
  });

  it('cancels a task', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus);
    scheduler.addTask(makeTask({ id: 'T1', status: 'ready' }));
    scheduler.cancel('T1');
    expect(scheduler.getTask('T1')?.status).toBe('cancelled');
  });

  it('blocks parallel execution when file scopes overlap', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus, { maxConcurrent: 2 });
    const a = makeTask({ id: 'T1', workflowId: 'W1', status: 'ready', fileScopes: ['src/auth/**'] });
    const b = makeTask({ id: 'T2', workflowId: 'W1', status: 'ready', fileScopes: ['src/auth/session.ts'] });
    scheduler.addTask(a);
    scheduler.addTask(b);
    expect(scheduler.canRunTask(a).ok).toBe(true);
    scheduler.markRunning('T1');
    expect(scheduler.canRunTask(b).ok).toBe(false);
    expect(scheduler.canRunTask(b).conflicts).toContain('T1');
  });

  it('validates workflow dependency cycles', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus);
    scheduler.addTask(makeTask({ id: 'T1', workflowId: 'W1', dependencies: ['T2'] }));
    scheduler.addTask(makeTask({ id: 'T2', workflowId: 'W1', dependencies: ['T1'] }));
    const result = scheduler.validateWorkflow('W1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('Dependency cycle'))).toBe(true);
  });

  it('builds correct graph', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus);
    scheduler.addTask(makeTask({ id: 'T1', title: 'Arch' }));
    scheduler.addTask(makeTask({ id: 'T2', title: 'API', dependencies: ['T1'] }));
    scheduler.addTask(makeTask({ id: 'T3', title: 'UI', dependencies: ['T1'] }));

    const graph = scheduler.getGraph();
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'T1', to: 'T2' },
        { from: 'T1', to: 'T3' },
      ]),
    );
  });

  it('provides correct stats', () => {
    const bus = new EventBus();
    const scheduler = new Scheduler(bus);
    scheduler.addTask(makeTask({ id: 'T1', status: 'completed' }));
    scheduler.addTask(makeTask({ id: 'T2', status: 'running' }));
    scheduler.addTask(makeTask({ id: 'T3', status: 'pending' }));

    const stats = scheduler.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byStatus.completed).toBe(1);
    expect(stats.byStatus.running).toBe(1);
    expect(stats.byStatus.pending).toBe(1);
  });
});
