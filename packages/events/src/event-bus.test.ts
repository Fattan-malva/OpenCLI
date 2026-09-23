import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './index.js';

describe('EventBus', () => {
  it('emits and receives events', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('task.completed', handler);

    await bus.emit({
      type: 'task.completed',
      taskId: 'T1',
      payload: { title: 'Test' },
    });

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0];
    expect(event.type).toBe('task.completed');
    expect(event.taskId).toBe('T1');
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });

  it('supports wildcard handlers', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('*', handler);

    await bus.emit({ type: 'agent.output', payload: {} });
    await bus.emit({ type: 'task.created', payload: {} });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('filters history by project', async () => {
    const bus = new EventBus();
    await bus.emit({ type: 'task.created', projectId: 'P1', payload: {} });
    await bus.emit({ type: 'task.created', projectId: 'P2', payload: {} });
    await bus.emit({ type: 'task.created', projectId: 'P1', payload: {} });

    expect(bus.getHistory({ projectId: 'P1' })).toHaveLength(2);
    expect(bus.getHistory({ projectId: 'P2' })).toHaveLength(1);
  });

  it('unsubscribes handler', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.on('task.completed', handler);

    await bus.emit({ type: 'task.completed', payload: {} });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    await bus.emit({ type: 'task.completed', payload: {} });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
