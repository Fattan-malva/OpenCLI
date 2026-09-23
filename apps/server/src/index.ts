import { Hono } from 'hono';
import { cors } from 'hono/cors';
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
import type { Task, Project } from '@opencli/domain';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const DATA_DIR = process.env.OPENCLI_DATA ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.opencli');

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

// === API Routes ===
const app = new Hono();
app.use('*', cors());

// Health
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// --- Projects ---
app.get('/projects', (c) => {
  return c.json(db.listProjects());
});

app.post('/projects', async (c) => {
  const body = await c.req.json<{ name: string; path: string }>();
  const project = db.createProject({ name: body.name, path: body.path, status: 'active' });
  return c.json(project, 201);
});

app.get('/projects/:id', (c) => {
  const project = db.getProject(c.req.param('id'));
  if (!project) return c.json({ error: 'Not found' }, 404);
  return c.json(project);
});

app.patch('/projects/:id', async (c) => {
  const updates = await c.req.json();
  const project = db.updateProject(c.req.param('id'), updates);
  if (!project) return c.json({ error: 'Not found' }, 404);
  return c.json(project);
});

app.delete('/projects/:id', (c) => {
  const deleted = db.deleteProject(c.req.param('id'));
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// --- Agents ---
app.get('/agents', (c) => {
  return c.json(db.listAgents());
});

app.get('/agents/:id', (c) => {
  const agent = db.getAgent(c.req.param('id'));
  if (!agent) return c.json({ error: 'Not found' }, 404);
  return c.json(agent);
});

// --- Discovery ---
app.post('/discovery/scan', async (c) => {
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
app.get('/projects/:projectId/tasks', (c) => {
  return c.json(db.listTasks(c.req.param('projectId')));
});

app.post('/projects/:projectId/tasks', async (c) => {
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

app.get('/tasks/:id', (c) => {
  const task = db.getTask(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  return c.json(task);
});

app.patch('/tasks/:id', async (c) => {
  const updates = await c.req.json();
  const task = db.updateTask(c.req.param('id'), updates);
  if (!task) return c.json({ error: 'Not found' }, 404);
  return c.json(task);
});

app.post('/tasks/:id/start', async (c) => {
  const task = db.getTask(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);

  scheduler.markReady(task.id);
  scheduler.markRunning(task.id);
  db.updateTask(task.id, { status: 'running' });

  return c.json({ success: true, taskId: task.id });
});

app.post('/tasks/:id/cancel', async (c) => {
  const task = db.getTask(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);

  scheduler.cancel(task.id);
  db.updateTask(task.id, { status: 'cancelled' });

  return c.json({ success: true });
});

// --- Task Graph ---
app.get('/projects/:projectId/graph', (c) => {
  const tasks = db.listTasks(c.req.param('projectId'));
  for (const task of tasks) {
    scheduler.addTask(task);
  }
  return c.json(scheduler.getGraph());
});

// --- Events ---
app.get('/projects/:projectId/events', (c) => {
  const limit = parseInt(c.req.query('limit') ?? '100', 10);
  const events = db.listEvents({ projectId: c.req.param('projectId') }, limit);
  return c.json(events);
});

// --- SSE Events ---
app.get('/events/stream', (c) => {
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
app.get('/scheduler/stats', (c) => {
  return c.json(scheduler.getStats());
});

// --- Runtime ---
app.get('/runtime/processes', (c) => {
  return c.json(runtime.getResourceSnapshot());
});

// --- Config ---
app.get('/config/global', (c) => {
  return c.json(config.getGlobal());
});

app.get('/config/routing/:projectId/:category', (c) => {
  const routing = config.resolveRouting(c.req.param('projectId'), c.req.param('category'));
  return c.json(routing ?? {});
});

// === Start server ===
const port = parseInt(process.env.PORT ?? '3000', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`OpenCLI server running on http://localhost:${info.port}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
