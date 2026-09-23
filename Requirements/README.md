# OpenCLI

> Universal AI Agent Orchestration Platform

OpenCLI adalah platform cross-platform untuk menemukan, mengonfigurasi, menjalankan, mengisolasi, menjadwalkan, dan mengoordinasikan berbagai AI coding CLI agar dapat bekerja sebagai satu engineering team.

OpenCLI bukan pengganti Claude Code, Codex CLI, OpenCode, Gemini CLI, Aider, OpenHands, atau agent lain. OpenCLI adalah orchestration layer di atas agent-agent tersebut.

## Tujuan

OpenCLI memungkinkan user:

- mendeteksi AI CLI yang terpasang di OS
- menginstal agent yang belum tersedia dengan persetujuan user
- mengatur agent, mode, provider, model, permission, dan capability
- menjalankan banyak agent secara paralel
- membuat task graph dan dependency
- memberikan workspace terisolasi untuk setiap task
- mencegah konflik file
- mengirim hasil antar-agent melalui event bus
- mengelola Git/worktree
- memonitor process, terminal, logs, dan resource
- melakukan review, testing, integration, dan handoff
- mengontrol semuanya dari satu UI

## Prinsip utama

1. Agent-agnostic
2. Model-agnostic
3. Provider-agnostic
4. Parallel by default jika dependency memungkinkan
5. Isolation first
6. Human in the loop
7. OpenCLI state adalah source of truth
8. Adapter, bukan hardcode per agent
9. Semua operasi berisiko membutuhkan permission yang sesuai
10. Project user tetap menjadi sumber kode utama

## Contoh

```text
User
  |
  v
OpenCLI Planner
  |
  v
Task Graph
  +-- Architecture -> Claude / Plan / high-reasoning model
  +-- Backend      -> Codex / Build
  +-- Frontend     -> OpenCode / Build
  +-- Docs         -> Gemini / Research
  +-- Test         -> Codex / Test
  |
  v
Review
  |
  v
Integration
  |
  v
Project
```

## Repository documentation

- `01-product-spec.md` — product specification
- `02-architecture.md` — system architecture
- `03-domain-model.md` — domain entities
- `04-agent-adapter-spec.md` — adapter contract
- `05-config-spec.md` — agents/providers/models/modes configuration
- `06-task-workflow.md` — task graph and workflow
- `07-concurrency-isolation.md` — parallel execution and conflict prevention
- `08-event-bus.md` — event and agent communication
- `09-git-workspace.md` — Git/worktree strategy
- `10-installation-discovery.md` — OS discovery and installation
- `11-security.md` — permissions and secrets
- `12-ui-spec.md` — UI/UX specification
- `13-api-spec.md` — internal API
- `14-database-schema.md` — persistence model
- `15-plugin-system.md` — plugin architecture
- `16-roadmap.md` — implementation roadmap
- `17-testing.md` — testing strategy
- `18-recovery-observability.md` — recovery and observability
- `19-example-project.md` — end-to-end example
- `20-development-rules.md` — engineering rules

## Recommended initial stack

Desktop:
- Tauri
- React
- TypeScript

Core:
- Rust

Persistence:
- SQLite

Version control:
- Git

The architecture should remain modular enough to change these choices later.
