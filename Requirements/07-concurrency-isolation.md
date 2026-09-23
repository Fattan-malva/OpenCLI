# 07 — Concurrency and Isolation

## Problem

Running multiple agents directly in one directory can cause:

```text
Agent A edits package.json
Agent B edits package.json
Agent C deletes a file Agent A needs
```

OpenCLI must prevent uncontrolled collisions.

## Recommended model

```text
Main Repository
 |
 +-- Worktree: task-T002
 +-- Worktree: task-T003
 +-- Worktree: task-T004
```

Each task receives an isolated workspace.

## File ownership

OpenCLI tracks intended scopes:

```text
T002 -> src/auth/**
T003 -> src/api/**
T004 -> src/products/**
```

If scopes overlap, the scheduler should:
- serialize the tasks
- split scopes
- create a review/merge workflow
- ask the user
- or apply a configured policy

## Lock levels

### File lock
One task is actively modifying a file.

### Directory ownership
A task owns a directory scope.

### Resource lock
Used for shared resources such as:
- database migration
- package manager lockfile
- deployment configuration
- environment file

## Lock lifecycle

```text
REQUEST
  |
GRANTED
  |
HELD
  |
RELEASED
```

Stale locks must be recoverable after process crash.

## Conflict policy

Default:
- never silently overwrite another active task
- preserve changes
- surface conflict
- create a resolution task when needed

## Parallel safety

Parallel execution is allowed when:
- dependencies are satisfied
- resource limits permit it
- workspace scopes do not conflict
- permissions permit it
