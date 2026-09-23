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
import { AdapterRegistry } from '@opencli/adapter';
import { discoverAllAgents, agentFromDetection } from '@opencli/discovery';
import { OpenCodeAdapter } from '@opencli/adapter-opencode';
import { KiloCodeAdapter } from '@opencli/adapter-kilocode';
import { ClaudeAdapter } from '@opencli/adapter-claude';
import { migrations } from '@opencli/db/src/migrations/index.js';
import { randomUUID, createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const DATA_DIR = process.env.OPENCLI_DATA ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.opencli');
mkdirSync(DATA_DIR, { recursive: true });

// Initialize core services
const eventBus = new EventBus();
const sseBridge = new EventBusSSEBridge(eventBus);
const db = new OpenCLIRepository({ path: join(DATA_DIR, 'opencli.db') });
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
  return c.json(db.listProjects());
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
  const body = await c.req.json<{
    title: string;
    description?: string;
    dependencies?: string[];
    agentId?: string;
    modeId?: string;
    modelId?: string;
    fileScopes?: string[];
    priority?: number;
  }>();

  const task = db.createTask({
    projectId: c.req.param('projectId'),
    title: body.title,
    description: body.description,
    status: 'pending',
    priority: body.priority ?? 0,
    dependencies: body.dependencies ?? [],
    agentId: body.agentId,
    modeId: body.modeId,
    modelId: body.modelId,
    fileScopes: body.fileScopes ?? [],
    retryCount: 0,
    maxRetries: 3,
  });

  scheduler.addTask(task);

  await eventBus.emit({
    type: 'task.created',
    taskId: task.id,
    projectId: task.projectId,
    payload: { title: task.title },
  });

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
  return c.json(task);
});

api.post('/tasks/:id/start', async (c) => {
  const task = db.getTask(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);

  scheduler.markReady(task.id);
  scheduler.markRunning(task.id);
  db.updateTask(task.id, { status: 'running' });

  return c.json({ success: true, taskId: task.id });
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
  const tasks = db.listTasks(c.req.param('projectId'));
  for (const task of tasks) {
    scheduler.addTask(task);
  }
  return c.json(scheduler.getGraph());
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
        { projectId, taskId, agentId },
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