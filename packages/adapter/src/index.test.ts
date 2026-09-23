import { describe, expect, it, vi } from 'vitest';
import { AdapterRegistry, AdapterRouter, type AgentAdapter } from './index.js';

function adapter(id: string, capabilities: string[]): AgentAdapter {
  return {
    id: () => id,
    name: () => id,
    detect: vi.fn(),
    getVersion: vi.fn(async () => 'test'),
    getCapabilities: vi.fn(async () => capabilities.map((capability) => ({ id: capability, name: capability }))),
    getModes: vi.fn(async () => []),
    validate: vi.fn(),
    buildCommand: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    sendInput: vi.fn(),
    parseOutput: vi.fn(() => []),
    parseExit: vi.fn(() => []),
  };
}

describe('AdapterRouter', () => {
  it('selects the preferred active adapter when it satisfies capabilities', async () => {
    const registry = new AdapterRegistry();
    registry.register(adapter('opencode', ['coding', 'terminal']));
    registry.register(adapter('claude', ['coding', 'reasoning']));

    const router = new AdapterRouter(registry, (id) => id !== 'claude');
    const result = await router.resolve({
      preferredAdapterId: 'opencode',
      requiredCapabilities: ['coding'],
    });

    expect(result?.adapterId).toBe('opencode');
    expect(result?.matchedCapabilities).toEqual(['coding']);
  });

  it('falls back to another active adapter when the preferred one is inactive', async () => {
    const registry = new AdapterRegistry();
    registry.register(adapter('opencode', ['coding']));
    registry.register(adapter('claude', ['coding', 'reasoning']));

    const router = new AdapterRouter(registry, (id) => id === 'claude');
    const result = await router.resolve({
      preferredAdapterId: 'opencode',
      requiredCapabilities: ['coding'],
    });

    expect(result?.adapterId).toBe('claude');
  });

  it('returns undefined when no active adapter satisfies requirements', async () => {
    const registry = new AdapterRegistry();
    registry.register(adapter('opencode', ['coding']));
    const router = new AdapterRouter(registry, () => false);

    await expect(router.resolve({ requiredCapabilities: ['coding'] })).resolves.toBeUndefined();
  });
});
