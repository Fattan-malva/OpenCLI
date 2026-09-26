// Owns the lifecycle of every PTY-hosted CLI in the process.
//
// Sessions are scoped by project so that switching projects (or logging out)
// can terminate the terminals that belong to the project being left, which is
// the only reliable way to guarantee no orphaned CLI keeps running.
import type { EventBus } from '@opencli/events';
import type {
  StartTerminalOptions,
  TerminalExit,
  TerminalSessionInfo,
  TerminalSize,
} from './types.js';
import { TerminalSession } from './session.js';

export interface PtyManagerOptions {
  eventBus?: EventBus;
  /** Maximum number of live PTY sessions. */
  maxSessions?: number;
  /** Called when the last live session ends, e.g. to let the server shut down. */
  onIdle?: () => void;
}

export interface StartSessionInput extends StartTerminalOptions {
  id?: string;
}

export class PtyManager {
  private sessions = new Map<string, TerminalSession>();
  private readonly maxSessions: number;
  private readonly eventBus?: EventBus;
  private readonly onIdle?: () => void;

  constructor(options: PtyManagerOptions = {}) {
    this.eventBus = options.eventBus;
    this.maxSessions = options.maxSessions ?? 12;
    this.onIdle = options.onIdle;
  }

  start(input: StartSessionInput): TerminalSession {
    this.reapExited();

    if (this.sessions.size >= this.maxSessions) {
      throw new Error(
        `Terminal session limit reached (${this.maxSessions}). Close a terminal tab and try again.`,
      );
    }

    const session = TerminalSession.create({
      id: input.id,
      command: input.command,
      projectId: input.projectId,
      adapterId: input.adapterId,
      title: input.title,
      size: input.size,
      scrollbackBytes: input.scrollbackBytes,
    });

    this.sessions.set(session.id, session);
    this.wire(session);

    const info = session.getInfo();
    if (info.error) {
      this.sessions.delete(session.id);
      throw new Error(info.error);
    }

    void this.eventBus?.emit({
      type: 'agent.started',
      agentId: input.adapterId,
      payload: {
        processId: session.id,
        pid: info.pid,
        command: info.command,
        terminal: true,
      },
    });

    return session;
  }

  private wire(session: TerminalSession): void {
    session.on('exit', (exit: TerminalExit) => {
      void this.eventBus?.emit({
        type: 'agent.completed',
        agentId: session.adapterId,
        payload: { processId: session.id, exitCode: exit.exitCode, terminal: true },
      });
      if (this.getLiveCount() === 0) this.onIdle?.();
    });

    session.on('error', (message: string) => {
      void this.eventBus?.emit({
        type: 'agent.crashed',
        agentId: session.adapterId,
        payload: { processId: session.id, error: message, terminal: true },
      });
    });
  }

  get(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  require(sessionId: string): TerminalSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Terminal session not found: ${sessionId}`);
    return session;
  }

  write(sessionId: string, data: string | Buffer): void {
    this.get(sessionId)?.write(data);
  }

  resize(sessionId: string, size: Partial<TerminalSize>): void {
    const session = this.get(sessionId);
    if (!session) return;
    const current = session.getSize();
    session.resize(size.cols ?? current.cols, size.rows ?? current.rows);
  }

  /** Terminates one session. Safe to call repeatedly. */
  kill(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.kill();
    this.sessions.delete(sessionId);
    return true;
  }

  /** Terminates every live session belonging to a project. */
  killProject(projectId: string): number {
    let killed = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.projectId !== projectId) continue;
      if (!session.isAlive()) continue;
      session.kill();
      this.sessions.delete(session.id);
      killed += 1;
    }
    return killed;
  }

  killAll(): number {
    let killed = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.isAlive()) {
        session.kill();
        killed += 1;
      }
    }
    this.sessions.clear();
    return killed;
  }

  list(filter: { projectId?: string } = {}): TerminalSessionInfo[] {
    return [...this.sessions.values()]
      .map((session) => session.getInfo())
      .filter((info) => (filter.projectId ? info.projectId === filter.projectId : true))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  getLiveCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.isAlive()) count += 1;
    }
    return count;
  }

  getLiveCountForProject(projectId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.projectId === projectId && session.isAlive()) count += 1;
    }
    return count;
  }

  /** Drops finished sessions from the registry once the grace period lapses. */
  private reapExited(graceMs = 60_000): void {
    const cutoff = Date.now() - graceMs;
    for (const [id, session] of this.sessions) {
      const info = session.getInfo();
      if (info.endedAt && new Date(info.endedAt).getTime() < cutoff) {
        this.sessions.delete(id);
      }
    }
  }
}
