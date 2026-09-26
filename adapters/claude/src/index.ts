// Claude Code adapter
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
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { discoverManifest, parseChoiceFlag, runProbe } from '@opencli/discovery';

const PROCESSES = new Map<string, ChildProcess>();

export class ClaudeAdapter implements AgentAdapter {
  private executablePath: string | undefined;

  id(): string {
    return 'claude';
  }

  name(): string {
    return 'Claude Code';
  }

  async detect(): Promise<DetectionResult> {
    return { detected: !!this.executablePath, executable: 'claude', path: this.executablePath };
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
      { id: 'reasoning', name: 'Advanced reasoning' },
      { id: 'computer_use', name: 'Computer use' },
    ];
  }

  /**
   * Claude Code's real permission modes, scraped from its own help output.
   *
   * It has no agent listing command, and it has never had modes called `build`
   * or `review`; declaring those offered users a choice that would fail. What it
   * does declare is `--permission-mode`, so that is what gets read.
   */
  async getModes(): Promise<AgentMode[]> {
    const executable = this.executablePath;
    if (!executable) return [];

    const probe = await runProbe(executable, ['--help'], { cwd: process.cwd(), timeoutMs: 20_000 });
    const choices = parseChoiceFlag(`${probe.stdout}\n${probe.stderr}`, '--permission-mode');
    return choices.map((id) => ({ id, name: id, type: 'primary' as const, source: 'cli' as const }));
  }

  discoveryPlan(): DiscoveryPlan {
    return {
      // No agentListArgs and no modelsArgs: Claude Code exposes neither. Its
      // modes come from the help flag, and model choice is deliberately left to
      // the CLI rather than fabricated here.
      helpArgs: ['--help'],
      choiceFlag: '--permission-mode',
      supportsServe: false,
      timeouts: { help: 20_000 },
    };
  }

  async discover(context: InteractiveContext): Promise<AgentManifest> {
    return discoverManifest(
      this.discoveryPlan(),
      {
        adapterId: this.id(),
        executable: this.executablePath ?? 'claude',
        cwd: context.workspacePath,
      },
      {
        adapterName: this.name(),
        version: await this.getVersion(),
        capabilities: await this.getCapabilities(),
        supportsInteractive: true,
      },
    );
  }

  async validate(): Promise<HealthResult> {
    if (!this.executablePath) {
      return { healthy: false, message: 'Claude Code not detected' };
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
    const args: string[] = [];
    // Claude Code uses -p for non-interactive (print) mode
    args.push('-p', context.taskDescription);

    if (context.mode === 'plan') {
      args.push('--allowedTools', 'Read');
    }

    return {
      executable: this.executablePath ?? 'claude',
      arguments: args,
      workingDirectory: context.workspacePath,
      environment: {
        ...context.environment,
        CLAUDE_PROJECT: context.projectPath,
        CLAUDE_TASK: context.taskId,
      },
      timeout: 600_000,
      riskLevel: context.mode === 'build' ? 'high' : 'medium',
    };
  }

  /**
   * Launches Claude Code's own UI.
   *
   * `buildCommand` uses `-p` for print mode, which discards the interface
   * entirely. Interactive hosting passes no arguments so the real UI renders.
   */
  buildInteractiveCommand(context: InteractiveContext): CommandSpec {
    return {
      executable: this.executablePath ?? 'claude',
      arguments: [],
      workingDirectory: context.workspacePath,
      environment: {
        ...context.environment,
        CLAUDE_PROJECT: context.projectPath,
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
      if (line.includes('Tool:') || line.includes('tool_use') || line.includes('Read:') || line.includes('Write:') || line.includes('Bash:')) {
        events.push({
          id: randomUUID(),
          type: 'agent.tool_called',
          timestamp: new Date().toISOString(),
          payload: { raw: line },
        });
        continue;
      }

      if (line.includes('Modified:') || line.includes('Created:') || line.includes('Wrote:') || line.includes('Updated:')) {
        events.push({
          id: randomUUID(),
          type: 'agent.file_changed',
          timestamp: new Date().toISOString(),
          payload: { raw: line },
        });
        continue;
      }

      if (line.includes('Permission required') || line.includes('needs permission')) {
        events.push({
          id: randomUUID(),
          type: 'agent.permission_requested',
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
