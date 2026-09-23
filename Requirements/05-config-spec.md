# 05 — Configuration Specification

## Configuration hierarchy

```text
Task
 ↓
Project
 ↓
Global
 ↓
Agent default
```

## Global config

Contains:
- installed agent registry
- providers
- models
- global routing
- concurrency
- security policy
- UI settings

## Project config

Example:

```yaml
project:
  name: marketplace
  path: C:/Projects/marketplace

settings:
  maxParallelAgents: 4
  defaultAgent: opencode
  defaultMode: build

routing:
  architecture:
    agent: claude
    mode: plan
    model: claude-opus

  backend:
    agent: codex
    mode: build
    model: coding-model

  frontend:
    agent: opencode
    mode: build
    model: claude-sonnet

  review:
    agent: gemini
    mode: review
    model: gemini-model
```

## Agent config

```yaml
agent:
  id: opencode

defaultMode: build

modes:
  plan:
    model:
      provider: anthropic
      model: claude-opus

  build:
    model:
      provider: anthropic
      model: claude-sonnet

  review:
    model:
      provider: google
      model: review-model
```

## Provider config

```yaml
provider:
  id: ollama
  type: openai-compatible
  baseUrl: http://localhost:11434/v1
  credentialRef: null
```

## Model config

```yaml
model:
  id: local-qwen
  provider: ollama
  name: qwen3
```

## Modes

A mode describes intent and permission policy, not necessarily a literal CLI flag.

Examples:
- plan
- build
- review
- debug
- test
- research
- custom

## Permission model

```text
read
write
delete
terminal
network
git
install
system
```

## Secrets

Never store API keys directly in project YAML.

Use OS credential stores or a supported secret manager. Config files should contain a credential reference.
