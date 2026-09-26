export const migration011 = {
  version: 11,
  sql: `
    -- A routing must be able to carry the exact spec the CLI printed, because
    -- reconstructing "provider/model" loses prefixes the CLI requires
    -- (opencode/big-pickle must not become default/big-pickle).
    ALTER TABLE model_routings ADD COLUMN spec TEXT;
  `,
};
