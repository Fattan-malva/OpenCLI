# 16 — Roadmap

## Phase 0 — Specification

- finalize domain model
- finalize adapter interface
- finalize event schema
- finalize security model
- choose initial supported agents

## Phase 1 — Core

Build:
- project initialization
- SQLite
- configuration
- OS detection
- process manager
- event bus

Success:
OpenCLI starts and maintains persistent state.

## Phase 2 — Agent discovery

Initial adapters:
- OpenCode
- Codex
- Claude Code
- Gemini CLI

Success:
installed agents appear in UI with path/version/status.

## Phase 3 — Agent execution

Build:
- terminal streaming
- start/stop/pause/resume
- session management
- output normalization

Success:
multiple agents can run simultaneously.

## Phase 4 — Tasks

Build:
- task CRUD
- dependencies
- graph
- scheduler
- queue
- retry

Success:
independent tasks execute concurrently.

## Phase 5 — Isolation

Build:
- Git worktrees
- file scopes
- locks
- conflict detection
- cleanup

Success:
parallel agents do not silently overwrite each other.

## Phase 6 — Configuration

Build:
- providers
- models
- modes
- routing
- task overrides
- permission profiles

Success:
different tasks can use different agent/model combinations.

## Phase 7 — Collaboration

Build:
- event bus
- handoff
- artifacts
- project memory
- dependency context

Success:
agent B can consume structured results from agent A.

## Phase 8 — Installation

Build:
- installer registry
- package manager detection
- install/verify
- upgrade status

## Phase 9 — Reliability

Build:
- crash recovery
- stale lock recovery
- session recovery
- resource limits

## Phase 10 — Plugin ecosystem

Build:
- plugin API
- registry
- validation
- compatibility

## Phase 11 — Production

Build:
- updater
- diagnostics
- documentation
- telemetry opt-in
- packaging
- code signing
