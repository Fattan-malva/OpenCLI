import { describe, it, expect } from 'vitest';
import {
  detectOS,
  getPathDirs,
  findExecutable,
  runCommand,
  getVersion,
  checkHealth,
  discoverAgent,
  discoverAllAgents,
  SUPPORTED_AGENTS,
} from './index.js';

describe('OS Detection', () => {
  it('detects current OS', () => {
    const os = detectOS();
    expect(os).toHaveProperty('platform');
    expect(os).toHaveProperty('arch');
    expect(os).toHaveProperty('homeDir');
    expect(os).toHaveProperty('pathSeparator');
    expect(['win32', 'darwin', 'linux']).toContain(os.platform);
  });

  it('gets PATH directories', () => {
    const dirs = getPathDirs();
    expect(Array.isArray(dirs)).toBe(true);
    expect(dirs.length).toBeGreaterThan(0);
  });

  it('finds common executables', () => {
    // Test with node which should always be available
    const nodePath = findExecutable('node');
    expect(nodePath).toBeDefined();
    expect(nodePath).toMatch(/node/);
  });

  it('returns undefined for non-existent executable', () => {
    const fakePath = findExecutable('nonexistent-cli-12345');
    expect(fakePath).toBeUndefined();
  });
});

describe('Command Execution', () => {
  it('runs successful command', () => {
    const result = runCommand('node --version');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/v\d+\.\d+/);
  });

  it('handles failed command', () => {
    const result = runCommand('node --invalid-flag-12345');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBeDefined();
  });

  it('handles timeout', () => {
    const result = runCommand('node -e "setTimeout(() => {}, 20000)"', { timeout: 1000 });
    expect(result.exitCode).not.toBe(0);
  });
});

describe('Version Detection', () => {
  it('gets version from executable', () => {
    const nodePath = findExecutable('node');
    if (nodePath) {
      const version = getVersion(nodePath, ['--version']);
      expect(version).toBeDefined();
      // Node version can be "v20.16.0" or "20.16.0" depending on platform
      expect(version).toMatch(/\d+\.\d+/);
    }
  });

  it('returns undefined for invalid executable', () => {
    const version = getVersion('nonexistent-cli', ['--version']);
    expect(version).toBeUndefined();
  });
});

describe('Health Check', () => {
  it('checks health of valid executable', () => {
    const nodePath = findExecutable('node');
    if (nodePath) {
      const health = checkHealth(nodePath);
      expect(health.healthy).toBe(true);
      expect(health.message).toBeDefined();
    }
  });

  it('checks health of invalid executable', () => {
    const health = checkHealth('nonexistent-cli');
    expect(health.healthy).toBe(false);
  });
});

describe('Agent Discovery', () => {
  it('discovers all supported agents', () => {
    const results = discoverAllAgents();
    expect(results.length).toBe(SUPPORTED_AGENTS.length);
    expect(results).toHaveLength(3); // opencode, kilocode, claude
  }, 10000);

  it('detects agent if executable exists', () => {
    // Test with node as a mock agent
    const result = discoverAgent({
      id: 'test-node',
      name: 'Test Node',
      executables: ['node'],
      adapterId: 'test',
    });
    expect(result.detected).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.executable).toBe('node');
  });

  it('does not detect agent if executable missing', () => {
    const result = discoverAgent({
      id: 'test-fake',
      name: 'Test Fake',
      executables: ['nonexistent-cli-12345'],
      adapterId: 'test',
    });
    expect(result.detected).toBe(false);
    expect(result.path).toBeUndefined();
  });

  it('returns version for detected agent', () => {
    const result = discoverAgent({
      id: 'test-node',
      name: 'Test Node',
      executables: ['node'],
      adapterId: 'test',
    });
    if (result.detected) {
      expect(result.version).toBeDefined();
    }
  });
});

describe('Platform-Specific Behavior', () => {
  it('uses correct path separator', () => {
    const os = detectOS();
    if (os.platform === 'win32') {
      expect(os.pathSeparator).toBe(';');
    } else {
      expect(os.pathSeparator).toBe(':');
    }
  });

  it('handles platform-specific executable extensions', () => {
    const os = detectOS();
    if (os.platform === 'win32') {
      // Should find .exe files
      const nodePath = findExecutable('node');
      expect(nodePath).toBeDefined();
      if (nodePath) {
        expect(nodePath).toMatch(/\.(exe|cmd|ps1)?$/);
      }
    }
  });
});
