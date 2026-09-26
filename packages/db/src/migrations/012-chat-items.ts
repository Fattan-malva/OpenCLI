export const migration012 = {
  version: 12,
  sql: `
    -- Structured turn content, folded from protocol events on the server.
    -- The text column stays the assistant's prose only, so a reader (and the
    -- planner) never has to read past tool calls to find the answer.
    ALTER TABLE chat_messages ADD COLUMN items_json TEXT;
  `,
};
