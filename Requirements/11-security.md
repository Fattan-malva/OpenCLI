# 11 — Security

## Security objectives

OpenCLI can execute arbitrary developer tools, so security must be treated as a first-class subsystem.

## Permission classes

```text
filesystem.read
filesystem.write
filesystem.delete
process.execute
network.access
git.write
git.push
package.install
system.modify
credential.read
```

## Approval levels

### Once
Permission applies to one operation.

### Task
Permission applies during one task.

### Project
Permission applies within a project.

### Global
Permission applies to all projects.

Global permissions should be rare.

## Secrets

API keys must use:
- Windows Credential Manager
- macOS Keychain
- Linux Secret Service/keyring
- external secret manager

Never:
- print secrets in logs
- write secrets to Git
- include secrets in task artifacts
- include secrets in agent prompts unless required

## Command execution

Commands should be represented structurally:

```text
executable
arguments[]
workingDirectory
environment
timeout
riskLevel
```

Avoid building commands from untrusted string concatenation.

## Dangerous operations

Potentially destructive actions include:
- recursive deletion
- force Git reset
- force push
- system package modification
- credential changes
- deployment
- filesystem access outside project scope

These should follow explicit permission policy.

## Audit

Record:
- who requested
- which agent
- which task
- command
- timestamp
- approval
- result

Sensitive values must be redacted.

## Trust model

AI output is untrusted input. OpenCLI must enforce permissions independently of what the agent requests.
