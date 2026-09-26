// AgentAdapter interface based on 04-agent-adapter-spec.md
import type {
  Agent,
  AgentManifest,
  CommandSpec,
  DetectionResult,
  DiscoveryPlan,
  HealthResult,
  Capability,
  AgentMode,
  OpenCLIEvent,
} from '@opencli/domain';

export interface ModelSelection {
  provider: string;
  model: string;
  /**
   * Exact spec as printed by the CLI, when it differs from `provider/model`.
   *
   * Kilo requires `kilo/~anthropic/claude-opus-latest` and rejects anything
   * shorter, so rebuilding the argument from `provider` + `model` would send a
   * spec the CLI refuses. Adapters must prefer this when it is present.
   */
  spec?: string;
}

/**
 * Model spec to hand to a CLI, preferring the exact discovered spec.
 *
 * Falls back to `provider/model` only when no spec was carried through, which
 * keeps older callers working.
 */
export function modelSpec(selection: ModelSelection | undefined): string | undefined {
  if (!selection) return undefined;
  if (selection.spec) return selection.spec;
  if (selection.provider && selection.model) return `${selection.provider}/${selection.model}`;
  return selection.model || undefined;
}

export interface AgentContext {
  projectPath: string;
  workspacePath: string;
  taskId: string;
  taskDescription: string;
  mode: string;
  model?: ModelSelection;
  environment: Record<string, string>;
  relevantFiles: string[];
  projectMemory: Record<string, unknown>;
}

/** Context for hosting a CLI's own TUI on a PTY instead of scripting it. */
export interface InteractiveContext {
  projectPath: string;
  workspacePath: string;
  mode?: string;
  model?: ModelSelection;
  environment: Record<string, string>;
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
  /**
   * User-selectable modes.
   *
   * Implementations must return what the CLI actually offers. Declaring a fixed
   * list here is a bug: it will drift from the installed CLI and surface modes
   * that do not exist.
   */
  getModes(): Promise<AgentMode[]>;
  validate(): Promise<HealthResult>;

  /**
   * How to interrogate this CLI for its agents, models and providers.
   * Purely declarative so the discovery engine needs no per-adapter branching.
   */
  discoveryPlan(): DiscoveryPlan;

  /** Interrogates the installed CLI and reports what it supports. */
  discover(context: InteractiveContext): Promise<AgentManifest>;

  buildCommand(context: AgentContext): CommandSpec;

  /**
   * Command that launches the CLI's native TUI, for hosting on a PTY.
   *
   * This is deliberately separate from `buildCommand`, which targets the
   * non-interactive automation entry point. A CLI usually needs different
   * arguments (often none at all) to show its interactive UI.
   */
  buildInteractiveCommand(context: InteractiveContext): CommandSpec;

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
export type {
  Agent,
  AgentManifest,
  CommandSpec,
  DetectionResult,
  HealthResult,
  Capability,
  AgentMode,
  DiscoveryPlan,
  OpenCLIEvent,
} from '@opencli/domain';

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
