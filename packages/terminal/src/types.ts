// Terminal session types shared by the PTY runtime, the server and the UI.
import type { CommandSpec } from '@opencli/domain';

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'killed';

export type TerminalExitSource = 'exit' | 'signal';

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TerminalExit {
  exitCode: number;
  signal?: number;
  source: TerminalExitSource;
}

export interface TerminalSessionInfo extends TerminalSize {
  id: string;
  projectId?: string;
  adapterId?: string;
  title?: string;
  pid?: number;
  status: TerminalStatus;
  command: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  exit?: TerminalExit;
  /** Populated when the session failed before or during spawn. */
  error?: string;
}

export interface StartTerminalOptions {
  /** The command to host, normally produced by an adapter. */
  command: CommandSpec;
  /** Scope used for project lifecycle management. */
  projectId?: string;
  /** Adapter that produced the command, for grouping in the UI. */
  adapterId?: string;
  /** Human readable label shown on the terminal tab. */
  title?: string;
  /** Initial size. Defaults to 120x32, a safe size for TUIs. */
  size?: Partial<TerminalSize>;
  /**
   * Bytes of PTY output retained so a reconnecting client can replay the
   * screen. Disabled when 0.
   */
  scrollbackBytes?: number;
}

export interface PtyError {
  sessionId: string;
  message: string;
}

export const DEFAULT_TERMINAL_SIZE: Required<TerminalSize> = { cols: 120, rows: 32 };
export const DEFAULT_SCROLLBACK_BYTES = 256 * 1024;

/** Minimums that keep a TUI from computing a degenerate layout. */
export const MIN_TERMINAL_SIZE: Required<TerminalSize> = { cols: 20, rows: 5 };
