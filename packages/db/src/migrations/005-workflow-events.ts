export const migration005 = {
  version: 5,
  sql: `
    ALTER TABLE events ADD COLUMN workflow_id TEXT;
    CREATE INDEX idx_events_workflow ON events(workflow_id);
  `,
};
