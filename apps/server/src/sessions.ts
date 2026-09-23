// Adapter session manager: runs CLI commands in the open project folder,
// the same way you would type `opencode`, `kilo`, or `claude` in a terminal.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { adapterCommand } from '@opencli/discovery';

export interface SessionState {
  projectId: string;
  adapterId: string;
  adapterName: string;
  pid: number | null;
  status: 'starting' | 'running' | 'exited' | 'failed';
  startedAt: string;
  endedAt?: string;
  command?: string;
  error?: string;
}

interface SessionEntry extends SessionState {
  child?: ChildProcess;
}

const SESSIONS = new Map<string, SessionEntry>();

function key(projectId: string, adapterId: string): string {
  return `${projectId}:${adapterId}`;
}

const SERVE_ARGS: Record<string, (() => string[]) | undefined> = {
  opencode: () => ['serve', '--port', '0'],
  kilocode: () => ['serve', '--port', '0'],
};

function claudeArgs(): string[] {
  return ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
}

export function listSessions(projectId: string): SessionState[] {
  const out: SessionState[] = [];
  for (const entry of SESSIONS.values()) {
    if (entry.projectId !== projectId) continue;
    const { child, ...state } = entry;
    out.push({ ...state, status: alive(entry) ? 'running' : (entry.status === 'failed' ? 'failed' : 'exited') });
  }
  return out;
}

export function getSession(projectId: string, adapterId: string): SessionState | undefined {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry) return undefined;
  const { child, ...state } = entry;
  return { ...state, status: alive(entry) ? 'running' : (entry.status === 'failed' ? 'failed' : 'exited') };
}

function alive(entry: SessionEntry): boolean {
  if (!entry.child || entry.status !== 'running') return false;
  return entry.child.exitCode === null && entry.child.signalCode === null;
}

export async function startSession(opts: {
  projectId: string;
  adapterId: string;
  adapterName: string;
  projectPath: string;
}): Promise<SessionState> {
  const { projectId, adapterId, adapterName, projectPath } = opts;
  const existing = SESSIONS.get(key(projectId, adapterId));
  if (existing && alive(existing)) {
    const { child, ...state } = existing;
    return { ...state, status: 'running' };
  }

  if (!existsSync(projectPath)) {
    const error = `Project folder not found: ${projectPath}`;
    const state: SessionState = {
      projectId,
      adapterId,
      adapterName,
      pid: null,
      status: 'failed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      error,
    };
    SESSIONS.set(key(projectId, adapterId), state);
    console.error(`[${adapterId}] ${error}`);
    return state;
  }

  const cmd = adapterCommand(adapterId);
  if (!cmd) {
    const state: SessionState = {
      projectId,
      adapterId,
      adapterName,
      pid: null,
      status: 'failed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      error: `Unknown adapter: ${adapterId}`,
    };
    SESSIONS.set(key(projectId, adapterId), state);
    return state;
  }

  const build = SERVE_ARGS[adapterId];
  const args = adapterId === 'claude' ? claudeArgs() : build ? build() : [];
  const now = new Date().toISOString();
  const commandLine = `${cmd} ${args.join(' ')}`.trim();

  const state: SessionEntry = {
    projectId,
    adapterId,
    adapterName,
    pid: null,
    status: 'starting',
    startedAt: now,
    command: commandLine,
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (s: SessionEntry) => {
      if (!settled) {
        settled = true;
        const { child, ...rest } = s;
        resolve({ ...rest, status: alive(s) ? 'running' : s.status });
      }
    };

    console.log(`[${adapterId}] Running in ${projectPath}: ${commandLine}`);

    const child = spawn(cmd, args, {
      cwd: projectPath,
      detached: false,
      windowsHide: true,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(process.platform !== 'win32' ? { TERM: 'dumb' } : {}),
      },
    });

    state.child = child;
    state.pid = child.pid ?? null;
    if (state.pid) state.status = 'running';
    SESSIONS.set(key(projectId, adapterId), state);
    finish(state);

    child.stdout?.on('data', (data) => {
      console.log(`[${adapterId}] stdout:`, data.toString());
    });

    child.stderr?.on('data', (data) => {
      console.log(`[${adapterId}] stderr:`, data.toString());
    });

    child.on('exit', (code) => {
      console.log(`[${adapterId}] Process exited with code:`, code);
      const current = SESSIONS.get(key(projectId, adapterId));
      if (current) {
        current.status = code === 0 ? 'exited' : 'failed';
        current.endedAt = new Date().toISOString();
        current.child = undefined;
      }
    });

    child.on('error', (err) => {
      console.error(`[${adapterId}] Process error:`, err);
      const current = SESSIONS.get(key(projectId, adapterId));
      if (current) {
        current.status = 'failed';
        current.endedAt = new Date().toISOString();
        current.error = err.message;
        current.child = undefined;
      }
    });
  });
}

export async function stopSession(projectId: string, adapterId: string): Promise<boolean> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry || !entry.child || !entry.child.pid) return false;

  const pid = entry.child.pid;
  console.log(`[${adapterId}] Stopping process with PID: ${pid}`);

  try {
    if (process.platform === 'win32') {
      await new Promise<void>((res) => {
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, (err) => {
          if (err) console.error(`[${adapterId}] Failed to kill process:`, err);
          res();
        });
      });
    } else {
      entry.child.kill('SIGTERM');
    }
    console.log(`[${adapterId}] Process stopped successfully`);
  } catch (err) {
    console.error(`[${adapterId}] Error stopping process:`, err);
  }

  entry.status = 'exited';
  entry.endedAt = new Date().toISOString();
  entry.child = undefined;
  return true;
}

export function stopAll(projectId: string): void {
  for (const [k, entry] of SESSIONS.entries()) {
    if (entry.projectId !== projectId) continue;
    SESSIONS.delete(k);
  }
}

export async function sendRuntimeCommand(
  projectId: string,
  adapterId: string,
  command: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry || !entry.child || !alive(entry)) {
    return { ok: false, error: 'Session not running' };
  }

  const child = entry.child;
  if (!child.stdin) {
    return { ok: false, error: 'Process stdin unavailable' };
  }

  try {
    if (adapterId === 'claude') {
      const payload = {
        type: 'user',
        message: command,
        parent_tool_use_id: null,
      };
      child.stdin.write(JSON.stringify(payload) + '\n');
      return { ok: true, output: 'Sent to Claude stdin' };
    }

    child.stdin.write(command + '\n');
    return { ok: true, output: 'Sent to CLI stdin' };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to send command' };
  }
}

export function shutdownAll(): void {
  for (const entry of SESSIONS.values()) {
    if (entry.child && entry.child.pid) {
      try {
        if (process.platform === 'win32') {
          execFile('taskkill', ['/pid', String(entry.child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
        } else {
          entry.child.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    }
  }
  SESSIONS.clear();
}
