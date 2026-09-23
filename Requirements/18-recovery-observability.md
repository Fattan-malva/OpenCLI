# 18 — Recovery and Observability

## Persistent state

OpenCLI should persist:
- tasks
- agent sessions
- workspaces
- locks
- events
- approvals
- workflow state

## Crash recovery

On startup:

```text
Load database
  |
Find RUNNING sessions
  |
Check process existence
  |
Check workspace
  |
Check locks
  |
Mark uncertain state
  |
Recover or ask user
```

Never assume a task completed merely because the UI closed.

## Process recovery

If process disappeared:
- inspect exit information if available
- classify as failed/crashed/unknown
- preserve logs
- release stale runtime locks
- keep workspace for inspection

## Observability

Metrics:
- active agents
- task duration
- queue wait time
- success/failure rate
- resource usage
- adapter errors
- installation failures

Logs:
- structured
- timestamped
- project/task/agent scoped
- secret redacted

## Diagnostics bundle

Provide an export containing:
- OpenCLI version
- OS information
- adapter versions
- sanitized configuration
- recent errors
- relevant event history

Never include secrets.
