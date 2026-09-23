export const migration004 = {
  version: 4,
  sql: `
    CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    ALTER TABLE tasks ADD COLUMN workflow_id TEXT;

    CREATE INDEX idx_workflows_project ON workflows(project_id);
    CREATE INDEX idx_workflows_status ON workflows(status);
    CREATE INDEX idx_tasks_workflow ON tasks(workflow_id);
  `,
};
