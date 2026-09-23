# 23 — Recommended Repository Layout

```text
opencli/
├── apps/
│   └── desktop/
│
├── crates/
│   ├── opencli-core/
│   ├── opencli-domain/
│   ├── opencli-runtime/
│   ├── opencli-scheduler/
│   ├── opencli-workspace/
│   ├── opencli-git/
│   ├── opencli-config/
│   ├── opencli-events/
│   ├── opencli-security/
│   ├── opencli-installer/
│   └── opencli-adapters/
│
├── adapters/
│   ├── claude/
│   ├── codex/
│   ├── opencode/
│   └── gemini/
│
├── packages/
│   └── ui/
│
├── migrations/
│
├── docs/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
│
├── scripts/
│
├── Cargo.toml
├── package.json
└── README.md
```

The exact monorepo structure can change, but domain/core/adapters should remain separated.
