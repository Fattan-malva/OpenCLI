import type { ConfirmationPolicy, InteractionMode } from '@opencli/domain';
import type { OpenCLIRepository } from '@opencli/db';

export interface SystemSettings {
  maxParallelAgents: number;
  defaultModePolicy: string;
  telemetry: boolean;
}

export const DEFAULT_SETTINGS: SystemSettings = {
  maxParallelAgents: 4,
  defaultModePolicy: 'Require Approval on Commit (Safe)',
  telemetry: true,
};

export function getSystemSettings(db: OpenCLIRepository): SystemSettings {
  const raw = db.getSetting('system.settings');
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Mode (Ask/Plan/Agent) and confirmation policy (Default/Allow All/Auto Pilot)
 * belong to the chat input form and travel WITH each message — they are not
 * global settings.
 */
/**
 * Ask is the default because it is the only mode that has no side effects: one
 * adapter answers, no workflow is created and nothing else runs.
 */
export const DEFAULT_INTERACTION_MODE: InteractionMode = 'ask';
export const DEFAULT_CONFIRMATION_POLICY: ConfirmationPolicy = 'default';

export function resolvedInteractionMode(explicit?: InteractionMode | undefined): InteractionMode {
  return explicit ?? DEFAULT_INTERACTION_MODE;
}

export function resolvedConfirmationPolicy(explicit?: ConfirmationPolicy | undefined): ConfirmationPolicy {
  return explicit ?? DEFAULT_CONFIRMATION_POLICY;
}

export function sanitizeInteractionMode(value: unknown): InteractionMode | undefined {
  return value === 'ask' || value === 'plan' || value === 'agent' ? value : undefined;
}

export function sanitizeConfirmationPolicy(value: unknown): ConfirmationPolicy | undefined {
  return value === 'default' || value === 'allowAll' || value === 'autoPilot' ? value : undefined;
}

/**
 * Only permission requests are auto-approved. Questions, choices and message
 * edits still surface to the user even under autoPilot.
 */
export function shouldAutoApprove(policy: ConfirmationPolicy, request: { type?: string }): boolean {
  if (policy !== 'allowAll' && policy !== 'autoPilot') return false;
  return request?.type === 'permission';
}

export function sanitizeSettingsPatch(body: Record<string, unknown>): Partial<SystemSettings> {
  const patch: Partial<SystemSettings> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'maxParallelAgents' && typeof value === 'number' && value > 0) {
      patch.maxParallelAgents = value;
    } else if (key === 'defaultModePolicy' && typeof value === 'string') {
      patch.defaultModePolicy = value;
    } else if (key === 'telemetry' && typeof value === 'boolean') {
      patch.telemetry = value;
    }
  }
  return patch;
}