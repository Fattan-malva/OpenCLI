# 22 — Agent Configuration Examples

These are conceptual examples. Exact CLI flags must be implemented by each adapter based on the installed version.

## Team preset: Balanced

```yaml
team:
  planner:
    agent: claude
    mode: plan
    model: reasoning-model

  builder:
    agent: codex
    mode: build
    model: coding-model

  frontend:
    agent: opencode
    mode: build
    model: coding-model

  reviewer:
    agent: gemini
    mode: review
    model: analysis-model
```

## Team preset: Local

```yaml
team:
  planner:
    agent: opencode
    mode: plan
    provider: ollama
    model: local-reasoning-model

  builder:
    agent: opencode
    mode: build
    provider: ollama
    model: local-coding-model

  reviewer:
    agent: opencode
    mode: review
    provider: ollama
    model: local-review-model
```

## Mode permission profiles

### Plan

```yaml
permissions:
  read: true
  write: false
  delete: false
  terminal: false
  git: false
```

### Build

```yaml
permissions:
  read: true
  write: true
  delete: true
  terminal: true
  git: true
```

### Review

```yaml
permissions:
  read: true
  write: false
  delete: false
  terminal: false
  git: false
```

The exact defaults should be configurable and validated against each adapter's actual capabilities.
