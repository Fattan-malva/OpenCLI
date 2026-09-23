# 24 — Acceptance Scenarios

## Scenario A — Discovery

Given Claude Code is installed and OpenCode is not installed:

When OpenCLI scans the OS:

Then Claude Code is shown as installed and OpenCode as unavailable/not installed.

## Scenario B — Parallel tasks

Given T002 and T003 have no dependencies:

When the scheduler starts:

Then both may run simultaneously if resource limits allow.

## Scenario C — Dependency

Given T004 depends on T002:

When T002 is running:

Then T004 remains blocked.

When T002 completes successfully:

Then T004 becomes READY.

## Scenario D — File conflict

Given T002 owns `src/auth/**`:

When T003 requests a file under that scope:

Then OpenCLI must not silently permit simultaneous modification.

## Scenario E — Agent crash

Given Codex is running T003:

When the process crashes:

Then:
- session is marked crashed/failed
- logs are preserved
- runtime locks are released/reconciled
- workspace remains available
- task can be retried or reassigned

## Scenario F — Model override

Given project default build agent is OpenCode:

When task T007 explicitly requests Codex + a specific model:

Then T007 uses that task-level configuration.

## Scenario G — Installation

Given an agent is missing:

When user clicks Install:

Then OpenCLI displays the installation source and requested permissions before execution.

## Scenario H — Secret safety

Given a provider has an API key:

Then the key is not stored in project files or normal logs.

## Scenario I — Recovery

Given OpenCLI is closed while tasks are running:

When OpenCLI starts again:

Then it reconstructs sessions and task states from persistent data and does not falsely mark incomplete tasks as completed.
