import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProcessManager } from './index.js';
import { EventBus } from '@opencli/events';
import { discoverAllAgents, findExecutable } from '@opencli/discovery';
import type { CommandSpec } from '@opencli/domain';

describe('Integration Tests: Discovery, Spawn, and Command Sending', () => {
  let eventBus: EventBus;
  let processManager: ProcessManager;

  beforeEach(() => {
    eventBus = new EventBus();
    processManager = new ProcessManager(eventBus, {
      maxConcurrent: 5,
      defaultTimeout: 30000,
    });
  });

  afterEach(async () => {
    // Cleanup any running processes
    const processes = processManager.listProcesses();
    for (const proc of processes) {
      await processManager.cancel(proc.id).catch(() => {});
    }
  });

  describe('Step 1: Adapter Detection', () => {
    it('detects available CLI agents in OS', () => {
      const results = discoverAllAgents();

      console.log('🔍 Discovery Results:');
      results.forEach(({ definition, result }) => {
        console.log(`  ${definition.name}: ${result.detected ? '✓ Found' : '✗ Not found'}`);
        if (result.detected) {
          console.log(`    Path: ${result.path}`);
          console.log(`    Version: ${result.version || 'unknown'}`);
        }
      });

      expect(results.length).toBeGreaterThan(0);
      expect(Array.isArray(results)).toBe(true);
    }, 10000);

    it('finds node executable as baseline test', () => {
      const nodePath = findExecutable('node');
      expect(nodePath).toBeDefined();
      console.log(`✓ Node found at: ${nodePath}`);
    });

    it('detects specific CLI if installed', () => {
      const results = discoverAllAgents();
      const detectedAgents = results.filter((r) => r.result.detected);

      console.log(`📊 Summary: ${detectedAgents.length}/${results.length} agents detected`);

      if (detectedAgents.length > 0) {
        detectedAgents.forEach(({ definition, result }) => {
          console.log(`  ✓ ${definition.name} (${definition.id})`);
          console.log(`    Executable: ${result.executable}`);
          console.log(`    Path: ${result.path}`);
          console.log(`    Version: ${result.version || 'unknown'}`);
        });
      }
    }, 10000);
  });

  describe('Step 2: Spawn CLI Process', () => {
    it('spawns node process as baseline test', async () => {
      const nodePath = findExecutable('node');
      expect(nodePath).toBeDefined();

      const command: CommandSpec = {
        executable: nodePath!,
        arguments: ['-e', 'console.log("CLI process started"); setTimeout(() => process.exit(0), 100);'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      console.log('🚀 Spawning CLI process...');
      const processId = await processManager.spawn(command, 'test-node-cli');
      console.log(`✓ Process spawned with ID: ${processId}`);

      const proc = processManager.getProcess(processId);
      expect(proc).toBeDefined();
      expect(proc?.pid).toBeDefined();
      console.log(`✓ Process running with PID: ${proc?.pid}`);

      // Wait for process completion
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Process should be completed
      const finalProc = processManager.getProcess(processId);
      expect(['completed', 'failed']).toContain(finalProc?.status);
      console.log('✓ Process completed');
    });

    it('spawns detected CLI agent if available', async () => {
      const results = discoverAllAgents();
      const detectedAgent = results.find((r) => r.result.detected);

      if (!detectedAgent) {
        console.log('⚠️ No CLI agents detected, skipping spawn test');
        return;
      }

      const { definition, result } = detectedAgent;
      console.log(`🚀 Spawning ${definition.name} CLI...`);

      const command: CommandSpec = {
        executable: result.path!,
        arguments: ['--version'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, definition.id);
      console.log(`✓ ${definition.name} spawned with ID: ${processId}`);

      const proc = processManager.getProcess(processId);
      expect(proc).toBeDefined();
      expect(proc?.status).toBe('running');
      console.log(`✓ ${definition.name} running with PID: ${proc?.pid}`);

      // Wait for version output
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const output = processManager.getOutput(processId);
      console.log(`✓ ${definition.name} output: ${output.trim()}`);

      // Cleanup
      await processManager.cancel(processId);
      console.log(`✓ ${definition.name} stopped`);
    }, 10000);

    it('spawns long-running CLI process', async () => {
      const nodePath = findExecutable('node');
      expect(nodePath).toBeDefined();

      const command: CommandSpec = {
        executable: nodePath!,
        arguments: ['-e', 'setTimeout(() => process.exit(0), 2000);'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      console.log('🚀 Spawning long-running CLI process...');
      const processId = await processManager.spawn(command, 'test-long-running');
      console.log(`✓ Long-running process spawned with ID: ${processId}`);

      const proc = processManager.getProcess(processId);
      expect(proc?.status).toBe('running');

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Process should be completed
      const finalProc = processManager.getProcess(processId);
      expect(['completed', 'failed']).toContain(finalProc?.status);
      console.log('✓ Long-running process completed');
    });
  });

  describe('Step 3: Send Runtime Commands', () => {
    it('sends input to running CLI process', async () => {
      const nodePath = findExecutable('node');
      expect(nodePath).toBeDefined();

      const command: CommandSpec = {
        executable: nodePath!,
        arguments: ['-e', 'setTimeout(() => process.exit(0), 500);'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      console.log('🚀 Spawning CLI for command sending test...');
      const processId = await processManager.spawn(command, 'test-command');

      // Wait for process to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      console.log('📤 Sending command to CLI...');
      await processManager.sendInput(processId, 'test-command-input');

      // Wait for process completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('✓ Command sent to CLI');
    });

    it('simulates changing provider/model via command', async () => {
      const nodePath = findExecutable('node');
      expect(nodePath).toBeDefined();

      const command: CommandSpec = {
        executable: nodePath!,
        arguments: ['-e', 'setTimeout(() => process.exit(0), 500);'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      console.log('🚀 Spawning CLI for model change simulation...');
      const processId = await processManager.spawn(command, 'test-model-change');

      // Wait for process to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      console.log('📤 Sending model change command...');
      await processManager.sendInput(processId, '/models anthropic claude-3-5-sonnet');

      // Wait for process completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('✓ Model change command sent');
    });

    it('simulates changing mode via command', async () => {
      const nodePath = findExecutable('node');
      expect(nodePath).toBeDefined();

      const command: CommandSpec = {
        executable: nodePath!,
        arguments: ['-e', 'setTimeout(() => process.exit(0), 500);'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      console.log('🚀 Spawning CLI for mode change simulation...');
      const processId = await processManager.spawn(command, 'test-mode-change');

      // Wait for process to be ready
      await new Promise((resolve) => setTimeout(resolve, 200));

      console.log('📤 Sending mode change command...');
      await processManager.sendInput(processId, '/mode coding');

      // Wait for process completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('✓ Mode change command sent');
    });
  });

  describe('Full Integration Flow', () => {
    it('completes full flow: detect -> spawn -> command -> stop', async () => {
      console.log('🔄 Starting full integration flow...');

      // Step 1: Detect
      console.log('\n📋 Step 1: Detecting CLI agents...');
      const results = discoverAllAgents();
      const detectedAgent = results.find((r) => r.result.detected);

      // Use node as fallback if no CLI agents detected
      const targetExecutable = detectedAgent?.result.path || findExecutable('node');
      const agentId = detectedAgent?.definition.id || 'node-test';
      const agentName = detectedAgent?.definition.name || 'Node.js';

      expect(targetExecutable).toBeDefined();
      console.log(`✓ Using ${agentName} at: ${targetExecutable}`);

      // Step 2: Spawn
      console.log('\n🚀 Step 2: Spawning CLI process...');
      const command: CommandSpec = {
        executable: targetExecutable!,
        arguments: ['--version'],
        workingDirectory: process.cwd(),
        environment: {},
        timeout: 10000,
        riskLevel: 'low',
      };

      const processId = await processManager.spawn(command, agentId);
      console.log(`✓ Process spawned with ID: ${processId}, PID: ${processManager.getProcess(processId)?.pid}`);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const proc = processManager.getProcess(processId);
      expect(['completed', 'failed', 'running']).toContain(proc?.status);
      console.log(`✓ Process status: ${proc?.status}`);

      // Step 3: Verify output
      console.log('\n📤 Step 3: Verifying CLI output...');
      const output = processManager.getOutput(processId);
      console.log(`✓ CLI output: ${output.trim()}`);

      // Step 4: Stop if still running
      console.log('\n🛑 Step 4: Ensuring CLI process is stopped...');
      if (proc?.status === 'running') {
        await processManager.cancel(processId);
      }

      const stoppedProc = processManager.getProcess(processId);
      expect(['failed', 'completed']).toContain(stoppedProc?.status);
      console.log(`✓ Process stopped with status: ${stoppedProc?.status}`);

      console.log('\n✅ Full integration flow completed successfully!');
    }, 10000);
  });
});
