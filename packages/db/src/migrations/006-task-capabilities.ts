export const migration006 = {
  version: 6,
  sql: `
    ALTER TABLE tasks ADD COLUMN required_capabilities_json TEXT;
  `,
};
