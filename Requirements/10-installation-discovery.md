# 10 — Installation and Discovery

## Discovery pipeline

```text
Detect OS
  |
Detect PATH
  |
Check known executables
  |
Check package managers
  |
Run version command
  |
Validate health
  |
Register agent
```

## Supported operating systems

- Windows
- macOS
- Linux

## Package manager abstraction

```text
Installer
  |
  +-- winget
  +-- brew
  +-- npm
  +-- pip
  +-- apt
  +-- custom installer
```

The installer registry must not assume one package manager is always available.

## Agent registry entry

```json
{
  "id": "example-agent",
  "name": "Example Agent",
  "executable": "example",
  "version": "1.0.0",
  "installed": true,
  "path": "/usr/local/bin/example"
}
```

## Installation workflow

```text
User clicks Install
  |
Show source + commands + permissions
  |
User approves
  |
Run installer
  |
Verify executable
  |
Run health check
  |
Register agent
```

## Security

Never execute an installation silently without user policy allowing it.

Display:
- installer source
- command
- required privileges
- destination
- estimated impact

## Upgrade

OpenCLI should distinguish:
- installed
- outdated
- unknown version
- broken
- unavailable

Upgrades should be user-controlled.
