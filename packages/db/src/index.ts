import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  Project,
  Workflow,
  WorkflowStatus,
  Agent,
  Provider,
  Model,
  Task,
  Workspace,
  Lock,
  OpenCLIEvent,
  Session,
} from '@opencli/domain';

export interface DBConfig {
  path: string;
}

export class OpenCLIRepository {
  private db: Database.Database;

  constructor(config: DBConfig) {
    this.db = new Database(config.path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  // === Projects ===

  createWorkflow(workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>): Workflow {
    const now = new Date().toISOString();
    const row: Workflow = { ...workflow, id: randomUUID(), createdAt: now, updatedAt: now };
    this.db.prepare(
      `INSERT INTO workflows (id, project_id, name, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.projectId,
      row.name,
      row.description ?? null,
      row.status,
      row.createdAt,
      row.updatedAt,
    );
    return row;
  }

  getWorkflow(id: string): Workflow | undefined {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
    return row ? this.mapWorkflow(row) : undefined;
  }

  listWorkflows(projectId: string): Workflow[] {
    const rows = this.db.prepare(
      'SELECT * FROM workflows WHERE project_id = ? ORDER BY updated_at DESC',
    ).all(projectId) as any[];
    return rows.map((row) => this.mapWorkflow(row));
  }

  updateWorkflow(id: string, updates: Partial<Workflow>): Workflow | undefined {
    const existing = this.getWorkflow(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.db.prepare(
      `UPDATE workflows
       SET name=?, description=?, status=?, updated_at=?
       WHERE id=?`,
    ).run(
      updated.name,
      updated.description ?? null,
      updated.status,
      updated.updatedAt,
      id,
    );
    return updated;
  }

  deleteWorkflow(id: string): boolean {
    const result = this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // === Projects ===

  createProject(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project {
    const now = new Date().toISOString();
    const projectRow: Project = {
      ...project,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO projects (id, name, path, git_repository, default_agent, default_mode, default_model, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectRow.id,
        projectRow.name,
        projectRow.path,
        projectRow.gitRepository ?? null,
        projectRow.defaultAgent ?? null,
        projectRow.defaultMode ?? null,
        projectRow.defaultModel ?? null,
        projectRow.status,
        projectRow.createdAt,
        projectRow.updatedAt,
      );
    return projectRow;
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? this.mapProject(row) : undefined;
  }

  listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[];
    return rows.map((r) => this.mapProject(r));
  }

  updateProject(id: string, updates: Partial<Project>): Project | undefined {
    const existing = this.getProject(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.db
      .prepare(
        `UPDATE projects SET name=?, path=?, git_repository=?, default_agent=?, default_mode=?, default_model=?, status=?, updated_at=? WHERE id=?`,
      )
      .run(
        updated.name,
        updated.path,
        updated.gitRepository ?? null,
        updated.defaultAgent ?? null,
        updated.defaultMode ?? null,
        updated.defaultModel ?? null,
        updated.status,
        updated.updatedAt,
        id,
      );
    return updated;
  }

  deleteProject(id: string): boolean {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // === Tasks ===

  createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const now = new Date().toISOString();
    const taskRow: Task = { ...task, id: randomUUID(), createdAt: now, updatedAt: now };
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, workflow_id, title, description, status, priority, agent_id, mode_id, model_id, workspace_id, retry_count, max_retries, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        taskRow.id,
        taskRow.projectId,
        taskRow.workflowId ?? null,
        taskRow.title,
        taskRow.description ?? null,
        taskRow.status,
        taskRow.priority,
        taskRow.agentId ?? null,
        taskRow.modeId ?? null,
        taskRow.modelId ?? null,
        taskRow.workspaceId ?? null,
        taskRow.retryCount,
        taskRow.maxRetries,
        taskRow.createdAt,
        taskRow.updatedAt,
      );
    // Insert dependencies
    if (task.dependencies.length > 0) {
      const stmt = this.db.prepare(
        'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)',
      );
      for (const depId of task.dependencies) {
        stmt.run(taskRow.id, depId);
      }
    }
    // Insert file scopes
    if (task.fileScopes.length > 0) {
      const stmt = this.db.prepare(
        'INSERT INTO task_file_scopes (task_id, scope) VALUES (?, ?)',
      );
      for (const scope of task.fileScopes) {
        stmt.run(taskRow.id, scope);
      }
    }
    return taskRow;
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return this.hydrateTask(row);
  }

  listTasks(projectId: string): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at ASC')
      .all(projectId) as any[];
    return rows.map((r) => this.hydrateTask(r));
  }

  listWorkflowTasks(workflowId: string): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE workflow_id = ? ORDER BY priority DESC, created_at ASC')
      .all(workflowId) as any[];
    return rows.map((r) => this.hydrateTask(r));
  }

  updateTask(id: string, updates: Partial<Task>): Task | undefined {
    const existing = this.getTask(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.db
      .prepare(
        `UPDATE tasks SET workflow_id=?, title=?, description=?, status=?, priority=?, agent_id=?, mode_id=?, model_id=?, workspace_id=?, retry_count=?, max_retries=?, updated_at=? WHERE id=?`,
      )
      .run(
        updated.workflowId ?? null,
        updated.title,
        updated.description ?? null,
        updated.status,
        updated.priority,
        updated.agentId ?? null,
        updated.modeId ?? null,
        updated.modelId ?? null,
        updated.workspaceId ?? null,
        updated.retryCount,
        updated.maxRetries,
        updated.updatedAt,
        id,
      );
    // Re-sync dependencies
    this.db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(id);
    if (updated.dependencies.length > 0) {
      const stmt = this.db.prepare(
        'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)',
      );
      for (const depId of updated.dependencies) {
        stmt.run(id, depId);
      }
    }
    // Re-sync file scopes
    this.db.prepare('DELETE FROM task_file_scopes WHERE task_id = ?').run(id);
    if (updated.fileScopes.length > 0) {
      const stmt = this.db.prepare(
        'INSERT INTO task_file_scopes (task_id, scope) VALUES (?, ?)',
      );
      for (const scope of updated.fileScopes) {
        stmt.run(id, scope);
      }
    }
    return updated;
  }

  private hydrateTask(row: any): Task {
    const deps = this.db
      .prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?')
      .all(row.id)
      .map((d: any) => d.depends_on_task_id);
    const scopes = this.db
      .prepare('SELECT scope FROM task_file_scopes WHERE task_id = ?')
      .all(row.id)
      .map((s: any) => s.scope);
    return this.mapTask(row, deps, scopes);
  }

  // === Events ===

  insertEvent(event: OpenCLIEvent): void {
    this.db
      .prepare(
        `INSERT INTO events (id, type, project_id, workflow_id, task_id, agent_id, timestamp, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.type,
        event.projectId ?? null,
        event.workflowId ?? null,
        event.taskId ?? null,
        event.agentId ?? null,
        event.timestamp,
        JSON.stringify(event.payload),
      );
  }

  listEvents(
    filter: { projectId?: string; workflowId?: string; taskId?: string; agentId?: string },
    limit = 100,
  ): OpenCLIEvent[] {
    let query = 'SELECT * FROM events WHERE 1=1';
    const params: any[] = [];
    if (filter.projectId) {
      query += ' AND project_id = ?';
      params.push(filter.projectId);
    }
    if (filter.workflowId) {
      query += ' AND workflow_id = ?';
      params.push(filter.workflowId);
    }
    if (filter.taskId) {
      query += ' AND task_id = ?';
      params.push(filter.taskId);
    }
    if (filter.agentId) {
      query += ' AND agent_id = ?';
      params.push(filter.agentId);
    }
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => this.mapEvent(r));
  }

  // === Agents ===

  upsertAgent(agent: Agent): void {
    this.db
      .prepare(
        `INSERT INTO agents (id, name, executable, path, version, installed, status, adapter_id, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, executable=excluded.executable, path=excluded.path, version=excluded.version, installed=excluded.installed, status=excluded.status, adapter_id=excluded.adapter_id, metadata_json=excluded.metadata_json`,
      )
      .run(
        agent.id,
        agent.name,
        agent.executable,
        agent.path ?? null,
        agent.version ?? null,
        agent.installed ? 1 : 0,
        agent.status,
        agent.adapterId,
        JSON.stringify({ capabilities: agent.capabilities, modes: agent.modes }),
      );
  }

  listAgents(): Agent[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY name').all() as any[];
    return rows.map((r) => this.mapAgent(r));
  }

  getAgent(id: string): Agent | undefined {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any;
    return row ? this.mapAgent(row) : undefined;
  }

  // === Workspaces ===

  createWorkspace(ws: Omit<Workspace, 'id' | 'createdAt'>): Workspace {
    const row: Workspace = { ...ws, id: randomUUID(), createdAt: new Date().toISOString() };
    this.db
      .prepare(
        `INSERT INTO workspaces (id, project_id, task_id, path, branch, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.projectId, row.taskId ?? null, row.path, row.branch ?? null, row.status, row.createdAt);
    return row;
  }

  getWorkspace(id: string): Workspace | undefined {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;
    return row ? this.mapWorkspace(row) : undefined;
  }

  // === Locks ===

  acquireLock(lock: Omit<Lock, 'id' | 'createdAt'>): Lock | undefined {
    const existing = this.db
      .prepare(
        'SELECT * FROM locks WHERE project_id = ? AND resource = ? AND expires_at > ?',
      )
      .get(lock.projectId, lock.resource, new Date().toISOString()) as any;
    if (existing) return undefined; // Resource already locked
    const row: Lock = { ...lock, id: randomUUID(), createdAt: new Date().toISOString() };
    this.db
      .prepare(
        `INSERT INTO locks (id, project_id, resource, owner_type, owner_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.projectId, row.resource, row.ownerType, row.ownerId, row.expiresAt ?? null, row.createdAt);
    return row;
  }

  releaseLock(id: string): boolean {
    const result = this.db.prepare('DELETE FROM locks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  releaseStaleLocks(): number {
    const result = this.db
      .prepare('DELETE FROM locks WHERE expires_at IS NOT NULL AND expires_at <= ?')
      .run(new Date().toISOString());
    return result.changes;
  }

  listLocks(projectId: string): Lock[] {
    const rows = this.db
      .prepare('SELECT * FROM locks WHERE project_id = ?')
      .all(projectId) as any[];
    return rows.map((r) => this.mapLock(r));
  }

  // === Sessions ===

  createSession(session: Omit<Session, 'id'>): Session {
    const row: Session = { ...session, id: randomUUID() };
    this.db
      .prepare(
        `INSERT INTO sessions (id, agent_id, task_id, process_id, status, started_at, ended_at, exit_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.agentId,
        row.taskId ?? null,
        row.processId ?? null,
        row.status,
        row.startedAt,
        row.endedAt ?? null,
        row.exitCode ?? null,
      );
    return row;
  }

  updateSession(id: string, updates: Partial<Session>): void {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.endedAt !== undefined) {
      sets.push('ended_at = ?');
      params.push(updates.endedAt);
    }
    if (updates.exitCode !== undefined) {
      sets.push('exit_code = ?');
      params.push(updates.exitCode);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  getRunningSessions(): Session[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE status IN ('running', 'paused')")
      .all() as any[];
    return rows.map((r) => this.mapSession(r));
  }

  // === Runtime model routing ===

  listModelRoutings(projectId: string): Record<string, Record<string, { provider: string; model: string }>> {
    const rows = this.db
      .prepare(
        'SELECT agent_id, mode_id, provider, model FROM model_routings WHERE project_id = ? ORDER BY agent_id, mode_id',
      )
      .all(projectId) as Array<{
      agent_id: string;
      mode_id: string;
      provider: string;
      model: string;
    }>;

    const result: Record<string, Record<string, { provider: string; model: string }>> = {};
    for (const row of rows) {
      (result[row.agent_id] ??= {})[row.mode_id] = {
        provider: row.provider,
        model: row.model,
      };
    }
    return result;
  }

  setModelRouting(
    projectId: string,
    agentId: string,
    modeId: string,
    provider: string,
    model: string,
  ): { projectId: string; agentId: string; modeId: string; provider: string; model: string; updatedAt: string } {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO model_routings (project_id, agent_id, mode_id, provider, model, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, agent_id, mode_id)
         DO UPDATE SET provider=excluded.provider, model=excluded.model, updated_at=excluded.updated_at`,
      )
      .run(projectId, agentId, modeId, provider, model, updatedAt);

    return { projectId, agentId, modeId, provider, model, updatedAt };
  }

  // === Settings (key/value) ===

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  getSettingsMap(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as any[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // === Migrations ===

  migrate(migrations: Array<{ version: number; sql: string }>): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`,
    );
    const applied = new Set(
      (this.db.prepare('SELECT version FROM _migrations').all() as any[]).map((r) => r.version),
    );
    for (const migration of migrations.sort((a, b) => a.version - b.version)) {
      if (!applied.has(migration.version)) {
        this.db.exec(migration.sql);
        this.db
          .prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
      }
    }
  }

  // === Mapper helpers ===

  private mapWorkflow(row: any): Workflow {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description ?? undefined,
      status: row.status as WorkflowStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapProject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      gitRepository: row.git_repository ?? undefined,
      defaultAgent: row.default_agent ?? undefined,
      defaultMode: row.default_mode ?? undefined,
      defaultModel: row.default_model ?? undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTask(row: any, dependencies: string[], fileScopes: string[]): Task {
    return {
      id: row.id,
      projectId: row.project_id,
      workflowId: row.workflow_id ?? undefined,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status,
      priority: row.priority,
      dependencies,
      agentId: row.agent_id ?? undefined,
      modeId: row.mode_id ?? undefined,
      modelId: row.model_id ?? undefined,
      workspaceId: row.workspace_id ?? undefined,
      fileScopes,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapEvent(row: any): OpenCLIEvent {
    return {
      id: row.id,
      type: row.type,
      projectId: row.project_id ?? undefined,
      workflowId: row.workflow_id ?? undefined,
      taskId: row.task_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      timestamp: row.timestamp,
      payload: JSON.parse(row.payload_json),
    };
  }

  private mapAgent(row: any): Agent {
    const meta = row.metadata_json ? JSON.parse(row.metadata_json) : {};
    return {
      id: row.id,
      name: row.name,
      executable: row.executable,
      path: row.path ?? undefined,
      version: row.version ?? undefined,
      status: row.status,
      capabilities: meta.capabilities ?? [],
      modes: meta.modes ?? [],
      adapterId: row.adapter_id,
      installed: row.installed === 1,
    };
  }

  private mapWorkspace(row: any): Workspace {
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id ?? undefined,
      path: row.path,
      branch: row.branch ?? undefined,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  private mapLock(row: any): Lock {
    return {
      id: row.id,
      projectId: row.project_id,
      resource: row.resource,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      expiresAt: row.expires_at ?? undefined,
      createdAt: row.created_at,
    };
  }

  private mapSession(row: any): Session {
    return {
      id: row.id,
      agentId: row.agent_id,
      taskId: row.task_id ?? undefined,
      processId: row.process_id ?? undefined,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      exitCode: row.exit_code ?? undefined,
    };
  }
}
