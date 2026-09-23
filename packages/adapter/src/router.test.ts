import { describe, expect, it, vi } from 'vitest';
import type { AgentAdapter } from './index.js';
import { AdapterRegistry, AdapterRouter } from './index.js';

function mockAdapter(id: string, capabilities: string[]): AgentAdapter {
  return {
    id: () => id,
    name: () => id,
    detect: vi.fn(),
    getVersion: vi.fn(),
    getCapabilities: vi.fn(async () => capabilities.map((value) => ({ id: value, name: value }))),
    getModes: vi.fn(),
    validate: vi.fn(),
    buildCommand: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    sendInput: vi.fn(),
    parseOutput: vi.fn(),
    parseExit: vi.fn(),
  } as unknown as AgentAdapter;
}

describe('AdapterRouter', () => {
  it('routes to an active adapter with the requested capabilities', async () => {
    const registry = new AdapterRegistry();
    registry.register(mockAdapter('open-code', ['coding', 'terminal']));
    registry.register(mockAdapter('reviewer', ['reasoning', 'file_edit']));

    const router = new AdapterRouter(registry, (id) => id !== 'open-code');
    const route = await router.resolve({ requiredCapabilities: ['reasoning'] });

    expect(route?.adapterId).toBe('reviewer');
    expect(route?.matchedCapabilities).toEqual(['reasoning']);
  });

  it('prefers the requested active adapter when capability requirements are met', async () => {
    const registry = new AdapterRegistry();
    registry.register(mockAdapter('a', ['coding']));
    registry.register(mockAdapter('b', ['coding']));

    const router = new AdapterRouter(registry);
    const route = await router.resolve({
      requiredCapabilities: ['coding'],
      preferredAdapterId: 'b',
    });

    expect(route?.adapterId).toBe('b');
  });
});
