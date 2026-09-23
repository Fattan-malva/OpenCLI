# 13 — Internal API Specification

This document describes a conceptual API. Exact transport can be implemented with Tauri commands, local IPC, or a local service.

## Projects

```http
GET    /projects
POST   /projects
GET    /projects/:id
PATCH  /projects/:id
DELETE /projects/:id
```

## Agents

```http
GET /agents
GET /agents/:id
POST /agents/:id/start
POST /agents/:id/stop
POST /agents/:id/pause
POST /agents/:id/resume
```

## Discovery

```http
POST /discovery/scan
GET  /discovery/results
```

## Installation

```http
GET  /installers
POST /agents/:id/install
POST /agents/:id/verify
```

## Tasks

```http
GET    /projects/:projectId/tasks
POST   /projects/:projectId/tasks
GET    /tasks/:id
PATCH  /tasks/:id
POST   /tasks/:id/start
POST   /tasks/:id/pause
POST   /tasks/:id/retry
POST   /tasks/:id/cancel
```

## Workflows

```http
GET  /workflows
POST /workflows
POST /workflows/:id/run
```

## Workspaces

```http
GET  /tasks/:taskId/workspace
POST /tasks/:taskId/workspace
DELETE /workspaces/:id
```

## Events

```http
GET /projects/:projectId/events
```

## WebSocket/events

Recommended channels:

```text
project:{projectId}
task:{taskId}
agent:{agentId}
```

Events are streamed to the UI.
