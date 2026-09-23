# 21 — MVP Backlog

## Epic A — Foundation

- [ ] T001 Initialize Rust core
- [ ] T002 Initialize Tauri shell
- [ ] T003 Initialize React UI
- [ ] T004 Add SQLite
- [ ] T005 Add migrations
- [ ] T006 Add structured logging
- [ ] T007 Add application event bus

## Epic B — Discovery

- [ ] T010 OS detection
- [ ] T011 PATH scanner
- [ ] T012 Agent registry
- [ ] T013 Version detection
- [ ] T014 Health checks

## Epic C — Adapters

- [ ] T020 OpenCode adapter
- [ ] T021 Codex adapter
- [ ] T022 Claude Code adapter
- [ ] T023 Gemini CLI adapter

## Epic D — Runtime

- [ ] T030 Process spawn
- [ ] T031 stdout/stderr streaming
- [ ] T032 process termination
- [ ] T033 session persistence
- [ ] T034 cancellation
- [ ] T035 resource monitoring

## Epic E — Tasks

- [ ] T040 Task model
- [ ] T041 Dependency graph
- [ ] T042 Scheduler
- [ ] T043 Queue
- [ ] T044 Retry
- [ ] T045 Failure state

## Epic F — Isolation

- [ ] T050 Git detection
- [ ] T051 Worktree creation
- [ ] T052 Workspace cleanup
- [ ] T053 File ownership
- [ ] T054 Locks
- [ ] T055 Conflict detection

## Epic G — Configuration

- [ ] T060 Global config
- [ ] T061 Project config
- [ ] T062 Agent config
- [ ] T063 Provider config
- [ ] T064 Model config
- [ ] T065 Mode config
- [ ] T066 Routing

## Epic H — UI

- [ ] T070 Dashboard
- [ ] T071 Project page
- [ ] T072 Task graph
- [ ] T073 Agent page
- [ ] T074 Model/provider page
- [ ] T075 Terminal
- [ ] T076 Activity
- [ ] T077 Approval dialogs

## MVP exit criteria

A user can create one project and run at least three different supported agents concurrently on independent tasks with isolated workspaces, while seeing task state and logs in the UI.
