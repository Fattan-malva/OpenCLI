// OpenCode adapter
import type {
  AgentAdapter,
  AgentContext,
  AgentProcess,
  CommandSpec,
  DetectionResult,
  HealthResult,
  Capability,
  AgentMode,
  AgentManifest,
  DiscoveryPlan,
  InteractiveContext,
  OpenCLIEvent,
} from '@opencli/adapter';
import { modelSpec } from '@opencli/adapter';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { discoverManifest, filterHiddenAgents, parseAgentList, runProbe } from '@opencli/discovery';

const PROCESSES = new Map<string, ChildProcess>();

/**
 * Agents OpenCode keeps for its own bookkeeping. They are reported as primary
 * by `agent list` but are not modes a person would ever select.
 */
// Only true implementation detail is hidden. Agents the CLI reports as
// subagents (explore, general, ...) are kept and surfaced separately.
const INTERNAL_AGENTS = ['compaction', 'summary', 'title'];

/** OpenCode reads `default_agent` from this file to pick its own selection. */
function configPath(): string | undefined {
  const home = homedir();
  for (const candidate of [
    join(home, '.config', 'opencode', 'opencode.json'),
    join(home, '.config', 'opencode', 'opencode.jsonc'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export class OpenCodeAdapter implements AgentAdapter {
  private executablePath: string | undefined;

  id(): string {
    return 'opencode';
  }

  name(): string {
    return 'OpenCode';
  }

  async detect(): Promise<DetectionResult> {
    // Detection handled by discovery package; here we just validate
    return { detected: !!this.executablePath, executable: 'opencode', path: this.executablePath };
  }

  async getVersion(): Promise<string> {
    if (!this.executablePath) return 'unknown';
    const { execSync } = await import('node:child_process');
    try {
      const output = execSync(`"${this.executablePath}" --version`, { encoding: 'utf-8', timeout: 10000 });
      const match = output.match(/(\d+\.\d+[\.\d]*)/);
      return match?.[1] ?? output.split('\n')[0];
    } catch {
      return 'unknown';
    }
  }

  async getCapabilities(): Promise<Capability[]> {
    return [
      { id: 'coding', name: 'Code generation' },
      { id: 'terminal', name: 'Terminal access' },
      { id: 'file_edit', name: 'File editing' },
      { id: 'web', name: 'Web browsing' },
    ];
  }

  /**
   * OpenCode's real modes, read from the installed CLI.
   *
   * There is no fixed list here on purpose: OpenCode gains agents over time and
   * users can define their own, so a declared list would be wrong immediately.
   */
  async getModes(): Promise<AgentMode[]> {
    const executable = this.executablePath;
    if (!executable) return [];

    const probe = await runProbe(executable, ['agent', 'list'], { cwd: process.cwd(), timeoutMs: 45_000 });
    const modes = filterHiddenAgents(parseAgentList(`${probe.stdout}\n${probe.stderr}`), INTERNAL_AGENTS);
    return modes.filter((mode) => (mode.type ?? 'primary') === 'primary');
  }

  discoveryPlan(): DiscoveryPlan {
    return {
      agentListArgs: ['agent', 'list'],
      modelsArgs: ['models'],
      // OpenCode namespaces its own hosted models under `opencode/`; stripping
      // it keeps third-party providers such as `google` in their own groups.
      modelPrefix: 'opencode',
      helpArgs: ['--help'],
      hiddenAgents: INTERNAL_AGENTS,
      supportsServe: true,
      timeouts: { agentList: 45_000, models: 25_000, help: 20_000 },
    };
  }

  async discover(context: InteractiveContext): Promise<AgentManifest> {
    return discoverManifest(
      this.discoveryPlan(),
      {
        adapterId: this.id(),
        executable: this.executablePath ?? 'opencode',
        cwd: context.workspacePath,
      },
      {
        adapterName: this.name(),
        version: await this.getVersion(),
        capabilities: await this.getCapabilities(),
        supportsInteractive: true,
        configPath: configPath(),
      },
    );
  }

  async validate(): Promise<HealthResult> {
    if (!this.executablePath) {
      return { healthy: false, message: 'OpenCode not detected' };
    }
    const { execSync } = await import('node:child_process');
    try {
      execSync(`"${this.executablePath}" --version`, { encoding: 'utf-8', timeout: 10000 });
      return { healthy: true };
    } catch (err: any) {
      return { healthy: false, message: err.message };
    }
  }

  setExecutablePath(path: string): void {
    this.executablePath = path;
  }

  buildCommand(context: AgentContext): CommandSpec {
    // Use OpenCode's automation command instead of the default TUI.
    // The agent and model are selected at runtime by OpenCLI's workflow router.
    const args: string[] = ['run'];

    if (context.mode) {
      args.push('--agent', context.mode);
    }

    if (context.model?.provider && context.model.model) {
      args.push('--model', modelSpec(context.model) ?? `${context.model.provider}/${context.model.model}`);
    }

    args.push(context.taskDescription);

    return {
      executable: this.executablePath ?? 'opencode',
      arguments: args,
      workingDirectory: context.workspacePath,
      environment: {
        ...context.environment,
        OPENCODE_PROJECT: context.projectPath,
        OPENCODE_TASK: context.taskId,
      },
      timeout: 600_000,
      riskLevel: context.mode === 'build' ? 'high' : 'medium',
    };
  }

  /**
   * Launches OpenCode's own TUI.
   *
   * No `run` subcommand here: that is the automation entry point and would
   * suppress the interactive UI. Plain `opencode` gives the real thing, and
   * mode/model are switched at runtime through its session API once it is up.
   */
  buildInteractiveCommand(context: InteractiveContext): CommandSpec {
    return {
      executable: this.executablePath ?? 'opencode',
      arguments: [],
      workingDirectory: context.workspacePath,
      environment: {
        ...context.environment,
        OPENCODE_PROJECT: context.projectPath,
      },
      riskLevel: 'low',
    };
  }

  async start(context: AgentContext): Promise<AgentProcess> {
    const cmd = this.buildCommand(context);
    const processId = randomUUID();

    const child = spawn(cmd.executable, cmd.arguments, {
      cwd: cmd.workingDirectory,
      env: { ...process.env, ...cmd.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    PROCESSES.set(processId, child);

    child.on('exit', () => {
      PROCESSES.delete(processId);
    });

    return { processId, pid: child.pid };
  }

  async stop(processId: string): Promise<void> {
    const child = PROCESSES.get(processId);
    if (!child) return;
    if (process.platform === 'win32') {
      const { execSync } = await import('node:child_process');
      try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* already dead */ }
    } else {
      child.kill('SIGTERM');
    }
    PROCESSES.delete(processId);
  }

  async pause(processId: string): Promise<void> {
    const child = PROCESSES.get(processId);
    if (!child || !child.pid) return;
    // Windows doesn't support SIGSTOP; best effort
    if (process.platform !== 'win32') {
      child.kill('SIGSTOP');
    }
  }

  async resume(processId: string): Promise<void> {
    const child = PROCESSES.get(processId);
    if (!child || !child.pid) return;
    if (process.platform !== 'win32') {
      child.kill('SIGCONT');
    }
  }

  async sendInput(processId: string, input: string): Promise<void> {
    const child = PROCESSES.get(processId);
    if (!child?.stdin) return;
    child.stdin.write(input + '\n');
  }

  parseOutput(chunk: string): OpenCLIEvent[] {
    const events: OpenCLIEvent[] = [];
    const lines = chunk.split('\n').filter(Boolean);

    for (const line of lines) {
      // Detect tool calls
      if (line.includes('Tool:') || line.includes('tool_call')) {
        events.push({
          id: randomUUID(),
          type: 'agent.tool_called',
          timestamp: new Date().toISOString(),
          payload: { raw: line },
        });
        continue;
      }

      // Detect file changes
      if (line.includes('Modified:') || line.includes('Created:') || line.includes('file_changed')) {
        events.push({
          id: randomUUID(),
          type: 'agent.file_changed',
          timestamp: new Date().toISOString(),
          payload: { raw: line },
        });
        continue;
      }

      // Default: output event
      events.push({
        id: randomUUID(),
        type: 'agent.output',
        timestamp: new Date().toISOString(),
        payload: { text: line },
      });
    }

    return events;
  }

  parseExit(code: number | null): OpenCLIEvent[] {
    const type = code === 0 ? 'agent.completed' : 'agent.failed';
    return [
      {
        id: randomUUID(),
        type,
        timestamp: new Date().toISOString(),
        payload: { exitCode: code },
      },
    ];
  }
}
