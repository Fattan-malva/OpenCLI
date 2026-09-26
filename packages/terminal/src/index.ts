// @opencli/terminal — PTY hosting for native AI coding CLIs.
//
// The rest of OpenCLI talks to CLIs through pipes and parses their output into
// OpenCLI events. This package provides the other half: a real pseudo-terminal
// per CLI so the original TUI, keyboard handling and ANSI rendering survive
// intact and can be forwarded to an emulator such as xterm.js unmodified.

export {
  buildTerminalEnv,
  resolveLaunchTarget,
  unwrapShim,
  type LaunchStrategy,
  type LaunchTarget,
  type ResolveOptions,
} from './executable.js';

export { TerminalSession, type TerminalSessionEvents } from './session.js';

export { PtyManager, type PtyManagerOptions, type StartSessionInput } from './manager.js';

export {
  DEFAULT_SCROLLBACK_BYTES,
  DEFAULT_TERMINAL_SIZE,
  MIN_TERMINAL_SIZE,
  type PtyError,
  type StartTerminalOptions,
  type TerminalExit,
  type TerminalExitSource,
  type TerminalSessionInfo,
  type TerminalSize,
  type TerminalStatus,
} from './types.js';
