export const migration007 = {
  version: 7,
  sql: `
    ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual';

    CREATE TABLE chat_threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      workflow_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      agent_id TEXT,
      task_id TEXT,
      text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'complete',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_chat_threads_project ON chat_threads(project_id, updated_at DESC);
    CREATE INDEX idx_chat_messages_thread ON chat_messages(thread_id, created_at ASC);
    CREATE INDEX idx_chat_messages_task ON chat_messages(task_id);
  `,
};
