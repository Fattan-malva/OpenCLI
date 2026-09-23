export const migration003 = {
  version: 3,
  sql: `
    CREATE TABLE model_routings (
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      mode_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, agent_id, mode_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_model_routings_project ON model_routings(project_id);
    CREATE INDEX idx_model_routings_agent ON model_routings(project_id, agent_id);
  `,
};
