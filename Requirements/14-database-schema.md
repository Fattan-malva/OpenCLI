# 14 — Database Schema

SQLite is recommended for the first implementation.

## Tables

### projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  git_repository TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### agents

```sql
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
```

### providers

```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT,
  credential_ref TEXT,
  metadata_json TEXT
);
```

### models

```sql
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata_json TEXT,
  FOREIGN KEY(provider_id) REFERENCES providers(id)
);
```

### tasks

```sql
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
```

### task_dependencies

```sql
CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  PRIMARY KEY(task_id, depends_on_task_id)
);
```

### workspaces

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  path TEXT NOT NULL,
  branch TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### events

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  agent_id TEXT,
  timestamp TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
```

### sessions

```sql
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
```

### locks

```sql
CREATE TABLE locks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  expires_at TEXT
);
```

## Migration policy

Database migrations must be versioned and reversible where practical.
