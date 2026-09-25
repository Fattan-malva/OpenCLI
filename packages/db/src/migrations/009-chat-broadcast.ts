export const migration009 = {
  version: 9,
  sql: `
    ALTER TABLE tasks ADD COLUMN broadcast INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE chat_messages ADD COLUMN request_json TEXT;
  `,
};