# 04 — Agent Adapter Specification

## Purpose

Every AI CLI has different commands, modes, authentication, output, and process behavior. OpenCLI must hide those differences behind adapters.

## Adapter interface

```typescript
interface AgentAdapter {
  id(): string;
  detect(): Promise<DetectionResult>;
  getVersion(): Promise<string>;
  getCapabilities(): Promise<Capability[]>;
  getModes(): Promise<AgentMode[]>;
  getModels(): Promise<ModelInfo[]>;
  validate(): Promise<HealthResult>;

  buildCommand(context: AgentContext): CommandSpec;

  start(context: AgentContext): Promise<AgentProcess>;
  stop(processId: string): Promise<void>;
  pause(processId: string): Promise<void>;
  resume(processId: string): Promise<void>;
  sendInput(processId: string, input: string): Promise<void>;

  parseOutput(chunk: string): AgentEvent[];
  parseExit(code: number | null): AgentEvent[];
}
```

## Agent context

```typescript
interface AgentContext {
  projectPath: string;
  workspacePath: string;
  taskId: string;
  taskDescription: string;
  mode: string;
  model?: ModelConfig;
  environment: Record<string, string>;
  relevantFiles: string[];
  projectMemory: ProjectMemory;
}
```

## Adapter requirements

An adapter must:
- never modify global OpenCLI state directly
- return structured events
- support cancellation
- handle process exit
- redact sensitive output
- expose capabilities accurately
- define required permissions
- validate its executable

## Output normalization

Agent-specific output should become OpenCLI events:

```text
agent.output
agent.tool_called
agent.file_changed
agent.task_completed
agent.task_failed
agent.permission_requested
agent.error
```

## Plugin boundary

Agent adapters should be loadable independently from the core where practical.
