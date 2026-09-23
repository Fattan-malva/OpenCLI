# 01 — Product Specification

## 1. Product definition

OpenCLI is a cross-platform AI agent orchestration platform that discovers, configures, isolates, schedules, and coordinates multiple AI coding CLI agents so they can collaboratively work on software projects without interfering with each other.

## 2. Problems

Existing AI coding CLIs are generally optimized for individual-agent workflows. A user who wants several agents working simultaneously must manually manage:

- multiple terminals
- different CLI commands
- different model configurations
- project context
- Git branches
- workspace conflicts
- task dependencies
- logs
- handoffs
- failures
- credentials

OpenCLI centralizes these concerns.

## 3. Core concepts

```text
Project
  -> Workflow
      -> Tasks
          -> Agent Assignment
              -> Mode
              -> Provider
              -> Model
              -> Workspace
              -> Permissions
```

## 4. Functional requirements

### Agent discovery
- detect supported agents
- resolve executable path
- read version
- validate health
- register capabilities
- detect installation status

### Installation
- detect supported package managers
- present installation plan
- request user approval
- execute installer
- verify executable
- register installed version

### Configuration
- global configuration
- project configuration
- task overrides
- provider configuration
- model configuration
- mode configuration
- permissions
- routing rules
- concurrency limits

### Orchestration
- create plan
- decompose tasks
- build dependency graph
- assign agents
- schedule tasks
- run parallel tasks
- pause/resume/stop
- retry/fallback
- review
- test
- integrate

### Isolation
- Git worktree support
- file ownership
- lock management
- workspace lifecycle
- conflict detection

### Communication
- task handoff
- events
- artifacts
- dependency resolution
- shared project context

### UI
- dashboard
- project manager
- task graph
- agent dashboard
- agent configuration
- model/provider management
- terminal
- logs
- Git changes
- approvals
- activity timeline

## 5. Non-functional requirements

### Cross-platform
Target:
- Windows
- macOS
- Linux

### Reliability
- persistent state
- crash recovery
- resumable sessions
- process cleanup
- stale lock recovery

### Security
- no plaintext API keys in project files
- explicit permission for risky operations
- process isolation
- command auditing
- secret redaction

### Performance
- UI must remain responsive while agents run
- event processing must be asynchronous
- scheduler must avoid unnecessary polling
- logs should be streamed incrementally

## 6. Non-goals

OpenCLI does not:
- create its own foundation model
- require one AI provider
- replace existing coding CLIs
- force a specific editor
- automatically publish code without user policy
- treat terminal output as authoritative project state

## 7. Success criteria

A user can:
1. install OpenCLI
2. select a project directory
3. discover installed agents
4. configure models/providers/modes
5. submit a high-level request
6. approve a generated plan
7. run multiple agents simultaneously
8. inspect each agent's isolated workspace
9. see task status in real time
10. resolve conflicts through OpenCLI
11. review and test results
12. integrate changes into the main project
