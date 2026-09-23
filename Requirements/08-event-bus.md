# 08 — Event Bus

## Purpose

The Event Bus is the communication backbone between:
- UI
- scheduler
- agents
- tasks
- workspaces
- Git
- installers
- recovery system

## Event structure

```json
{
  "id": "event-123",
  "type": "task.completed",
  "timestamp": "2026-01-01T00:00:00Z",
  "projectId": "project-1",
  "taskId": "T002",
  "agentId": "codex",
  "payload": {
    "artifacts": ["src/auth"]
  }
}
```

## Core events

```text
agent.discovered
agent.started
agent.output
agent.tool_called
agent.file_changed
agent.permission_requested
agent.paused
agent.resumed
agent.stopped
agent.completed
agent.failed
agent.crashed

task.created
task.ready
task.started
task.blocked
task.completed
task.failed
task.retried
task.cancelled

workspace.created
workspace.locked
workspace.released
workspace.conflict

git.changed
git.commit_created
git.merge_conflict
git.integrated

workflow.started
workflow.completed

installation.started
installation.completed
installation.failed
```

## Event guarantees

Events should be:
- timestamped
- project-scoped
- persistable
- idempotently processable where practical

## Agent communication

Agents communicate through OpenCLI, not direct uncontrolled process-to-process messaging.

```text
Agent A
  |
  v
Event Bus
  |
  v
Task State
  |
  v
Agent B
```
