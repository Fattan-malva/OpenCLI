// AgentAdapter interface based on 04-agent-adapter-spec.md
import type {
  Agent,
  CommandSpec,
  DetectionResult,
  HealthResult,
  Capability,
  AgentMode,
  OpenCLIEvent,
} from '@opencli/domain';

export interface AgentContext {
  projectPath: string;
  workspacePath: string;
  taskId: string;
  taskDescription: string;
  mode: string;
  model?: {
    provider: string;
    model: string;
  };
  environment: Record<string, string>;
  relevantFiles: string[];
  projectMemory: Record<string, unknown>;
}

export interface AgentProcess {
  processId: string;
  pid?: number;
}

export interface AgentAdapter {
  id(): string;
  name(): string;
  detect(): Promise<DetectionResult>;
  getVersion(): Promise<string>;
  getCapabilities(): Promise<Capability[]>;
  getModes(): Promise<AgentMode[]>;
  validate(): Promise<HealthResult>;
  buildCommand(context: AgentContext): CommandSpec;
  start(context: AgentContext): Promise<AgentProcess>;
  stop(processId: string): Promise<void>;
  pause(processId: string): Promise<void>;
  resume(processId: string): Promise<void>;
  sendInput(processId: string, input: string): Promise<void>;
  parseOutput(chunk: string): OpenCLIEvent[];
  parseExit(code: number | null): OpenCLIEvent[];
}

// Adapter registry
export class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id(), adapter);
  }

  get(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  async detectAll(): Promise<Array<{ adapter: AgentAdapter; result: DetectionResult }>> {
    const results = await Promise.all(
      this.list().map(async (adapter) => ({
        adapter,
        result: await adapter.detect(),
      })),
    );
    return results;
  }
}

// Re-export types for consumers
export type { Agent, CommandSpec, DetectionResult, HealthResult, Capability, AgentMode, OpenCLIEvent } from '@opencli/domain';

export interface AdapterRouteRequirement {
  requiredCapabilities?: string[];
  preferredAdapterId?: string;
  excludedAdapterIds?: string[];
}

export interface AdapterRoute {
  adapterId: string;
  score: number;
  matchedCapabilities: string[];
  adapter: AgentAdapter;
}

export class AdapterRouter {
  constructor(
    private registry: AdapterRegistry,
    private isActive: (adapterId: string) => boolean = () => true,
  ) {}

  async resolve(requirement: AdapterRouteRequirement = {}): Promise<AdapterRoute | undefined> {
    const required = new Set(requirement.requiredCapabilities ?? []);
    const excluded = new Set(requirement.excludedAdapterIds ?? []);
    const routes: AdapterRoute[] = [];

    for (const adapter of this.registry.list()) {
      if (excluded.has(adapter.id()) || !this.isActive(adapter.id())) continue;

      const capabilities = await adapter.getCapabilities();
      const ids = new Set(capabilities.map((capability) => capability.id));
      const matchedCapabilities = [...required].filter((id) => ids.has(id));
      if (matchedCapabilities.length !== required.size) continue;

      let score = matchedCapabilities.length * 100;
      if (requirement.preferredAdapterId === adapter.id()) score += 1000;
      routes.push({ adapterId: adapter.id(), score, matchedCapabilities, adapter });
    }

    routes.sort((a, b) => b.score - a.score || a.adapterId.localeCompare(b.adapterId));
    return routes[0];
  }
}
