# 15 — Plugin System

## Goal

New agents and integrations should be addable without modifying the core.

## Plugin types

```text
Agent Plugin
Provider Plugin
Model Plugin
Installer Plugin
Workflow Plugin
UI Plugin
```

## Agent plugin

A plugin should provide:
- manifest
- adapter
- capabilities
- modes
- detection
- installation metadata

## Conceptual manifest

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "version": "1.0",
  "type": "agent",
  "adapter": "my-agent-adapter",
  "capabilities": [
    "coding",
    "terminal"
  ]
}
```

## Compatibility

Plugins should declare:
- OpenCLI API version
- platform support
- required runtime
- permissions

## Sandboxing

Plugins must not automatically receive unrestricted access. Their capabilities and permissions should be explicit.

## Plugin lifecycle

```text
DISCOVER
  |
VALIDATE
  |
INSTALL
  |
REGISTER
  |
ENABLE
  |
RUN
```
