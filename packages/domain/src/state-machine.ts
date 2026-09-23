// Explicit state machine per Rule 11 (20-development-rules.md)

export interface StateTransition<S extends string> {
  from: S;
  to: S;
  event: string;
}

export class StateMachine<S extends string> {
  private current: S;
  private transitions: StateTransition<S>[];
  private history: Array<{ from: S; to: S; event: string; timestamp: string }> = [];

  constructor(initial: S, transitions: StateTransition<S>[]) {
    this.current = initial;
    this.transitions = transitions;
  }

  getState(): S {
    return this.current;
  }

  canTransition(event: string): boolean {
    return this.transitions.some((t) => t.from === this.current && t.event === event);
  }

  transition(event: string): S {
    const valid = this.transitions.find((t) => t.from === this.current && t.event === event);
    if (!valid) {
      throw new Error(
        `Invalid transition: ${this.current} + ${event}. Valid events: ${this.getValidEvents().join(', ')}`,
      );
    }
    const from = this.current;
    this.current = valid.to;
    this.history.push({ from, to: this.current, event, timestamp: new Date().toISOString() });
    return this.current;
  }

  getValidEvents(): string[] {
    return this.transitions.filter((t) => t.from === this.current).map((t) => t.event);
  }

  getHistory(): Array<{ from: S; to: S; event: string; timestamp: string }> {
    return [...this.history];
  }
}

// Task state machine (06-task-workflow.md)
export const TASK_TRANSITIONS: StateTransition<string>[] = [
  { from: 'pending', to: 'ready', event: 'deps_satisfied' },
  { from: 'ready', to: 'running', event: 'start' },
  { from: 'running', to: 'paused', event: 'pause' },
  { from: 'paused', to: 'running', event: 'resume' },
  { from: 'running', to: 'completed', event: 'success' },
  { from: 'running', to: 'failed', event: 'error' },
  { from: 'running', to: 'review', event: 'needs_review' },
  { from: 'review', to: 'completed', event: 'approve' },
  { from: 'running', to: 'blocked', event: 'block' },
  { from: 'blocked', to: 'ready', event: 'unblock' },
  { from: 'running', to: 'cancelled', event: 'cancel' },
  { from: 'ready', to: 'cancelled', event: 'cancel' },
  { from: 'failed', to: 'ready', event: 'retry' },
];

// Session / process state machine (02-architecture.md)
export const SESSION_TRANSITIONS: StateTransition<string>[] = [
  { from: 'idle', to: 'starting', event: 'start' },
  { from: 'starting', to: 'running', event: 'running' },
  { from: 'running', to: 'paused', event: 'pause' },
  { from: 'paused', to: 'running', event: 'resume' },
  { from: 'running', to: 'stopping', event: 'stop' },
  { from: 'stopping', to: 'completed', event: 'exit_success' },
  { from: 'stopping', to: 'failed', event: 'exit_failure' },
  { from: 'running', to: 'crashed', event: 'crash' },
  { from: 'starting', to: 'failed', event: 'start_failure' },
];

// Workspace state machine
export const WORKSPACE_TRANSITIONS: StateTransition<string>[] = [
  { from: 'created', to: 'active', event: 'activate' },
  { from: 'active', to: 'released', event: 'release' },
  { from: 'active', to: 'conflict', event: 'conflict_detected' },
  { from: 'conflict', to: 'active', event: 'conflict_resolved' },
];

// Lock lifecycle (07-concurrency-isolation.md)
export const LOCK_TRANSITIONS: StateTransition<string>[] = [
  { from: 'requested', to: 'granted', event: 'grant' },
  { from: 'granted', to: 'held', event: 'hold' },
  { from: 'held', to: 'released', event: 'release' },
  { from: 'requested', to: 'denied', event: 'deny' },
];

export function createTaskStateMachine(): StateMachine<string> {
  return new StateMachine('pending', TASK_TRANSITIONS);
}

export function createSessionStateMachine(): StateMachine<string> {
  return new StateMachine('idle', SESSION_TRANSITIONS);
}

export function createWorkspaceStateMachine(): StateMachine<string> {
  return new StateMachine('created', WORKSPACE_TRANSITIONS);
}
