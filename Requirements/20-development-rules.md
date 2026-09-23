# 20 — Development Rules

## Rule 1 — Never hardcode agent behavior into the scheduler

Bad:

```text
if agent == claude ...
```

Good:

```text
scheduler -> AgentAdapter interface
```

## Rule 2 — Never treat CLI output as state

CLI output becomes events. OpenCLI state is authoritative.

## Rule 3 — Never run all agents in one shared directory by default

Use isolated workspaces.

## Rule 4 — Never silently overwrite active work

Use ownership and locks.

## Rule 5 — Never store secrets in project config

Use OS credential storage.

## Rule 6 — Never assume package manager availability

Use installer discovery.

## Rule 7 — Never assume every agent supports the same modes

Modes are adapter-defined and normalized.

## Rule 8 — Never assume model configuration is identical across agents

Adapters translate OpenCLI model configuration into agent-specific behavior.

## Rule 9 — Every long-running operation must be cancellable

Process, installation, workflow, and task execution need cancellation.

## Rule 10 — Every process needs cleanup

No orphaned child processes.

## Rule 11 — Every state transition must be explicit

Use a state machine rather than arbitrary status strings.

## Rule 12 — Every risky operation must pass permission checks

The AI cannot bypass OpenCLI permissions.

## Rule 13 — Preserve user work

Never delete uncommitted workspace data automatically.

## Rule 14 — Prefer structured data

Events, tasks, artifacts, logs, and agent status should be structured.

## Rule 15 — Keep the core vendor-neutral

No provider or agent should become a required dependency.

## Definition of Done

A feature is complete when:
- unit tests exist
- integration behavior is covered
- failure behavior is defined
- permissions are evaluated
- logs/events are emitted
- UI state is represented
- recovery behavior is documented
