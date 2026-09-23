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
  OpenCLIEvent,
} from '@opencli/adapter';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';

const PROCESSES = new Map<string, ChildProcess>();

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

  async getModes(): Promise<AgentMode[]> {
    return [
      {
        id: 'plan',
        name: 'Plan',
        permissions: { read: true, write: false, delete: false, terminal: false, network: false, git: false, install: false, system: false },
      },
      {
        id: 'build',
        name: 'Build',
        permissions: { read: true, write: true, delete: true, terminal: true, network: true, git: true, install: false, system: false },
      },
      {
        id: 'review',
        name: 'Review',
        permissions: { read: true, write: false, delete: false, terminal: false, network: false, git: false, install: false, system: false },
      },
    ];
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
    const args: string[] = [];
    // Kilo Code may use -p for non-interactive mode
    args.push('-p', context.taskDescription);

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
