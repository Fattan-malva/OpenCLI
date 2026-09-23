# 19 — End-to-End Example Project

## User request

> Build an inventory application with a Flutter client and Node.js API.

## Step 1 — Project

User selects:

```text
C:/Projects/inventory
```

OpenCLI detects Git.

## Step 2 — Agents

Detected:

```text
Claude Code   Installed
Codex CLI     Installed
OpenCode      Installed
Gemini CLI    Installed
Aider         Not Installed
```

## Step 3 — Configuration

```text
Plan:
Claude / plan / high-reasoning model

Backend:
Codex / build / coding model

Frontend:
OpenCode / build / coding model

Review:
Gemini / review / analysis model

Tests:
Codex / test / coding model
```

## Step 4 — Plan

```text
T001 Architecture
T002 Database
T003 Backend API
T004 Authentication
T005 Flutter shell
T006 Inventory UI
T007 API integration
T008 Review
T009 Tests
T010 Integration
```

## Step 5 — Parallel scheduling

```text
T001 -> Claude
T002 -> Codex
```

After T001:

```text
T005 -> OpenCode
```

T002 enables:

```text
T003 -> Codex
```

T003 + T005 enable:

```text
T007 -> OpenCode
```

## Step 6 — Review

```text
T008 -> Gemini
```

Gemini produces:
- findings
- severity
- recommended changes

## Step 7 — Fix

OpenCLI creates follow-up tasks from accepted findings.

## Step 8 — Test

```text
T009 -> Codex
```

## Step 9 — Integration

OpenCLI:
- checks worktrees
- runs configured validation
- checks Git diff
- presents integration result

## Final dashboard

```text
Completed: 9
Running: 1
Blocked: 0
Failed: 0

Agents:
Claude   Idle
Codex    Testing
OpenCode Idle
Gemini   Review complete
```
