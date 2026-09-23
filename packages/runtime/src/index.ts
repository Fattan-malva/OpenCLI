// Process manager: spawn, stream, terminate, cancel, session, resource monitoring
import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CommandSpec, OpenCLIEvent, SessionStatus } from '@opencli/domain';
import type { EventBus } from '@opencli/events';

export interface ManagedProcess {
  id: string;
  pid?: number;
  command: CommandSpec;
  child: ChildProcess;
  status: 'starting' | 'running' | 'paused' | 'stopping' | 'completed' | 'failed' | 'crashed';
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  outputBuffer: string[];
  errorBuffer: string[];
  abortController: AbortController;
  agentId: string;
  taskId?: string;
  workflowId?: string;
}

export interface ProcessManagerOptions {
  maxConcurrent?: number;
  defaultTimeout?: number;
}

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private maxConcurrent: number;
  private defaultTimeout: number;

  constructor(
    private eventBus: EventBus,
    options?: ProcessManagerOptions,
  ) {
    this.maxConcurrent = options?.maxConcurrent ?? 10;
    this.defaultTimeout = options?.defaultTimeout ?? 600_000;
  }

  getActiveCount(): number {
    return Array.from(this.processes.values()).filter(
      (p) => p.status === 'running' || p.status === 'starting',
    ).length;
  }

  canSpawn(): boolean {
    return this.getActiveCount() < this.maxConcurrent;
  }

  async spawn(command: CommandSpec, agentId: string, taskId?: string, workflowId?: string): Promise<string> {
    if (!this.canSpawn()) {
      throw new Error(`Max concurrent processes (${this.maxConcurrent}) reached`);
    }

    const id = randomUUID();
    const abortController = new AbortController();

    const child = spawnChild(command.executable, command.arguments, {
      cwd: command.workingDirectory,
      env: { ...process.env, ...command.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      signal: abortController.signal,
    });

    const managed: ManagedProcess = {
      id,
      pid: child.pid,
      command,
      child,
      status: 'running',
      startedAt: new Date().toISOString(),
      outputBuffer: [],
      errorBuffer: [],
      abortController,
      agentId,
      taskId,
      workflowId,
    };

    this.processes.set(id, managed);

    // Stream stdout
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      managed.outputBuffer.push(text);
      if (managed.outputBuffer.length > 1000) {
        managed.outputBuffer = managed.outputBuffer.slice(-500);
      }
      // Emit output events via adapter parsing is done at higher level
      this.eventBus.emit({
        type: 'agent.output',
        agentId,
        taskId,
        workflowId,
        payload: { processId: id, text },
      });
    });

    // Stream stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      managed.errorBuffer.push(text);
      if (managed.errorBuffer.length > 1000) {
        managed.errorBuffer = managed.errorBuffer.slice(-500);
      }
    });

    // Handle exit
    child.on('exit', (code, signal) => {
      managed.endedAt = new Date().toISOString();
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        managed.status = 'completed';
      } else if (code === 0) {
        managed.status = 'completed';
      } else {
        managed.status = 'failed';
      }
      managed.exitCode = code ?? undefined;

      this.eventBus.emit({
        type: code === 0 ? 'agent.completed' : 'agent.failed',
        agentId,
        taskId,
        workflowId,
        payload: { processId: id, exitCode: code, signal },
      });
    });

    child.on('error', (err) => {
      managed.status = 'crashed';
      managed.endedAt = new Date().toISOString();
      this.eventBus.emit({
        type: 'agent.crashed',
        agentId,
        taskId,
        workflowId,
        payload: { processId: id, error: err.message },
      });
    });

    // Set timeout
    const timeout = command.timeout ?? this.defaultTimeout;
    setTimeout(() => {
      if (managed.status === 'running') {
        this.cancel(id).catch(() => {});
      }
    }, timeout);

    this.eventBus.emit({
      type: 'agent.started',
      agentId,
      taskId,
      workflowId,
      payload: { processId: id, pid: child.pid, command: command.executable },
    });

    return id;
  }

  async cancel(processId: string): Promise<void> {
    const proc = this.processes.get(processId);
    if (!proc || proc.status === 'completed' || proc.status === 'failed' || proc.status === 'crashed') {
      return;
    }

    proc.status = 'stopping';

    if (process.platform === 'win32' && proc.pid) {
      try {
        const { execSync } = await import('node:child_process');
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // Process may already be dead
      }
    } else {
      proc.abortController.abort();
    }

    proc.endedAt = new Date().toISOString();
    proc.status = 'failed';
  }

  async terminate(processId: string): Promise<void> {
    await this.cancel(processId);
  }

  async pause(processId: string): Promise<void> {
    const proc = this.processes.get(processId);
    if (!proc || proc.status !== 'running') return;
    if (process.platform !== 'win32' && proc.child.pid) {
      proc.child.kill('SIGSTOP');
      proc.status = 'paused';
      this.eventBus.emit({
        type: 'agent.paused',
        agentId: proc.agentId,
        taskId: proc.taskId,
        workflowId: proc.workflowId,
        payload: { processId },
      });
    }
  }

  async resume(processId: string): Promise<void> {
    const proc = this.processes.get(processId);
    if (!proc || proc.status !== 'paused') return;
    if (process.platform !== 'win32' && proc.child.pid) {
      proc.child.kill('SIGCONT');
      proc.status = 'running';
      this.eventBus.emit({
        type: 'agent.resumed',
        agentId: proc.agentId,
        taskId: proc.taskId,
        workflowId: proc.workflowId,
        payload: { processId },
      });
    }
  }

  async sendInput(processId: string, input: string): Promise<void> {
    const proc = this.processes.get(processId);
    if (!proc?.child?.stdin) return;
    proc.child.stdin.write(input + '\n');
  }

  getProcess(id: string): ManagedProcess | undefined {
    return this.processes.get(id);
  }

  listProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values());
  }

  getRunningProcesses(): ManagedProcess[] {
    return this.listProcesses().filter((p) => p.status === 'running' || p.status === 'starting');
  }

  getOutput(processId: string): string {
    return this.processes.get(processId)?.outputBuffer.join('') ?? '';
  }

  getErrors(processId: string): string {
    return this.processes.get(processId)?.errorBuffer.join('') ?? '';
  }

  // Cleanup completed processes older than maxAge
  cleanup(maxAgeMs = 3600_000): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, proc] of this.processes) {
      if (proc.endedAt && now - new Date(proc.endedAt).getTime() > maxAgeMs) {
        this.processes.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  // Resource monitoring snapshot
  getResourceSnapshot(): {
    activeProcesses: number;
    totalSpawned: number;
    byStatus: Record<string, number>;
  } {
    const all = this.listProcesses();
    const byStatus: Record<string, number> = {};
    for (const proc of all) {
      byStatus[proc.status] = (byStatus[proc.status] ?? 0) + 1;
    }
    return {
      activeProcesses: this.getActiveCount(),
      totalSpawned: all.length,
      byStatus,
    };
  }
}
