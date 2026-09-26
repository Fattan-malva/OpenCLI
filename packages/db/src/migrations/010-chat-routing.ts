export const migration010 = {
  version: 10,
  sql: `
    -- Chat is addressed to exactly one adapter, so the thread records which one
    -- and which of that adapter's own modes is in use. These are deliberately
    -- separate from the OpenCLI interaction mode stored alongside them.
    ALTER TABLE chat_threads ADD COLUMN chat_adapter_id TEXT;
    ALTER TABLE chat_threads ADD COLUMN adapter_mode TEXT;
    ALTER TABLE chat_threads ADD COLUMN interaction_mode TEXT;
    ALTER TABLE chat_threads ADD COLUMN plan_status TEXT;
  `,
};
