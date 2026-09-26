// Kilo Code adapter
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

/** Agents Kilo keeps for internal bookkeeping rather than user selection. */
// Only true implementation detail is hidden. Agents the CLI reports as
// subagents (explore, general, ...) are kept and surfaced separately.
const INTERNAL_AGENTS = ['compaction', 'summary', 'title'];

function configPath(): string | undefined {
  const home = homedir();
  for (const candidate of [
    join(home, '.config', 'kilo', 'kilo.json'),
    join(home, '.config', 'kilo', 'kilo.jsonc'),
    join(home, '.config', 'kilo', 'opencode.json'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export class KiloCodeAdapter implements AgentAdapter {
  private executablePath: string | undefined;

  id(): string {
    return 'kilocode';
  }

  name(): string {
    return 'Kilo Code';
  }

  async detect(): Promise<DetectionResult> {
    return { detected: !!this.executablePath, executable: 'kilocode', path: this.executablePath };
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
      { id: 'mcp', name: 'MCP tools' },
    ];
  }

  /**
   * Kilo's real modes, read from the installed CLI.
   *
   * Kilo ships more modes than the three that used to be declared here (ask,
   * code, debug, orchestrator) and they change between releases, so the list is
   * always read rather than assumed.
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
      // Every model Kilo prints is namespaced under `kilo/`, which would
      // otherwise collapse all 300+ models into one provider group.
      modelPrefix: 'kilo',
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
        executable: this.executablePath ?? 'kilo',
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
      return { healthy: false, message: 'Kilo Code not detected' };
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
    const args: string[] = ['run', context.taskDescription];
    // Kilo's non-interactive execution is the `run` subcommand. `-p` is not
    // a valid Kilo flag and causes the CLI to print its help and exit.
    if (context.mode) args.push('--agent', context.mode);
    if (context.model?.provider && context.model.model) {
      args.push('--model', modelSpec(context.model) ?? `${context.model.provider}/${context.model.model}`);
    }

    return {
      executable: this.executablePath ?? 'kilocode',
      arguments: args,
      workingDirectory: context.workspacePath,
      environment: {
        ...context.environment,
        KILO_PROJECT: context.projectPath,
        KILO_TASK: context.taskId,
      },
      timeout: 600_000,
      riskLevel: 'medium',
    };
  }

  /**
   * Launches Kilo's own TUI.
   *
   * Kilo's non-interactive path is `run <prompt>`; interactive hosting passes
   * no arguments so the real interface renders and receives keystrokes.
   */
  buildInteractiveCommand(context: InteractiveContext): CommandSpec {
    return {
      executable: this.executablePath ?? 'kilo',
      arguments: [],
      workingDirectory: context.workspacePath,
      environment: {
        ...context.environment,
        KILO_PROJECT: context.projectPath,
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
    child.on('exit', () => PROCESSES.delete(processId));

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
    if (!child?.pid || process.platform === 'win32') return;
    child.kill('SIGSTOP');
  }

  async resume(processId: string): Promise<void> {
    const child = PROCESSES.get(processId);
    if (!child?.pid || process.platform === 'win32') return;
    child.kill('SIGCONT');
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
      if (line.includes('Tool:') || line.includes('tool_use')) {
        events.push({
          id: randomUUID(),
          type: 'agent.tool_called',
          timestamp: new Date().toISOString(),
          payload: { raw: line },
        });
        continue;
      }

      if (line.includes('Modified:') || line.includes('Created:') || line.includes('Wrote:')) {
        events.push({
          id: randomUUID(),
          type: 'agent.file_changed',
          timestamp: new Date().toISOString(),
          payload: { raw: line },
        });
        continue;
      }

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
