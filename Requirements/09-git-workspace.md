# 09 — Git and Workspace Management

## Goal

Git is used as a coordination mechanism, not as a substitute for OpenCLI state.

## Workspace strategy

Main project:

```text
project/
```

Task worktrees:

```text
.opencli/workspaces/
  T002/
  T003/
  T004/
```

## Recommended lifecycle

```text
Create task
  |
Create worktree
  |
Run agent
  |
Validate
  |
Review
  |
Commit if policy allows
  |
Merge/integrate
  |
Remove workspace
```

## Commit policy

Configurable:
- no automatic commits
- commit after successful task
- commit only after approval
- agent-generated commit allowed
- OpenCLI-generated commit

## Integration

```text
Task worktree
   |
   v
Tests
   |
   v
Review
   |
   v
Merge
   |
   v
Main branch
```

## Conflict

A merge conflict must become visible state:

```text
workspace.conflict
```

OpenCLI may create:

```text
T099 Resolve merge conflict
```

## Safety

Never delete a workspace containing uncommitted changes without explicit policy/approval.
