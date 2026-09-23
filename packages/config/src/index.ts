import { z } from 'zod';
import type { PermissionSet } from '@opencli/domain';

// === Zod schemas for config validation ===

export const PermissionSetSchema = z.object({
  read: z.boolean().default(false),
  write: z.boolean().default(false),
  delete: z.boolean().default(false),
  terminal: z.boolean().default(false),
  network: z.boolean().default(false),
  git: z.boolean().default(false),
  install: z.boolean().default(false),
  system: z.boolean().default(false),
});

export const ModeConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: PermissionSetSchema,
  systemPolicy: z.string().optional(),
  defaultModel: z.string().optional(),
});

export const ProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['openai', 'anthropic', 'google', 'openai-compatible']),
  baseUrl: z.string().optional(),
  credentialRef: z.string().optional(),
});

export const ModelConfigSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  name: z.string(),
  contextWindow: z.number().optional(),
});

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  executable: z.string(),
  defaultMode: z.string().optional(),
  modes: z.record(z.string(), ModeConfigSchema).optional(),
  adapterId: z.string(),
});

export const RoutingRuleSchema = z.object({
  agent: z.string(),
  mode: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
});

export const ProjectSettingsSchema = z.object({
  maxParallelAgents: z.number().min(1).max(20).default(4),
  defaultAgent: z.string().optional(),
  defaultMode: z.string().optional(),
});

export const ProjectConfigSchema = z.object({
  project: z.object({
    name: z.string(),
    path: z.string(),
  }),
  settings: ProjectSettingsSchema.default({ maxParallelAgents: 4 }),
  routing: z.record(RoutingRuleSchema).default({}),
});

export const GlobalConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).default([]),
  models: z.array(ModelConfigSchema).default([]),
  modes: z.array(ModeConfigSchema).default([]),
  defaultConcurrency: z.number().min(1).max(20).default(4),
  ui: z
    .object({
      theme: z.enum(['light', 'dark', 'system']).default('system'),
      language: z.string().default('en'),
    })
    .default({}),
});

// === Config types ===

export type ModeConfig = z.infer<typeof ModeConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type RoutingRule = z.infer<typeof RoutingRuleSchema>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

// === Config manager: hierarchical merging (05-config-spec.md) ===

export interface ConfigStore {
  getGlobal(): GlobalConfig;
  getProject(projectId: string): ProjectConfig | undefined;
  setGlobal(config: Partial<GlobalConfig>): void;
  setProject(projectId: string, config: Partial<ProjectConfig>): void;
}

// In-memory config store (backed by DB or file in production)
export class InMemoryConfigStore implements ConfigStore {
  private global: GlobalConfig;
  private projects = new Map<string, ProjectConfig>();

  constructor(global?: GlobalConfig) {
    this.global = global ?? GlobalConfigSchema.parse({});
  }

  getGlobal(): GlobalConfig {
    return this.global;
  }

  setGlobal(updates: Partial<GlobalConfig>): void {
    this.global = { ...this.global, ...updates };
  }

  getProject(projectId: string): ProjectConfig | undefined {
    return this.projects.get(projectId);
  }

  setProject(projectId: string, updates: Partial<ProjectConfig>): void {
    const existing = this.projects.get(projectId);
    if (existing) {
      this.projects.set(projectId, { ...existing, ...updates });
    } else {
      const config = ProjectConfigSchema.parse({
        project: { name: updates.project?.name ?? projectId, path: updates.project?.path ?? '.' },
        ...updates,
      });
      this.projects.set(projectId, config);
    }
  }

  // Resolve routing for a task: task override → project routing → global default
  resolveRouting(
    projectId: string,
    taskCategory: string,
  ): { agent?: string; mode?: string; model?: string; provider?: string } | undefined {
    const project = this.projects.get(projectId);
    if (project?.routing?.[taskCategory]) {
      return project.routing[taskCategory];
    }
    return undefined;
  }

  // Resolve effective permissions for a mode, merged with global defaults
  resolveModePermissions(modeId: string): PermissionSet | undefined {
    const mode = this.global.modes.find((m) => m.id === modeId);
    return mode?.permissions;
  }

  // Get max parallel agents for a project
  getMaxParallelAgents(projectId: string): number {
    return this.projects.get(projectId)?.settings?.maxParallelAgents ?? this.global.defaultConcurrency;
  }
}
