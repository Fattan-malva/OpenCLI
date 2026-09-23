# 12 — UI/UX Specification

## Navigation

```text
Dashboard
Projects
Tasks
Agents
Models
Providers
Workflows
Terminal
Git
Activity
Settings
```

## Dashboard

Show:
- active projects
- running agents
- task counts
- blocked tasks
- errors
- resource usage
- recent activity

## Project view

```text
Project
  |
  +-- Overview
  +-- Task Graph
  +-- Agents
  +-- Files
  +-- Git
  +-- Activity
  +-- Configuration
```

## Agent cards

Each agent card shows:
- name
- version
- installed state
- current task
- mode
- model
- status
- CPU
- memory
- workspace

## Task graph

Nodes:
- pending
- ready
- running
- blocked
- review
- failed
- completed

Edges represent dependencies.

## Agent detail

Show:
- current task
- mode
- model
- provider
- workspace
- process ID
- terminal output
- changed files
- resource use
- permissions
- controls

Controls:
- pause
- resume
- stop
- restart
- retry
- reassign
- open terminal
- inspect diff

## Configuration

Agent matrix:

```text
              Plan     Build     Review     Test
Claude        Model    Model     Model      Model
Codex         Model    Model     Model      Model
OpenCode      Model    Model     Model      Model
Gemini        Model    Model     Model      Model
```

## Activity timeline

Example:

```text
15:10 Claude started T001
15:11 T001 completed
15:11 Codex started T002
15:12 OpenCode started T003
15:14 T003 waiting for review
```

## UX rule

The UI must always make it obvious:
- what is running
- where it is running
- which files it can modify
- which model is being used
- what permissions it has
- why a task is waiting
