import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProcessManager } from './index.js';
import { EventBus } from '@opencli/events';
import type { CommandSpec } from '@opencli/domain';

describe('ProcessManager', () => {
  let eventBus: EventBus;
  let processManager: ProcessManager;

  beforeEach(() => {
    eventBus = new EventBus();
    processManager = new ProcessManager(eventBus, {
      maxConcurrent: 5,
      defaultTimeout: 10000,
    });
  });

  afterEach(() => {
    // Cleanup any running processes
    const processes = processManager.listProcesses();
    for (const proc of processes) {
      processManager.cancel(proc.id).catch(() => {});
    }
  });

  describe('Spawn', () => {
    it('spawns a simple process', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'console.log("test")'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');
      expect(processId).toBeDefined();

      const proc = processManager.getProcess(processId);
      expect(proc).toBeDefined();
      expect(proc?.status).toBe('running');
      expect(proc?.pid).toBeDefined();
    });

    it('spawns process with custom environment', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'console.log(process.env.TEST_VAR)'],
        workingDirectory: process.cwd(),
        environment: { TEST_VAR: 'test-value' },
        timeout: 5000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');
      const proc = processManager.getProcess(processId);
      expect(proc?.command.environment.TEST_VAR).toBe('test-value');
    });

    it('respects max concurrent limit', async () => {
      const limitedManager = new ProcessManager(eventBus, { maxConcurrent: 2 });

      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'setTimeout(() => {}, 5000)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      await limitedManager.spawn(command, 'test-agent');
      await limitedManager.spawn(command, 'test-agent');

      await expect(limitedManager.spawn(command, 'test-agent')).rejects.toThrow(
        'Max concurrent processes'
      );
    });

    it('sets process to running immediately', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'console.log("test")'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');
      const proc = processManager.getProcess(processId);
      expect(proc?.status).toBe('running');
    });
  });

  describe('Process Lifecycle', () => {
    it('completes successfully on exit code 0', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'process.exit(0)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const proc = processManager.getProcess(processId);
      expect(proc?.status).toBe('completed');
      expect(proc?.exitCode).toBe(0);
    });

    it('fails on non-zero exit code', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'process.exit(1)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const proc = processManager.getProcess(processId);
      expect(proc?.status).toBe('failed');
      expect(proc?.exitCode).toBe(1);
    });

    it('handles process crash', async () => {
      const command: CommandSpec = {
        executable: 'nonexistent-executable-12345',
        arguments: [],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent').catch(() => null);

      // Process should fail to spawn or crash immediately
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (processId) {
        const proc = processManager.getProcess(processId);
        expect(['failed', 'crashed']).toContain(proc?.status);
      }
    });
  });

  describe('Process Control', () => {
    it('cancels running process', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'setTimeout(() => {}, 10000)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 15000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');
      await processManager.cancel(processId);

      const proc = processManager.getProcess(processId);
      expect(proc?.status).toBe('failed');
      expect(proc?.endedAt).toBeDefined();
    });

    it('terminates process', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'setTimeout(() => {}, 10000)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 15000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');
      await processManager.terminate(processId);

      const proc = processManager.getProcess(processId);
      expect(proc?.status).toBe('failed');
    });

    it('pauses and resumes process (Unix only)', async () => {
      if (process.platform === 'win32') {
        // Skip pause/resume tests on Windows
        return;
      }

      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'setTimeout(() => {}, 10000)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 15000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');
      await processManager.pause(processId);

      let proc = processManager.getProcess(processId);
      expect(proc?.status).toBe('paused');

      await processManager.resume(processId);

      proc = processManager.getProcess(processId);
      expect(proc?.status).toBe('running');

      // Cleanup
      await processManager.cancel(processId);
    });
  });

  describe('Input/Output', () => {
    it('captures stderr output', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'console.error("error output")'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 500));

      const errors = processManager.getErrors(processId);
      expect(errors).toContain('error output');
    });

    it('sends input to process', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'setTimeout(() => process.exit(0), 500);'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');

      // Wait for process to start
      await new Promise((resolve) => setTimeout(resolve, 200));

      await processManager.sendInput(processId, 'test input');

      // Wait for process completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('✓ Input sent to process');
    });
  });

  describe('Resource Monitoring', () => {
    it('tracks active process count', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'setTimeout(() => {}, 5000)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      expect(processManager.getActiveCount()).toBe(0);

      await processManager.spawn(command, 'test-agent');
      expect(processManager.getActiveCount()).toBe(1);

      await processManager.spawn(command, 'test-agent');
      expect(processManager.getActiveCount()).toBe(2);
    });

    it('provides resource snapshot', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'setTimeout(() => {}, 5000)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      await processManager.spawn(command, 'test-agent');

      const snapshot = processManager.getResourceSnapshot();
      expect(snapshot.activeProcesses).toBe(1);
      expect(snapshot.totalSpawned).toBe(1);
      expect(snapshot.byStatus.running).toBe(1);
    });

    it('cleans up old processes', async () => {
      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'process.exit(0)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, 'test-agent');

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Manually set endedAt to old time for testing
      const proc = processManager.getProcess(processId);
      if (proc) {
        proc.endedAt = new Date(Date.now() - 4000).toISOString();
      }

      const cleaned = processManager.cleanup(1000); // Clean up processes older than 1 second
      expect(cleaned).toBeGreaterThan(0);
    });
  });

  describe('Event Emission', () => {
    it('emits agent.started event', async () => {
      let startedEvent = false;
      eventBus.on('agent.started', () => {
        startedEvent = true;
      });

      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'console.log("test")'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      await processManager.spawn(command, 'test-agent');
      expect(startedEvent).toBe(true);
    });

    it('emits agent.completed event on success', async () => {
      let completedEvent = false;
      eventBus.on('agent.completed', () => {
        completedEvent = true;
      });

      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'process.exit(0)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      await processManager.spawn(command, 'test-agent');

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(completedEvent).toBe(true);
    });

    it('emits agent.failed event on failure', async () => {
      let failedEvent = false;
      eventBus.on('agent.failed', () => {
        failedEvent = true;
      });

      const command: CommandSpec = {
        executable: 'node',
        arguments: ['-e', 'process.exit(1)'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 5000,
        riskLevel: 'low',
      };

      await processManager.spawn(command, 'test-agent');

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(failedEvent).toBe(true);
    });
  });
});
