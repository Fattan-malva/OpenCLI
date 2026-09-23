import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { OpenCLIRepository } from '@opencli/db';
import { EventBus, EventBusSSEBridge } from '@opencli/events';
import { InMemoryConfigStore } from '@opencli/config';
import { PermissionEvaluator } from '@opencli/security';
import { ProcessManager } from '@opencli/runtime';
import { Scheduler } from '@opencli/scheduler';
import { GitService } from '@opencli/git';
import { WorkspaceService } from '@opencli/workspace';
import { AdapterRegistry, AdapterRouter } from '@opencli/adapter';
import { discoverAllAgents, agentFromDetection, detectOS } from '@opencli/discovery';
import { OpenCodeAdapter } from '@opencli/adapter-opencode';
import { KiloCodeAdapter } from '@opencli/adapter-kilocode';
import { ClaudeAdapter } from '@opencli/adapter-claude';
import { migrations } from '@opencli/db/src/migrations/index.js';
import { randomUUID, createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { probeCapabilities } from './cli.js';
import { startSession, stopSession, listSessions, getSession, shutdownAll, setSessionMode, setSessionModel, getSessionAgentModes } from './sessions.js';
import { configureWorkflowRuntime, refreshWorkflow, restoreRunningWorkflows } from './workflow.js';

const DATA_DIR = process.env.OPENCLI_DATA ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.opencli');
mkdirSync(DATA_DIR, { recursive: true });

// Initialize core services
const eventBus = new EventBus();
const sseBridge = new EventBusSSEBridge(eventBus);
const db = new OpenCLIRepository({ path: join(DATA_DIR, 'opencli.db') });

// Persist every domain event so Event Bus history survives restarts and the UI can replay state.
eventBus.on('*', (event) => {
  try {
    db.insertEvent(event);
  } catch (error) {
    console.warn('[EventStore] Could not persist event:', error);
  }
});
const config = new InMemoryConfigStore();
const permissions = new PermissionEvaluator();
const runtime = new ProcessManager(eventBus);
const scheduler = new Scheduler(eventBus, { maxConcurrent: 4 });
const gitService = new GitService(eventBus);
const workspaceService = new WorkspaceService(eventBus);
const adapterRegistry = new AdapterRegistry();

// Run migrations
db.migrate(migrations);

// === PIN auth ===
const DEFAULT_PIN = '123456';
const sessions = new Map<string, { expiresAt: number }>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24h

function hashPin(pin: string): string {
  return createHash('sha256').update(`opencli:pinsalt:${pin}`).digest('hex');
}

function seedPinIfMissing() {
  if (!db.getSetting('auth.pinHash')) {
    db.setSetting('auth.pinHash', hashPin(DEFAULT_PIN));
  }
}

function verifyPin(pin: string): boolean {
  const stored = db.getSetting('auth.pinHash');
  if (!stored) return false;
  return hashPin(pin) === stored;
}

function createSession(): string {
  const token = randomUUID() + randomUUID();
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function destroySession(token: string): void {
  sessions.delete(token);
}

function sessionValid(token: string | undefined): boolean {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAuth(c: any, next: () => Promise<void>) {
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!sessionValid(token)) return c.json({ error: 'Unauthorized' }, 401);
  return next();
}

seedPinIfMissing();

// === System settings ===
const DEFAULT_SETTINGS = {
  maxParallelAgents: 4,
  defaultModePolicy: 'Require Approval on Commit (Safe)',
  telemetry: true,
};

function getSystemSettings() {
  const raw = db.getSetting('system.settings');
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

scheduler.setMaxConcurrent(getSystemSettings().maxParallelAgents);

// Register adapters
const openCodeAdapter = new OpenCodeAdapter();
const kiloCodeAdapter = new KiloCodeAdapter();
const claudeAdapter = new ClaudeAdapter();
adapterRegistry.register(openCodeAdapter);
adapterRegistry.register(kiloCodeAdapter);
adapterRegistry.register(claudeAdapter);

// Auto-discover agents on startup
async function discoverAgents() {
  const results = discoverAllAgents();
  for (const { definition, result } of results) {
    if (result.detected && result.path) {
      const adapter = adapterRegistry.get(definition.adapterId);
      if (adapter && 'setExecutablePath' in adapter) {
        (adapter as any).setExecutablePath(result.path);
      }
      const agent = agentFromDetection(definition, result);
      if (agent) {
        db.upsertAgent(agent);
        await eventBus.emit({
          type: 'agent.discovered',
          agentId: agent.id,
          payload: { name: agent.name, version: agent.version, path: agent.path },
        });
      }
    }
  }
}

discoverAgents().catch(console.error);

// Release stale locks on startup
workspaceService.releaseStaleLocks();

const adapterRouter = new AdapterRouter(
  adapterRegistry,
  (adapterId) => getAdapterActive(adapterId),
);

const workflowRuntime = {
  db,
  eventBus,
  scheduler,
  adapterRegistry,
  adapterRouter,
  runtime,
  gitService,
  workspaceService,
};

configureWorkflowRuntime(workflowRuntime);
restoreRunningWorkflows(workflowRuntime);

for (const project of db.listProjects()) {
  scheduler.loadTasks(db.listTasks(project.id));
}

function ensureDefaultWorkflow(projectId: string) {
  const existing = db.listWorkflows(projectId);
  if (existing.length > 0) return existing[0];
  const workflow = db.createWorkflow({
    projectId,
    name: 'Manual Workflow',
    description: 'Tasks created directly from OpenCLI.',
    status: 'draft',
  });
  void eventBus.emit({
    type: 'workflow.created',
    projectId,
    workflowId: workflow.id,
    payload: { name: workflow.name, automatic: true },
  });
  return workflow;
}

function loadWorkflowIntoScheduler(workflowId: string) {
  scheduler.loadTasks(db.listWorkflowTasks(workflowId));
}

function updateWorkflowFromTask(taskId: string) {
  const task = db.getTask(taskId);
  if (task?.workflowId) refreshWorkflow(workflowRuntime, task.workflowId);
}

// === API Routes (mounted at both /api and /) ===
const api = new Hono();

// --- Auth (PIN) ---
api.post('/auth/login', async (c) => {
  const body = await c.req.json<{ pin: string }>();
  if (!verifyPin(String(body.pin ?? ''))) return c.json({ error: 'Invalid PIN' }, 401);
  const token = createSession();
  return c.json({ token });
});

api.post('/auth/logout', requireAuth, (c) => {
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (token) destroySession(token);
  return c.json({ success: true });
});

api.get('/auth/status', requireAuth, (c) => c.json({ authenticated: true }));

api.post('/auth/change-pin', requireAuth, async (c) => {
  const body = await c.req.json<{ currentPin: string; newPin: string }>();
  if (!verifyPin(String(body.currentPin ?? ''))) return c.json({ error: 'Current PIN is incorrect' }, 401);
  if (!body.newPin || String(body.newPin).length < 4 || String(body.newPin).length > 12) {
    return c.json({ error: 'New PIN must be 4-12 characters' }, 400);
  }
  db.setSetting('auth.pinHash', hashPin(String(body.newPin)));
  return c.json({ success: true });
});

// --- System settings ---
api.get('/settings', requireAuth, (c) => c.json(getSystemSettings()));

api.put('/settings', requireAuth, async (c) => {
  const body = await c.req.json();
  const merged = { ...getSystemSettings(), ...(body ?? {}) };
  db.setSetting('system.settings', JSON.stringify(merged));
  return c.json({ success: true, settings: merged });
});

// --- Filesystem browsing (for project creation) ---
api.get('/fs/list', requireAuth, (c) => {
  const raw = c.req.query('path');
  const target = raw && raw.trim() ? resolve(raw.trim()) : homedir();
  try {
    if (!existsSync(target)) return c.json({ error: 'Path does not exist' }, 404);
    const stat = statSync(target);
    if (!stat.isDirectory()) return c.json({ error: 'Not a directory' }, 400);
    const entries = readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ path: target, parent: dirname(target) === target ? null : dirname(target), entries });
  } catch {
    return c.json({ error: 'Failed to read directory' }, 500);
  }
});

api.post('/fs/mkdir', requireAuth, async (c) => {
  const body = await c.req.json<{ path: string; name: string }>();
  if (!body.path || !body.name) return c.json({ error: 'path and name are required' }, 400);
  const target = resolve(body.path, body.name);
  const targetExists = existsSync(target);
  try {
    if (!targetExists) mkdirSync(target, { recursive: false });
    return c.json({ name: body.name, path: target, created: !targetExists }, 201);
  } catch (e: any) {
    if (e?.code === 'EEXIST') return c.json({ name: body.name, path: target, created: false }, 201);
    return c.json({ error: 'Failed to create folder' }, 500);
  }
});

// --- Projects ---
api.get('/projects', (c) => {
  return c.json(
    db.listProjects().map((project) => ({
      ...project,
      pathExists: existsSync(project.path),
    })),
  );
});

api.post('/projects', async (c) => {
  const body = await c.req.json<{ name: string; path: string }>();
  if (!body.path || !existsSync(body.path)) return c.json({ error: 'Project path must exist' }, 400);
  const project = db.createProject({ name: body.name, path: body.path, status: 'active' });
  return c.json(project, 201);
});

api.get('/projects/:id', (c) => {
  const project = db.getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Not found' }, 404);
  return c.json(project);
});

api.patch('/projects/:id', async (c) => {
  const updates = await c.req.json();
  const project = db.updateProject(c.req.param('id'), updates);
  if (!project) return c.json({ error: 'Not found' }, 404);
  return c.json(project);
});

api.delete('/projects/:id', (c) => {
  const deleted = db.deleteProject(c.req.param('id'));
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// --- Agents ---
api.get('/agents', (c) => {
  return c.json(db.listAgents());
});

api.get('/agents/:id', (c) => {
  const agent = db.getAgent(c.req.param('id'));
  if (!agent) return c.json({ error: 'Not found' }, 404);
  return c.json(agent);
});

// --- Discovery ---
const ADAPTER_ACTIVE_KEY = (id: string) => `adapter.active.${id}`;

function getAdapterActive(id: string): boolean {
  const v = db.getSetting(ADAPTER_ACTIVE_KEY(id));
  // Adapters are opt-in. "Installed" means available on the machine;
  // "Active" means explicitly enabled by the user for OpenCLI orchestration.
  if (v === null || v === undefined) return false;
  return v === '1';
}

api.get('/adapters', (c) => {
  const results = discoverAllAgents();
  const platform = detectOS().platform;
  const adapters = results.map(({ definition, result }) => ({
    id: definition.id,
    name: definition.name,
    icon: definition.icon ?? definition.id,
    homepage: definition.homepage,
    installed: result.detected,
    version: result.version ?? undefined,
    path: result.path ?? undefined,
    executable: result.executable ?? definition.executables[0],
    capabilities: definition.capabilities ?? [],
    installCommands: definition.installCommands?.[platform] ?? [],
    active: getAdapterActive(definition.id),
  }));
  return c.json(adapters);
});

api.post('/adapters/:id/active', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ active: boolean }>();
  db.setSetting(ADAPTER_ACTIVE_KEY(id), body?.active ? '1' : '0');
  return c.json({ id, active: body?.active ?? false });
});

// --- Adapter capabilities (real CLI probe: modes / providers / models) ---
api.get('/adapters/:id/capabilities', async (c) => {
  const id = c.req.param('id');
  const force = c.req.query('force') === '1';
  try {
    const caps = await probeCapabilities(id, force);
    return c.json(caps);
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'probe failed' }, 500);
  }
});

api.get('/projects/:projectId/adapters/:adapterId/capabilities', async (c) => {
  const projectId = c.req.param('projectId');
  const adapterId = c.req.param('adapterId');
  const project = db.getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    const session = getSession(projectId, adapterId);
    const runtimeModes = await getSessionAgentModes(projectId, adapterId);
    const capabilities = await probeCapabilities(adapterId, false, runtimeModes.length > 0 ? runtimeModes : undefined);

    // When the adapter is running, prefer its live server agent catalog.
    // This includes project-local agents and avoids brittle CLI-output parsing.
    if (runtimeModes.length > 0) {
      return c.json({
        ...capabilities,
        modes: runtimeModes,
        current: {
          ...capabilities.current,
          mode: session?.activeMode ?? capabilities.current.mode,
          provider: session?.activeProvider ?? capabilities.current.provider,
          model: session?.activeModel ?? capabilities.current.model,
        },
      });
    }

    return c.json(capabilities);
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'probe failed' }, 500);
  }
});

api.put('/adapters/:id/capabilities', (c) => {
  return c.json(
    {
      error:
        'Adapter capabilities are read-only. Use project model routing to change the runtime model without editing adapter configuration.',
    },
    410,
  );
});

// --- Project runtime model routing (does not modify adapter config files) ---
api.get('/projects/:projectId/model-routing', (c) => {
  const project = db.getProject(c.req.param('projectId'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(db.listModelRoutings(project.id));
});

api.put('/projects/:projectId/model-routing/:agentId/:modeId', async (c) => {
  const projectId = c.req.param('projectId');
  const agentId = c.req.param('agentId');
  const modeId = c.req.param('modeId');
  const project = db.getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{ provider?: string; model?: string }>();
  const provider = String(body?.provider ?? '').trim();
  const model = String(body?.model ?? '').trim();
  if (!provider || !model) {
    return c.json({ error: 'provider and model are required' }, 400);
  }

  try {
    const capabilities = await probeCapabilities(agentId, true);
    const modeExists = capabilities.modes.some((mode) => mode.id === modeId);
    if (!modeExists) return c.json({ error: `Unknown mode: ${modeId}` }, 400);

    const providerModels = capabilities.models[provider] ?? [];
    if (providerModels.length > 0 && !providerModels.includes(model)) {
      return c.json({ error: `Model ${provider}/${model} is not available for adapter ${agentId}` }, 400);
    }

    const routing = db.setModelRouting(projectId, agentId, modeId, provider, model);
    const session = getSession(projectId, agentId);
    let applied = false;
    let applyError: string | undefined;

    if (session?.status === 'running' && session.activeMode === modeId) {
      const result = await setSessionModel(projectId, agentId, provider, model);
      applied = result.ok;
      if (!result.ok) applyError = result.error;
    }

    return c.json({ routing, applied, applyError });
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'Unable to save model routing' }, 500);
  }
});

api.post('/projects/:projectId/sessions/mode', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json<{ adapterId?: string; mode?: string }>();
  const adapterId = String(body?.adapterId ?? '').trim();
  const mode = String(body?.mode ?? '').trim();
  if (!adapterId || !mode) return c.json({ error: 'adapterId and mode are required' }, 400);

  const result = await setSessionMode(projectId, adapterId, mode);
  if (!result.ok) return c.json({ error: result.error ?? 'Failed to switch session mode' }, 409);
  return c.json({ success: true, adapterId, mode });
});

async function applyProjectModelRouting(
  projectId: string,
  adapterId: string,
  session: Awaited<ReturnType<typeof startSession>>,
): Promise<void> {
  const mode = session.activeMode;
  if (!mode) return;
  const selected = db.listModelRoutings(projectId)[adapterId]?.[mode];
  if (!selected) return;

  const result = await setSessionModel(projectId, adapterId, selected.provider, selected.model);
  if (!result.ok) {
    console.warn(
      `[ModelRouting] Could not apply ${adapterId} ${mode} -> ${selected.provider}/${selected.model}: ${result.error}`,
    );
  }
}

// --- Adapter sessions (spawn / stop real CLI in project folder) ---
api.post('/projects/:projectId/sessions/start', async (c) => {
  const projectId = c.req.param('projectId');
  const project = db.getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{ adapterId?: string; adapterName?: string }>().catch(() => ({} as any));
  const adapterId = body.adapterId;
  if (!adapterId) return c.json({ error: 'adapterId required' }, 400);

  const installed = discoverAllAgents().some(({ definition, result }) => definition.id === adapterId && result.detected);
  if (!installed) return c.json({ error: 'Adapter not installed' }, 404);

  console.log(`[Server] Starting session for ${adapterId} in project ${projectId}`);
  const state = await startSession({
    projectId,
    adapterId,
    adapterName: body.adapterName ?? adapterId,
    projectPath: project.path,
  });
  await applyProjectModelRouting(projectId, adapterId, state);
  console.log(`[Server] Session state: ${state.status}, PID: ${state.pid}`);

  await eventBus.emit({
    type: 'agent.started',
    agentId: adapterId,
    projectId,
    payload: { adapterId, status: state.status, pid: state.pid },
  });
  return c.json(state, state.status === 'failed' ? 500 : 200);
});

api.post('/projects/:projectId/sessions/stop', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json<{ adapterId?: string }>();
  if (!body.adapterId) return c.json({ error: 'adapterId required' }, 400);

  console.log(`[Server] Stopping session for ${body.adapterId} in project ${projectId}`);
  const ok = await stopSession(projectId, body.adapterId);
  console.log(`[Server] Session stopped: ${ok}`);

  await eventBus.emit({
    type: 'agent.stopped',
    agentId: body.adapterId,
    projectId,
    payload: { adapterId: body.adapterId },
  });
  return c.json({ success: ok });
});

api.get('/projects/:projectId/sessions', (c) => {
  return c.json(listSessions(c.req.param('projectId')));
});

api.get('/projects/:projectId/sessions/:adapterId', (c) => {
  const session = getSession(c.req.param('projectId'), c.req.param('adapterId'));
  if (!session) return c.json({ error: 'Session not found' }, 404);
  return c.json(session);
});

// Start all installed + active adapters for a project (auto-start on open)
api.post('/projects/:projectId/sessions/start-all', async (c) => {
  const projectId = c.req.param('projectId');
  const project = db.getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const results = [];
  for (const { definition, result } of discoverAllAgents()) {
    if (!result.detected || !getAdapterActive(definition.id)) continue;
    const state = await startSession({
      projectId,
      adapterId: definition.id,
      adapterName: definition.name,
      projectPath: project.path,
    });
    await applyProjectModelRouting(projectId, definition.id, state);
    results.push(state);
  }
  return c.json(results);
});

api.post('/projects/:projectId/sessions/runtime', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json<{ adapterId?: string; command?: string }>();
  const adapterId = body?.adapterId;
  const command = body?.command;
  if (!adapterId || !command) return c.json({ error: 'adapterId and command required' }, 400);

  const { sendRuntimeCommand } = await import('./sessions.js');
  const result = await sendRuntimeCommand(projectId, adapterId, command);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json({ ok: true, output: result.output });
});

process.on('exit', () => shutdownAll());
process.on('SIGINT', () => {
  shutdownAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdownAll();
  process.exit(0);
});

api.post('/discovery/scan', async (c) => {
  const results = discoverAllAgents();
  const agents = [];
  for (const { definition, result } of results) {
    if (result.detected && result.path) {
      const adapter = adapterRegistry.get(definition.adapterId);
      if (adapter && 'setExecutablePath' in adapter) {
        (adapter as any).setExecutablePath(result.path);
      }
      const agent = agentFromDetection(definition, result);
      if (agent) {
        db.upsertAgent(agent);
        agents.push(agent);
      }
    }
  }
  return c.json({ agents });
});

// --- Tasks ---
api.get('/projects/:projectId/tasks', (c) => {
  return c.json(db.listTasks(c.req.param('projectId')));
});

api.post('/projects/:projectId/tasks', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json<{
    title: string;
    description?: string;
    workflowId?: string;
    dependencies?: string[];
    agentId?: string;
    modeId?: string;
    modelId?: string;
    fileScopes?: string[];
    priority?: number;
  }>();

  const workflow = body.workflowId
    ? db.getWorkflow(body.workflowId)
    : ensureDefaultWorkflow(projectId);

  if (!workflow || workflow.projectId !== projectId) {
    return c.json({ error: 'Workflow not found for this project' }, 400);
  }

  const dependencies = body.dependencies ?? [];
  if (dependencies.length > 0) {
    const known = new Set(db.listWorkflowTasks(workflow.id).map((task) => task.id));
    const missing = dependencies.filter((id) => !known.has(id));
    if (missing.length > 0) return c.json({ error: `Unknown task dependencies: ${missing.join(', ')}` }, 400);
  }

  const task = db.createTask({
    projectId,
    workflowId: workflow.id,
    title: body.title,
    description: body.description,
    status: 'pending',
    priority: body.priority ?? 0,
    dependencies,
    agentId: body.agentId,
    modeId: body.modeId,
    modelId: body.modelId,
    fileScopes: body.fileScopes ?? [],
    retryCount: 0,
    maxRetries: 3,
  });

  scheduler.addTask(task);

  return c.json(task, 201);
});

api.get('/tasks/:id', (c) => {
  const task = db.getTask(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  return c.json(task);
});

api.patch('/tasks/:id', async (c) => {
  const updates = await c.req.json();
  const task = db.updateTask(c.req.param('id'), updates);
  if (!task) return c.json({ error: 'Not found' }, 404);
  scheduler.loadTasks([task]);
  updateWorkflowFromTask(task.id);
  return c.json(task);
});

api.post('/tasks/:id/start', async (c) => {
  const task = db.getTask(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  if (!task.workflowId) return c.json({ error: 'Task is not attached to a workflow' }, 400);

  loadWorkflowIntoScheduler(task.workflowId);
  db.updateWorkflow(task.workflowId, { status: 'running' });
  const result = await scheduler.startWorkflow(task.workflowId);
  if (!result.started) {
    db.updateWorkflow(task.workflowId, { status: 'draft' });
    return c.json({ error: result.errors.join('; ') }, 409);
  }
  refreshWorkflow(workflowRuntime, task.workflowId);
  return c.json({ success: true, taskId: task.id, workflowId: task.workflowId });
});

api.post('/tasks/:id/cancel', async (c) => {
  const task = db.getTask(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);

  scheduler.cancel(task.id);
  db.updateTask(task.id, { status: 'cancelled' });

  return c.json({ success: true });
});

// --- Task Graph ---
api.get('/projects/:projectId/graph', (c) => {
  const workflowId = c.req.query('workflowId');
  const tasks = workflowId ? db.listWorkflowTasks(workflowId) : db.listTasks(c.req.param('projectId'));
  scheduler.loadTasks(tasks);
  return c.json(scheduler.getGraph(workflowId));
});

// --- Events ---
api.get('/projects/:projectId/events', (c) => {
  const limit = parseInt(c.req.query('limit') ?? '100', 10);
  const events = db.listEvents({ projectId: c.req.param('projectId') }, limit);
  return c.json(events);
});

// --- SSE Events ---
api.get('/events/stream', (c) => {
  const projectId = c.req.query('projectId');
  const workflowId = c.req.query('workflowId');
  const taskId = c.req.query('taskId');
  const agentId = c.req.query('agentId');

  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  };

  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const unsubscribe = sseBridge.subscribe(
        { projectId, workflowId, taskId, agentId },
        (data) => {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        },
      );

      // Send initial heartbeat
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      // Keepalive
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
        }
      }, 30000);

      // Cleanup on close
      c.req.raw.signal?.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(keepalive);
        controller.close();
      });
    },
  });

  return new Response(body, { headers });
});

// --- Scheduler stats ---
api.get('/scheduler/stats', (c) => {
  return c.json(scheduler.getStats());
});

// --- Workflows ---
api.get('/projects/:projectId/workflows', (c) => {
  return c.json(db.listWorkflows(c.req.param('projectId')));
});

api.post('/projects/:projectId/workflows', async (c) => {
  const projectId = c.req.param('projectId');
  const project = db.getProject(projectId);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{ name?: string; description?: string }>();
  const name = String(body?.name ?? '').trim();
  if (!name) return c.json({ error: 'Workflow name is required' }, 400);

  const workflow = db.createWorkflow({
    projectId,
    name,
    description: body.description,
    status: 'draft',
  });
  await eventBus.emit({
    type: 'workflow.created',
    projectId,
    workflowId: workflow.id,
    payload: { name: workflow.name },
  });
  return c.json(workflow, 201);
});

api.get('/workflows/:workflowId', (c) => {
  const workflow = db.getWorkflow(c.req.param('workflowId'));
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
  return c.json(workflow);
});

api.get('/workflows/:workflowId/tasks', (c) => {
  const workflow = db.getWorkflow(c.req.param('workflowId'));
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
  return c.json(db.listWorkflowTasks(workflow.id));
});

api.get('/workflows/:workflowId/graph', (c) => {
  const workflow = db.getWorkflow(c.req.param('workflowId'));
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);
  loadWorkflowIntoScheduler(workflow.id);
  return c.json(scheduler.getGraph(workflow.id));
});

api.post('/workflows/:workflowId/start', async (c) => {
  const workflow = db.getWorkflow(c.req.param('workflowId'));
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);

  loadWorkflowIntoScheduler(workflow.id);
  const tasks = db.listWorkflowTasks(workflow.id);
  if (tasks.length === 0) return c.json({ error: 'Workflow has no tasks' }, 400);

  db.updateWorkflow(workflow.id, { status: 'running' });
  const result = await scheduler.startWorkflow(workflow.id);
  if (!result.started) {
    db.updateWorkflow(workflow.id, { status: 'draft' });
    return c.json({ error: result.errors.join('; '), details: result.errors }, 409);
  }

  refreshWorkflow(workflowRuntime, workflow.id);
  return c.json({ workflow: db.getWorkflow(workflow.id), stats: scheduler.getStats() });
});

api.post('/workflows/:workflowId/pause', async (c) => {
  const workflow = db.getWorkflow(c.req.param('workflowId'));
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);

  for (const task of db.listWorkflowTasks(workflow.id)) {
    if (task.status === 'running' && task.workspaceId) {
      const sessions = db.getRunningSessions().filter((session) => session.taskId === task.id);
      const session = sessions.find((item) => item.status === 'running');
      if (session?.processId) {
        await runtime.pause(session.processId);
        const process = runtime.getProcess(session.processId);
        if (process?.status === 'paused') {
          db.updateSession(session.id, { status: 'paused' });
          db.updateTask(task.id, { status: 'paused' });
        }
      }
    }
  }

  scheduler.pauseWorkflow(workflow.id);
  const updated = db.updateWorkflow(workflow.id, { status: 'paused' });
  return c.json(updated);
});

api.post('/workflows/:workflowId/resume', async (c) => {
  const workflow = db.getWorkflow(c.req.param('workflowId'));
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);

  for (const task of db.listWorkflowTasks(workflow.id)) {
    if (task.status === 'paused' && task.workspaceId) {
      const sessions = db.listSessions({ taskId: task.id });
      const session = sessions.find((item) => item.status === 'paused');
      if (session?.processId) {
        await runtime.resume(session.processId);
        db.updateSession(session.id, { status: 'running' });
        db.updateTask(task.id, { status: 'running' });
      }
    }
  }

  loadWorkflowIntoScheduler(workflow.id);
  scheduler.resumeWorkflow(workflow.id);
  const updated = db.updateWorkflow(workflow.id, { status: 'running' });
  return c.json(updated);
});

api.post('/workflows/:workflowId/cancel', async (c) => {
  const workflow = db.getWorkflow(c.req.param('workflowId'));
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);

  for (const task of db.listWorkflowTasks(workflow.id)) {
    if (task.status !== 'running') continue;
    const session = db.getRunningSessions().find((item) => item.taskId === task.id && item.processId);
    if (session?.processId) {
      await runtime.cancel(session.processId);
      db.updateSession(session.id, { status: 'failed', endedAt: new Date().toISOString() });
    }
  }

  scheduler.cancelWorkflow(workflow.id);
  const updated = db.updateWorkflow(workflow.id, { status: 'cancelled' });
  return c.json(updated);
});

api.get('/workflows/:workflowId/events', (c) => {
  const workflow = db.getWorkflow(c.req.param('workflowId'));
  if (!workflow) return c.json({ error: 'Workflow not found' }, 404);

  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') ?? '100', 10)));
  return c.json(db.listEvents({ workflowId: workflow.id }, limit));
});



// --- Runtime ---
api.get('/runtime/processes', (c) => {
  return c.json(runtime.getResourceSnapshot());
});

// --- Config ---
api.get('/config/global', (c) => {
  return c.json(config.getGlobal());
});

api.get('/config/routing/:projectId/:category', (c) => {
  const routing = config.resolveRouting(c.req.param('projectId'), c.req.param('category'));
  return c.json(routing ?? {});
});

// === Root app: mount API at both /api and / (root) ===
const app = new Hono();
app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes available at /api/* and */
app.route('/api', api);
app.route('/', api);

// === Serve UI static files ===
const UI_DIST = join(__dirname, '..', '..', 'ui', 'dist');
app.use('/assets/*', serveStatic({ root: UI_DIST }));
app.get('*', serveStatic({ root: UI_DIST }));
app.get('*', serveStatic({ path: join(UI_DIST, 'index.html') }));

// === Start server ===
const port = parseInt(process.env.PORT ?? '3000', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║         OpenCLI is running           ║`);
  console.log(`  ╠══════════════════════════════════════╣`);
  console.log(`  ║  Server : http://localhost:${info.port}     ║`);
  console.log(`  ║  UI     : http://localhost:${info.port}     ║`);
  console.log(`  ║  Data   : ${DATA_DIR}  ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});