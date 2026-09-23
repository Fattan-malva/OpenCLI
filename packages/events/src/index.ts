import { randomUUID } from 'node:crypto';
import type { OpenCLIEvent, EventType } from '@opencli/domain';

export type EventHandler = (event: OpenCLIEvent) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private history: OpenCLIEvent[] = [];
  private maxHistory: number;

  constructor(maxHistory = 1000) {
    this.maxHistory = maxHistory;
  }

  on(eventType: EventType | '*', handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  async emit(event: Omit<OpenCLIEvent, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: OpenCLIEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    this.history.push(fullEvent);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    const specificHandlers = this.handlers.get(fullEvent.type) ?? new Set();
    const wildcardHandlers = this.handlers.get('*') ?? new Set();
    const allHandlers = new Set([...specificHandlers, ...wildcardHandlers]);

    for (const handler of allHandlers) {
      try {
        await handler(fullEvent);
      } catch {
        // Handler errors don't break the bus
      }
    }
  }

  getHistory(
    filter?: { projectId?: string; taskId?: string; agentId?: string; type?: EventType },
  ): OpenCLIEvent[] {
    let events = this.history;
    if (filter?.projectId) events = events.filter((e) => e.projectId === filter.projectId);
    if (filter?.taskId) events = events.filter((e) => e.taskId === filter.taskId);
    if (filter?.agentId) events = events.filter((e) => e.agentId === filter.agentId);
    if (filter?.type) events = events.filter((e) => e.type === filter.type);
    return events;
  }

  clearHistory(): void {
    this.history = [];
  }

  handlerCount(): number {
    return Array.from(this.handlers.values()).reduce((sum, set) => sum + set.size, 0);
  }
}

// SSE bridge: returns a readable stream of events for a channel
export class EventBusSSEBridge {
  constructor(private bus: EventBus) {}

  subscribe(
    filter: { projectId?: string; workflowId?: string; taskId?: string; agentId?: string },
    onEvent: (data: string) => void,
  ): () => void {
    return this.bus.on('*', (event) => {
      if (filter.projectId && event.projectId !== filter.projectId) return;
      if (filter.workflowId && event.workflowId !== filter.workflowId) return;
      if (filter.taskId && event.taskId !== filter.taskId) return;
      if (filter.agentId && event.agentId !== filter.agentId) return;
      onEvent(JSON.stringify(event));
    });
  }
}
