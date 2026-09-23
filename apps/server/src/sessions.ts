// Adapter session manager: runs CLI commands in the open project folder,
// the same way you would type `opencode`, `kilo`, or `claude` in a terminal.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
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
  serverUrl?: string;
  sessionId?: string;
  activeMode?: string;
  activeProvider?: string;
  activeModel?: string;
}

interface SessionEntry extends SessionState {
  child?: ChildProcess;
}

const SESSIONS = new Map<string, SessionEntry>();

function key(projectId: string, adapterId: string): string {
  return `${projectId}:${adapterId}`;
}

const SERVE_ADAPTERS = new Set(['opencode', 'kilocode']);

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function serveArgs(adapterId: string, port: number): string[] | undefined {
  if (!SERVE_ADAPTERS.has(adapterId)) return undefined;
  return ['serve', '--port', String(port), '--hostname', '127.0.0.1'];
}

async function requestJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  let data: any = undefined;
  try {
    data = await response.json();
  } catch {
    // Some successful endpoints intentionally return no JSON body.
  }
  return { ok: response.ok, status: response.status, data };
}

async function listRemoteAgents(baseUrl: string): Promise<Array<{ id: string; name: string; mode: string; hidden?: boolean }>> {
  for (const path of ['/api/agent', '/agent']) {
    try {
      const response = await requestJson(baseUrl + path, {}, 5000);
      if (!response.ok) continue;
      const raw = response.data?.data ?? response.data;
      if (!Array.isArray(raw)) continue;
      return raw
        .filter((agent: any) => agent && typeof agent.name === 'string')
        .map((agent: any) => ({
          id: String(agent.id ?? agent.name),
          name: String(agent.name),
          mode: String(agent.mode ?? 'all'),
          hidden: Boolean(agent.hidden),
        }));
    } catch {
      // Try the compatibility endpoint below.
    }
  }
  return [];
}

async function remoteConfigModel(baseUrl: string): Promise<{ provider: string; model: string } | undefined> {
  for (const path of ['/api/config', '/config', '/global/config', '/api/global/config']) {
    try {
      const response = await requestJson(baseUrl + path, {}, 5000);
      if (!response.ok) continue;
      const raw = response.data?.data ?? response.data;
      const spec = typeof raw?.model === 'string' ? raw.model : '';
      const index = spec.indexOf('/');
      if (index > 0 && spec.slice(index + 1)) {
        return { provider: spec.slice(0, index), model: spec.slice(index + 1) };
      }
    } catch {
      // Try the next compatibility endpoint.
    }
  }
  return undefined;
}

async function waitForServer(baseUrl: string, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const path of ['/global/health', '/api/global/health']) {
      try {
        const res = await requestJson(`${baseUrl}${path}`, {}, 1500);
        if (res.ok) return;
      } catch {
        // Server is still booting.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Adapter server did not become ready at ${baseUrl}`);
}

async function createRemoteSession(entry: SessionEntry): Promise<void> {
  if (!entry.serverUrl || !SERVE_ADAPTERS.has(entry.adapterId)) return;

  await waitForServer(entry.serverUrl);

  // Read runtime agents from the running server instead of parsing CLI text.
  // This keeps project-local Plan/Build/custom agents aligned with reality.
  const agents = await listRemoteAgents(entry.serverUrl);
  const selectable = agents.filter((agent) => !agent.hidden && (agent.mode === 'primary' || agent.mode === 'all'));
  const activeAgent =
    selectable.find((agent) => agent.name === 'build') ??
    selectable.find((agent) => agent.name === 'plan') ??
    selectable[0];

  // Pin the configured model when the server exposes one so a headless
  // session does not silently resolve to an unrelated catalog default.
  const configuredModel = await remoteConfigModel(entry.serverUrl);

  const body: Record<string, unknown> = {};
  if (activeAgent) body.agent = activeAgent.id;
  if (configuredModel) {
    body.model = { providerID: configuredModel.provider, id: configuredModel.model };
  }

  let created: any;
  for (const endpoint of ['/api/session', '/session']) {
    try {
      const response = await requestJson(`${entry.serverUrl}${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (response.ok) {
        created = response.data;
        break;
      }
    } catch {
      // Try the compatibility endpoint below.
    }
  }

  const session = created?.data ?? created;
  const sessionId = session?.id;
  if (!sessionId) {
    throw new Error(`Failed to create ${entry.adapterId} runtime session`);
  }

  entry.sessionId = String(sessionId);
  entry.activeMode = activeAgent?.id;
  entry.activeProvider = configuredModel?.provider;
  entry.activeModel = configuredModel?.model;
}

async function postSessionRuntime(
  entry: SessionEntry,
  path: 'agent' | 'model',
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (!entry.serverUrl || !entry.sessionId) return { ok: false, error: 'Runtime session is not ready' };

  const endpoints = [`/api/session/${encodeURIComponent(entry.sessionId)}/${path}`, `/session/${encodeURIComponent(entry.sessionId)}/${path}`];
  let lastError = 'Runtime session endpoint unavailable';
  for (const endpoint of endpoints) {
    try {
      const response = await requestJson(`${entry.serverUrl}${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (response.ok) return { ok: true };
      lastError = `${response.status}: ${response.data?.message ?? response.data?.error ?? 'request failed'}`;
    } catch (error: any) {
      lastError = error?.message ?? lastError;
    }
  }
  return { ok: false, error: lastError };
}

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

  const port = SERVE_ADAPTERS.has(adapterId) ? await getFreePort() : undefined;
  const args = adapterId === 'claude' ? claudeArgs() : (port ? serveArgs(adapterId, port) ?? [] : []);
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
    serverUrl: port ? `http://127.0.0.1:${port}` : undefined,
  };

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

  try {
    await createRemoteSession(state);
  } catch (error: any) {
    // Keep the adapter process alive even if its optional HTTP control plane is unavailable.
    state.error = error?.message ?? 'Failed to initialize runtime session';
    console.warn(`[${adapterId}] Runtime session initialization failed:`, state.error);
  }

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

  return { ...state, status: alive(state) ? 'running' : state.status };
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

export async function getSessionAgentModes(
  projectId: string,
  adapterId: string,
): Promise<Array<{ id: string; name: string }>> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry?.serverUrl || !SERVE_ADAPTERS.has(adapterId)) return [];

  const agents = await listRemoteAgents(entry.serverUrl);
  return agents
    .filter((agent) => !agent.hidden && (agent.mode === 'primary' || agent.mode === 'all'))
    .map((agent) => ({ id: agent.id, name: agent.name }));
}

export async function setSessionMode(
  projectId: string,
  adapterId: string,
  mode: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry || !alive(entry)) return { ok: false, error: 'Session not running' };

  if (SERVE_ADAPTERS.has(adapterId)) {
    const remote = await postSessionRuntime(entry, 'agent', { agent: mode });
    if (remote.ok) {
      entry.activeMode = mode;
      return { ok: true, output: `Session agent switched to ${mode}` };
    }
    // Fall back to the same slash command the CLI TUI understands.
  }

  if (!entry.child?.stdin) return { ok: false, error: 'Process stdin unavailable' };
  try {
    if (adapterId === 'claude') {
      entry.child.stdin.write(JSON.stringify({ type: 'mode', mode }) + '\\n');
    } else {
      entry.child.stdin.write(`/mode ${mode}\\n`);
    }
    entry.activeMode = mode;
    return { ok: true, output: `Sent mode switch to ${mode}` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to switch session mode' };
  }
}

export async function setSessionModel(
  projectId: string,
  adapterId: string,
  provider: string,
  model: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry || !alive(entry)) return { ok: false, error: 'Session not running' };

  if (SERVE_ADAPTERS.has(adapterId)) {
    const remote = await postSessionRuntime(entry, 'model', { model: { providerID: provider, id: model } });
    if (remote.ok) {
      entry.activeProvider = provider;
      entry.activeModel = model;
      return { ok: true, output: `Session model switched to ${provider}/${model}` };
    }
  }

  if (!entry.child?.stdin) return { ok: false, error: 'Process stdin unavailable' };
  try {
    if (adapterId === 'claude') {
      entry.child.stdin.write(JSON.stringify({ type: 'config', model: `${provider}/${model}` }) + '\\n');
    } else {
      entry.child.stdin.write(`/models ${provider}/${model}\\n`);
    }
    entry.activeProvider = provider;
    entry.activeModel = model;
    return { ok: true, output: `Sent model switch to ${provider}/${model}` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to switch session model' };
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
