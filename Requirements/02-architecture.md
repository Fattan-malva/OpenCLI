# 02 — System Architecture

## 1. High-level architecture

```text
+--------------------------------------------------------------+
|                         OPENCLI UI                           |
| Dashboard | Projects | Tasks | Agents | Models | Terminal   |
+-------------------------------+------------------------------+
                                |
                                v
+--------------------------------------------------------------+
|                        OPENCLI CORE                          |
|                                                              |
| Project Manager   Agent Manager   Task Manager               |
| Scheduler         Workflow Engine  Config Manager            |
| Workspace Manager Conflict Manager Git Manager               |
| Event Bus         Memory Manager   Permission Manager        |
| Process Manager   Resource Manager Installer                |
+-------------------------------+------------------------------+
                                |
                                v
+--------------------------------------------------------------+
|                       AGENT ADAPTERS                         |
+------------+------------+------------+------------+-----------+
| Claude     | Codex      | OpenCode   | Gemini     | Aider    |
+------------+------------+------------+------------+-----------+
                                |
                                v
+--------------------------------------------------------------+
|                    OPERATING SYSTEM                          |
| processes | filesystem | terminal | Git | package managers  |
+--------------------------------------------------------------+
```

## 2. Layers

### UI layer
Responsible for presentation and user interaction.

### Application/core layer
Responsible for business rules and orchestration.

### Domain layer
Contains project, task, agent, workflow, workspace, event, model, provider, and permission concepts.

### Infrastructure layer
Contains:
- process spawning
- filesystem
- Git
- OS detection
- package managers
- keychain
- SQLite
- terminal streams

### Adapter layer
Translates OpenCLI abstractions to agent-specific commands and output.

## 3. Core services

```text
AgentRegistry
AgentRuntime
AgentAdapterRegistry
ProjectService
TaskService
Scheduler
WorkflowEngine
WorkspaceService
LockService
GitService
EventBus
MemoryService
ConfigService
ProviderService
ModelService
PermissionService
InstallerService
ResourceService
RecoveryService
```

## 4. Process lifecycle

```text
DISCOVERED
   |
READY
   |
STARTING
   |
RUNNING
   +--> PAUSED
   |
   +--> STOPPING
   |
COMPLETED / FAILED / CRASHED
```

## 5. Data flow

```text
User Request
 -> Planner
 -> Workflow
 -> Task Graph
 -> Scheduler
 -> Agent Runtime
 -> Adapter
 -> CLI Process
 -> Events
 -> Task State
 -> UI
```

## 6. Recommended implementation

Use Rust for system/core responsibilities and Tauri for desktop integration. React + TypeScript can implement the UI. SQLite stores persistent orchestration state.

The architecture must keep agent-specific logic outside the core.
