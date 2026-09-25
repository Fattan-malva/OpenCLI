export const migration008 = {
  version: 8,
  sql: `
    ALTER TABLE chat_messages ADD COLUMN meta_json TEXT;
  `,
};
