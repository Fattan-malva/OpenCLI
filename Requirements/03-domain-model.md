# 03 — Domain Model

## Entities

### Project

```text
id
name
path
gitRepository
defaultAgent
defaultMode
defaultModel
status
createdAt
updatedAt
```

### Agent

```text
id
name
executable
version
path
status
capabilities[]
modes[]
adapterId
installed
```

### Provider

```text
id
name
type
baseUrl
credentialRef
models[]
```

### Model

```text
id
providerId
name
contextWindow
capabilities[]
metadata
```

### Mode

```text
id
name
permissions
systemPolicy
defaultModel
```

### Task

```text
id
projectId
title
description
status
priority
dependencies[]
agentId
modeId
modelId
workspaceId
fileScopes[]
createdAt
updatedAt
```

### Workspace

```text
id
projectId
taskId
path
branch
worktree
status
```

### Lock

```text
id
projectId
resource
ownerType
ownerId
expiresAt
```

### Event

```text
id
type
projectId
taskId
agentId
timestamp
payload
```

### Session

```text
id
agentId
taskId
processId
startedAt
endedAt
status
exitCode
```

### Artifact

```text
id
taskId
type
path
metadata
createdAt
```

## Relationships

```text
Project
  |
  +-- Tasks
  |     |
  |     +-- Agent
  |     +-- Mode
  |     +-- Model
  |     +-- Workspace
  |
  +-- Workflows
  +-- Events
  +-- Sessions
  +-- Artifacts
```
