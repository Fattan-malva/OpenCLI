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

describe('AdapterRouter.resolveMany', () => {
  function registry3() {
    const registry = new AdapterRegistry();
    registry.register(mockAdapter('alpha', ['coding', 'terminal']));
    registry.register(mockAdapter('bravo', ['coding', 'reasoning']));
    registry.register(mockAdapter('charlie', ['web']));
    return registry;
  }

  it('returns several distinct adapters that all satisfy the requirement', async () => {
    const router = new AdapterRouter(registry3());
    const routes = await router.resolveMany({ requiredCapabilities: ['coding'] });
    expect(routes.map((r) => r.adapterId).sort()).toEqual(['alpha', 'bravo']);
  });

  it('honours maxAdapters', async () => {
    const router = new AdapterRouter(registry3());
    const routes = await router.resolveMany({ requiredCapabilities: ['coding'], maxAdapters: 1 });
    expect(routes).toHaveLength(1);
  });

  it('puts the preferred adapter first', async () => {
    const router = new AdapterRouter(registry3());
    const routes = await router.resolveMany({
      requiredCapabilities: ['coding'],
      preferredAdapterId: 'bravo',
    });
    expect(routes[0]?.adapterId).toBe('bravo');
  });

  it('returns nothing when no adapter satisfies the requirement', async () => {
    const router = new AdapterRouter(registry3());
    expect(await router.resolveMany({ requiredCapabilities: ['quantum'] })).toEqual([]);
  });

  it('never returns an inactive adapter', async () => {
    const router = new AdapterRouter(registry3(), (id) => id === 'alpha');
    const routes = await router.resolveMany({ requiredCapabilities: ['coding'] });
    expect(routes.map((r) => r.adapterId)).toEqual(['alpha']);
  });

  it('resolve and resolveMany agree on the single best route', async () => {
    const router = new AdapterRouter(registry3());
    const best = await router.resolve({ requiredCapabilities: ['coding'], preferredAdapterId: 'bravo' });
    const many = await router.resolveMany({ requiredCapabilities: ['coding'], preferredAdapterId: 'bravo' });
    expect(many[0]?.adapterId).toBe(best?.adapterId);
  });
});