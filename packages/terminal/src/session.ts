// A single PTY-hosted CLI process.
import { randomUUID } from 'node:crypto';
import { spawn as ptySpawn, type IPty } from 'node-pty';
import type { CommandSpec } from '@opencli/domain';
import { buildTerminalEnv, resolveLaunchTarget, type LaunchTarget } from './executable.js';
import {
  DEFAULT_SCROLLBACK_BYTES,
  DEFAULT_TERMINAL_SIZE,
  MIN_TERMINAL_SIZE,
  type TerminalExit,
  type TerminalSessionInfo,
  type TerminalSize,
  type TerminalStatus,
} from './types.js';

export interface TerminalSessionEvents {
  /** Raw PTY output. Must be forwarded to the emulator unmodified. */
  data: (chunk: string) => void;
  exit: (exit: TerminalExit) => void;
  error: (message: string) => void;
  status: (status: TerminalStatus) => void;
}

type Listener<K extends keyof TerminalSessionEvents> = TerminalSessionEvents[K];

export class TerminalSession {
  readonly id: string;
  readonly projectId?: string;
  readonly adapterId?: string;
  readonly title?: string;
  readonly startedAt: string;

  private pty: IPty | undefined;
  private status: TerminalStatus = 'starting';
  private endedAt: undefined | string;
  private exit: TerminalExit | undefined;
  private error: string | undefined;
  private cols: number;
  private rows: number;
  private listeners = new Map<keyof TerminalSessionEvents, Set<Listener<never>>>();
  private scrollback = '';
  private readonly scrollbackLimit: number;
  private readonly command: CommandSpec;
  private launch: LaunchTarget | undefined;
  private killRequested = false;

  private constructor(params: {
    id: string;
    command: CommandSpec;
    projectId?: string;
    adapterId?: string;
    title?: string;
    size: Required<TerminalSize>;
    scrollbackBytes: number;
  }) {
    this.id = params.id;
    this.command = params.command;
    this.projectId = params.projectId;
    this.adapterId = params.adapterId;
    this.title = params.title;
    this.cols = params.size.cols;
    this.rows = params.size.rows;
    this.scrollbackLimit = params.scrollbackBytes;
    this.startedAt = new Date().toISOString();
    this.launch = undefined;
  }

  /**
   * Resolves the launch target and spawns the process on a real PTY.
   *
   * Resolution happens before the spawn so that a bad executable surfaces as a
   * rejected promise instead of a session that silently never starts.
   */
  static create(options: {
    command: CommandSpec;
    projectId?: string;
    adapterId?: string;
    title?: string;
    size?: Partial<TerminalSize>;
    scrollbackBytes?: number;
    id?: string;
  }): TerminalSession {
    const size: Required<TerminalSize> = {
      cols: clampSize(options.size?.cols, DEFAULT_TERMINAL_SIZE.cols, MIN_TERMINAL_SIZE.cols),
      rows: clampSize(options.size?.rows, DEFAULT_TERMINAL_SIZE.rows, MIN_TERMINAL_SIZE.rows),
    };

    const session = new TerminalSession({
      id: options.id ?? randomUUID(),
      command: options.command,
      projectId: options.projectId,
      adapterId: options.adapterId,
      title: options.title,
      size,
      scrollbackBytes: options.scrollbackBytes ?? DEFAULT_SCROLLBACK_BYTES,
    });

    session.spawnPty();
    return session;
  }

  private spawnPty(): void {
    const command = this.command;
    let launch: LaunchTarget;

    try {
      launch = resolveLaunchTarget(command.executable, command.arguments, {
        cwd: command.workingDirectory,
        env: { ...process.env, ...command.environment },
      });
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
      return;
    }

    this.launch = launch;

    try {
      const pty = ptySpawn(launch.file, launch.args, {
        name: 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
        cwd: command.workingDirectory,
        env: buildTerminalEnv(process.env, command.environment),
      });

      this.pty = pty;

      pty.onData((chunk: string) => {
        this.appendScrollback(chunk);
        this.emit('data', chunk);
      });

      pty.onExit(({ exitCode, signal }) => {
        const source: TerminalExit['source'] = this.killRequested ? 'signal' : 'exit';
        this.recordExit({ exitCode, signal, source });
      });

      this.status = 'running';
      this.emit('status', 'running');
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private fail(message: string): void {
    this.error = message;
    this.endedAt = new Date().toISOString();
    this.status = 'exited';
    this.emit('error', message);
    this.emit('status', 'exited');
  }

  private recordExit(exit: TerminalExit): void {
    if (this.endedAt) return;
    this.exit = exit;
    this.endedAt = new Date().toISOString();
    this.status = this.killRequested ? 'killed' : 'exited';
    this.pty = undefined;
    this.emit('status', this.status);
    this.emit('exit', exit);
  }

  private appendScrollback(chunk: string): void {
    if (this.scrollbackLimit <= 0) return;
    this.scrollback += chunk;
    if (this.scrollback.length > this.scrollbackLimit) {
      this.scrollback = this.scrollback.slice(-this.scrollbackLimit);
    }
  }

  on<K extends keyof TerminalSessionEvents>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set!.delete(listener as Listener<never>);
    };
  }

  private emit<K extends keyof TerminalSessionEvents>(event: K, ...args: Parameters<Listener<K>>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as (...a: Parameters<Listener<K>>) => void)(...args);
      } catch (err) {
        if (event === 'data') {
          // A broken consumer must never stall the PTY read loop.
          this.error = `data listener failed: ${(err as Error).message}`;
        }
      }
    }
  }

  /** Forwards raw keystrokes (or any bytes) into the CLI. */
  write(data: string | Buffer): void {
    if (!this.pty) return;
    try {
      this.pty.write(data);
    } catch (err) {
      this.emit('error', err instanceof Error ? err.message : String(err));
    }
  }

  resize(cols: number, rows: number): void {
    const nextCols = clampSize(cols, this.cols, MIN_TERMINAL_SIZE.cols);
    const nextRows = clampSize(rows, this.rows, MIN_TERMINAL_SIZE.rows);
    if (nextCols === this.cols && nextRows === this.rows) return;
    this.cols = nextCols;
    this.rows = nextRows;
    if (!this.pty) return;
    try {
      this.pty.resize(nextCols, nextRows);
    } catch (err) {
      this.emit('error', err instanceof Error ? err.message : String(err));
    }
  }

  getSize(): Required<TerminalSize> {
    return { cols: this.cols, rows: this.rows };
  }

  /**
   * Terminates the CLI.
   *
   * On Windows the PTY reports a nonzero exit after a signal, so the session is
   * marked `killed` explicitly to keep the UI from rendering it as a crash.
   */
  kill(): void {
    if (!this.pty || this.endedAt) return;
    this.killRequested = true;
    try {
      this.pty.kill();
    } catch {
      this.recordExit({ exitCode: 0, source: 'signal' });
    }
  }

  isAlive(): boolean {
    return this.pty !== undefined && !this.endedAt;
  }

  /** Retained output, for replaying the screen to a reconnecting client. */
  getScrollback(): string {
    return this.scrollback;
  }

  getLaunchTarget(): LaunchTarget | undefined {
    return this.launch;
  }

  getInfo(): TerminalSessionInfo {
    return {
      id: this.id,
      projectId: this.projectId,
      adapterId: this.adapterId,
      title: this.title,
      pid: this.pty?.pid,
      status: this.status,
      command: this.command.executable,
      cwd: this.command.workingDirectory,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      exit: this.exit,
      error: this.error,
      cols: this.cols,
      rows: this.rows,
    };
  }
}

function clampSize(value: number | undefined, fallback: number, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}
