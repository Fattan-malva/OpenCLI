# 17 — Testing Strategy

## Unit tests

Test:
- task state transitions
- dependency resolution
- scheduler
- routing
- configuration inheritance
- permission evaluation
- lock acquisition/release
- event parsing

## Adapter tests

Each adapter needs:
- detection test
- version parsing
- command construction
- output parsing
- exit handling
- invalid executable handling

Mock the CLI process where possible.

## Integration tests

Test:
```text
Project -> Task -> Workspace -> Agent -> Event -> Completion
```

## Concurrency tests

Cases:
- two independent tasks
- same-file conflict
- directory overlap
- lock timeout
- agent crash
- cancellation
- simultaneous completion

## Recovery tests

Simulate:
- process killed
- app crash
- OS restart
- stale workspace
- stale lock
- database interruption

Expected behavior:
OpenCLI reconstructs safe state and asks for user intervention when certainty is impossible.

## Security tests

Test:
- command injection
- path traversal
- secret leakage
- permission bypass
- unauthorized workspace access
- unsafe environment inheritance

## UI tests

Test:
- dashboard
- task graph
- agent controls
- configuration
- approval dialogs
- error states

## End-to-end scenario

```text
Create project
 -> discover agents
 -> configure models
 -> create request
 -> approve plan
 -> run 3 agents
 -> modify separate files
 -> review
 -> test
 -> integrate
```
