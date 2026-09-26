// Terminal launch target resolution.
//
// A PTY cannot launch an arbitrary command the way `child_process.spawn` with
// `shell: true` can. On POSIX that is a non-issue, but on Windows it is the
// single most common reason a CLI "fails to start" inside a terminal host:
//
//   * npm installs CLIs as `<name>.cmd` + `<name>.ps1` + `<name>` shims. Those
//     are batch scripts, not executables, and ConPTY/CreateProcess refuse to
//     run them directly ("File not found").
//   * Even when routed through `cmd.exe /c`, manually quoting the shim path
//     corrupts the command line: ConPTY applies its own quoting, so an extra
//     pair of quotes arrives at cmd.exe as literal characters.
//   * Some shims forward to a Node script with no file extension, which cmd.exe
//     also cannot execute directly.
//
// `resolveLaunchTarget` hides all of that behind one plain
// `{ file, args }` pair, preferring the highest-fidelity option available:
// a real binary spawned directly, then a Node script, then a cmd.exe wrapper.

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve as resolvePath, sep } from 'node:path';

export type LaunchStrategy = 'binary' | 'node-script' | 'cmd-shim';

export interface LaunchTarget {
  /** Executable to hand to `pty.spawn`. */
  file: string;
  /** Arguments, already expanded for `file`. */
  args: string[];
  /** How the target was resolved. Useful for diagnostics. */
  strategy: LaunchStrategy;
  /** The command originally requested, for error messages. */
  requested: string;
  /** True when the resolved command went through cmd.exe. */
  viaShell: boolean;
}

export interface ResolveOptions {
  /** Directory to resolve relative executable paths against. */
  cwd?: string;
  /** Environment used for PATH lookup. */
  env?: NodeJS.ProcessEnv;
  /** Overrides `process.platform`; only useful for tests. */
  platform?: NodeJS.Platform;
}

/** Extensions that CreateProcess can execute without a command interpreter. */
const NATIVE_EXECUTABLE_EXTENSIONS = new Set(['.exe', '.com']);

/** Extensions that require a command interpreter. */
const SHIM_EXTENSIONS = new Set(['.cmd', '.bat']);

const MAX_SHIM_BYTES = 64 * 1024;

/**
 * True when the file is a Windows PE image. Checked by magic bytes rather than
 * by extension so that extensionless npm shims can be classified correctly.
 */
function isPortableExecutable(path: string): boolean {
  let handle: number | undefined;
  try {
    handle = openSync(path, 'r');
    const buffer = Buffer.alloc(2);
    const read = readSync(handle, buffer, 0, 2, 0);
    return read === 2 && buffer[0] === 0x4d && buffer[1] === 0x5a; // 'MZ'
  } catch {
    return false;
  } finally {
    if (handle !== undefined) {
      try {
        closeSync(handle);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Returns the tokenised shebang line of a script, e.g.
 * `#!/usr/bin/env node` -> `['/usr/bin/env', 'node']`.
 */
function readShebang(path: string): string[] | undefined {
  let handle: number | undefined;
  try {
    handle = openSync(path, 'r');
    const size = statSync(path).size;
    const length = Math.min(size, 256);
    const buffer = Buffer.alloc(length);
    const read = readSync(handle, buffer, 0, length, 0);
    const head = buffer.subarray(0, read).toString('utf8');
    if (!head.startsWith('#!')) return undefined;
    const line = head.slice(2).split(/\r?\n/, 1)[0].trim();
    const tokens = line.split(/\s+/).filter(Boolean);
    return tokens.length > 0 ? tokens : undefined;
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) {
      try {
        closeSync(handle);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Maps a tokenised shebang to something we know how to spawn.
 *
 * Handles the two shapes that appear in practice:
 *   #!/usr/bin/env node        (the `env` trampoline)
 *   #!/usr/bin/node            (direct)
 */
function interpreterToSpawn(tokens: string[]): { file: string; prefixArgs: string[] } | undefined {
  if (tokens.length === 0) return undefined;

  let rest = tokens;
  // `env` is a trampoline: skip it plus any option flags it carries. Compare
  // the basename, since the shebang carries an absolute path like
  // `/usr/bin/env`.
  if (basename(rest[0]!).toLowerCase() === 'env') {
    rest = rest.slice(1).filter((token) => !token.startsWith('-'));
  }
  if (rest.length === 0) return undefined;

  const name = basename(rest[0]!).replace(/\.exe$/i, '').toLowerCase();
  if (name === 'node' || name === 'nodejs') {
    return { file: process.execPath, prefixArgs: [] };
  }
  if (name === 'python' || name === 'python3') {
    return { file: 'python', prefixArgs: [] };
  }
  if (name === 'bun') return { file: 'bun', prefixArgs: [] };
  if (name === 'deno') return { file: 'deno', prefixArgs: [] };
  return undefined;
}

/**
 * Extracts the real program a `.cmd`/`.bat` shim forwards to.
 *
 * Handles the two shapes npm emits:
 *   "%dp0%\node_modules\pkg\bin\cli.exe"   %*
 *   "%_prog%"  "%dp0%\node_modules\pkg\bin\cli" %*
 *
 * Returns an absolute path, or undefined when the shim is hand-written and
 * cannot be unwrapped.
 */
export function unwrapShim(shimPath: string): string | undefined {
  let content: string;
  try {
    const size = statSync(shimPath).size;
    if (size > MAX_SHIM_BYTES) return undefined;
    content = readFileSync(shimPath, 'utf8');
  } catch {
    return undefined;
  }

  const shimDir = dirname(shimPath);
  const candidates: string[] = [];

  // Prefer quoted paths, they are unambiguous.
  for (const match of content.matchAll(/"([^"\r\n]+)"/g)) {
    candidates.push(match[1]!);
  }
  // Fall back to unquoted, space-delimited paths.
  for (const match of content.matchAll(/(?:^|[\s&(])([A-Za-z]:\\[^\s"'&|<>^]+)/g)) {
    candidates.push(match[1]!);
  }

  for (const raw of candidates) {
    let candidate: string;

    if (/(?:%~?dp0%|%\w+%|%_prog%)/i.test(raw)) {
      // The shim defines its own substitutions; emulate the common ones.
      // These are path joins, so they use the path separator (sep), not the
      // PATH-list separator (delimiter).
      const base = shimDir.endsWith(sep) ? shimDir : shimDir + sep;
      const expanded = raw
        .replace(/%~?dp0%/gi, base)
        .replace(/%dp0%/gi, base)
        .replace(/%_prog%/gi, process.env.ComSpec ?? 'cmd.exe');
      candidate = resolvePath(expanded);
    } else {
      candidate = isAbsolute(raw) ? raw : resolvePath(shimDir, raw);
    }

    if (isUsableTarget(candidate)) return candidate;
  }

  return undefined;
}

/**
 * Decides whether a path extracted from a shim is the program the shim runs,
 * rather than a trampoline or a reference to the batch interpreter itself.
 *
 * npm-generated shims frequently mention several paths, only one of which is
 * the payload. The others are the saved interpreter path (`%_prog%`, which is
 * cmd.exe) and stray quoted text. Treating any of those as the target would
 * spawn cmd.exe *instead of* the CLI, silently dropping the command name.
 */
function isUsableTarget(candidate: string): boolean {
  if (!existsSync(candidate)) return false;

  // Never unwrap one batch shim into another; that just chains shims.
  if (SHIM_EXTENSIONS.has(extname(candidate).toLowerCase())) return false;

  // The batch interpreter and console host are the shim's own scaffolding.
  if (/(?:^|[\\/])(?:cmd|conhost)(?:\.exe)?$/i.test(candidate)) return false;

  // A shim may reference its own name to detect recursion.
  return true;
}

/** Builds a cmd.exe invocation for a batch shim. */
function cmdShimTarget(shimPath: string, args: string[], requested: string): LaunchTarget {
  const comspec = process.env.ComSpec ?? 'cmd.exe';
  return {
    file: comspec,
    // `/d` skips AutoRun entries so a stray registry autorun cannot corrupt the
    // session. The shim path is intentionally NOT quoted: ConPTY already
    // quotes each argument, and extra quotes would be passed through literally.
    args: ['/d', '/c', shimPath, ...args],
    strategy: 'cmd-shim',
    requested,
    viaShell: true,
  };
}

/** Lists every existing file for `name` across PATH, in PATHEXT-like order. */
function locateOnPath(name: string, env: NodeJS.ProcessEnv): string[] {
  const found: string[] = [];
  const pathValue = env.PATH ?? env.Path ?? env.path ?? '';
  if (!pathValue) return found;

  const dirs = pathValue.split(delimiter).filter(Boolean);
  // Ordered by launch fidelity: a native binary beats a batch shim, and the
  // extensionless npm shim is last. `.ps1` is included so a PowerShell-only
  // install reports why it cannot be hosted rather than "not found".
  const extensions = name.includes('.') ? [''] : ['.exe', '.cmd', '.bat', '.com', '.ps1', ''];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          found.push(candidate);
        }
      } catch {
        /* unreadable PATH entry */
      }
    }
  }
  return found;
}

/** Turns one concrete file on disk into a spawnable target. */
function targetFromFile(path: string, args: string[], requested: string, platform: NodeJS.Platform): LaunchTarget {
  if (platform !== 'win32') {
    return { file: path, args, strategy: 'binary', requested, viaShell: false };
  }

  const ext = extname(path).toLowerCase();

  if (SHIM_EXTENSIONS.has(ext)) {
    const unwrapped = unwrapShim(path);
    if (unwrapped) {
      const resolved = targetFromFile(unwrapped, args, requested, platform);
      if (resolved.strategy !== 'cmd-shim') return resolved;
    }
    return cmdShimTarget(path, args, requested);
  }

  if (ext === '.ps1') {
    // PowerShell shims: cmd.exe cannot run them, node-pty is not a PowerShell
    // host, and spawning pwsh would break TTY semantics. Surface it clearly.
    throw new Error(
      `Cannot launch "${requested}" in a PTY: resolved to a PowerShell shim (${path}). ` +
        `Install a native binary or a .cmd shim for this CLI.`,
    );
  }

  if (NATIVE_EXECUTABLE_EXTENSIONS.has(ext) || isPortableExecutable(path)) {
    return { file: path, args, strategy: 'binary', requested, viaShell: false };
  }

  const shebang = readShebang(path);
  if (shebang) {
    const interpreter = interpreterToSpawn(shebang);
    if (interpreter) {
      return {
        file: interpreter.file,
        args: [...interpreter.prefixArgs, path, ...args],
        strategy: 'node-script',
        requested,
        viaShell: false,
      };
    }
  }

  return cmdShimTarget(path, args, requested);
}

export function resolveLaunchTarget(
  executable: string,
  args: string[],
  options: ResolveOptions = {},
): LaunchTarget {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  if (platform !== 'win32') {
    return { file: executable, args, strategy: 'binary', requested: executable, viaShell: false };
  }

  // Absolute or explicitly relative path: trust the caller.
  if (isAbsolute(executable) || executable.includes('\\') || executable.includes('/')) {
    const candidate = isAbsolute(executable) ? executable : resolvePath(cwd, executable);
    if (existsSync(candidate)) {
      return targetFromFile(candidate, args, executable, platform);
    }
    throw new Error(
      `Cannot launch "${executable}" in a PTY: no such file at ${candidate}.`,
    );
  }

  const located = locateOnPath(executable, env);
  if (located.length === 0) {
    throw new Error(
      `Cannot launch "${executable}" in a PTY: not found on PATH. ` +
        `Install the CLI or set its path in OpenCLI adapter settings.`,
    );
  }

  // First candidate that yields a non-shell launch wins, so a real binary is
  // always preferred over a batch shim sitting in the same directory.
  for (const candidate of located) {
    try {
      const target = targetFromFile(candidate, args, executable, platform);
      if (!target.viaShell) return target;
      if (!located.some((other) => other !== candidate)) return target;
    } catch (error) {
      if (located.length === 1) throw error;
    }
  }

  return targetFromFile(located[0]!, args, executable, platform);
}

/**
 * Builds the environment for an interactive CLI.
 *
 * `TERM=dumb` must never survive: it tells the CLI to skip colours, spinners
 * and cursor control, which is exactly what a PTY host exists to provide.
 */
export function buildTerminalEnv(
  base: NodeJS.ProcessEnv = process.env,
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'string') env[key] = value;
  }

  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  // Many CLIs honour CI=true by switching to non-interactive output.
  delete env.CI;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) {
      delete env[key];
    } else {
      env[key] = String(value);
    }
  }

  return env;
}
