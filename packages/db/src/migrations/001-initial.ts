export const migration001 = {
  version: 1,
  sql: `
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      git_repository TEXT,
      default_agent TEXT,
      default_mode TEXT,
      default_model TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      executable TEXT NOT NULL,
      path TEXT,
      version TEXT,
      installed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT,
      credential_ref TEXT,
      metadata_json TEXT
    );

    CREATE TABLE models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      context_window INTEGER,
      capabilities_json TEXT,
      metadata_json TEXT,
      FOREIGN KEY(provider_id) REFERENCES providers(id)
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      agent_id TEXT,
      mode_id TEXT,
      model_id TEXT,
      workspace_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      PRIMARY KEY(task_id, depends_on_task_id),
      FOREIGN KEY(task_id) REFERENCES tasks(id),
      FOREIGN KEY(depends_on_task_id) REFERENCES tasks(id)
    );

    CREATE TABLE task_file_scopes (
      task_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      PRIMARY KEY(task_id, scope),
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    );

    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      path TEXT NOT NULL,
      branch TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      project_id TEXT,
      task_id TEXT,
      agent_id TEXT,
      timestamp TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      process_id TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      exit_code INTEGER
    );

    CREATE TABLE locks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_tasks_project ON tasks(project_id);
    CREATE INDEX idx_tasks_status ON tasks(status);
    CREATE INDEX idx_events_project ON events(project_id);
    CREATE INDEX idx_events_type ON events(type);
    CREATE INDEX idx_events_timestamp ON events(timestamp);
    CREATE INDEX idx_sessions_agent ON sessions(agent_id);
    CREATE INDEX idx_locks_project ON locks(project_id);
    CREATE INDEX idx_locks_resource ON locks(project_id, resource);
  `,
};
