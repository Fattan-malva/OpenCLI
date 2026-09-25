import type { ExecutionPlan, PlanStep, PlannerDecision } from '@opencli/domain';

export interface PlannerContext {
  projectName: string;
  projectPath: string;
  agents: Array<{ id: string; name: string; modes: string[] }>;
}

export function buildPlannerPrompt(task: string, context: PlannerContext): string {
  const roster = context.agents
    .map((agent) => `- ${agent.id} (${agent.name}) modes: ${agent.modes.join(', ') || 'default'}`)
    .join('\n');

  return [
    'You are the planner inside OpenCLI. Break the task below into concrete steps (a todo list), then reply with JSON only.',
    '',
    'Running agent sessions:',
    roster,
    '',
    `Project: ${context.projectName} (${context.projectPath})`,
    '',
    'Rules:',
    '1. Produce 1 to 6 concrete steps. A single small task may be exactly one step.',
    '2. Assign each step to ONE adapter ("agentId" must be one of the listed ids).',
    '3. Use "fileScopes" (glob) so agents working in parallel never touch the same files.',
    '4. Use "dependsOn" (zero-based indexes of earlier steps) only when a step needs the output',
    '   of a previous step. Steps without explicit dependencies may run in parallel.',
    '5. Steps that read-only and do not change code are fine too — an agent is a generalist.',
    '',
    'Reply with exactly this shape (no prose, no markdown fences):',
    '{"steps":[{"title":"short title","description":"full instruction for the agent","agentId":"one of the listed ids","modeId":"build or plan","fileScopes":["src/foo/**"],"dependsOn":[]}],"reason":"optional one-line justification"}',
    '',
    'User task:',
    task,
  ].join('\n');
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/gi);
  if (fenced) {
    for (const match of fenced) {
      const body = match.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      if (body) candidates.push(body);
    }
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  return candidates;
}

function parseCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function normalizeSteps(raw: unknown): PlanStep[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { steps?: unknown }).steps)
      ? (raw as { steps: unknown[] }).steps
      : [];
  const steps: PlanStep[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    if (!title) continue;

    const fileScopes = Array.isArray(entry.fileScopes)
      ? entry.fileScopes.filter((scope): scope is string => typeof scope === 'string' && scope.trim().length > 0)
      : [];
    const dependsOn = Array.isArray(entry.dependsOn)
      ? entry.dependsOn.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0)
      : [];

    steps.push({
      title,
      description: typeof entry.description === 'string' ? entry.description.trim() : undefined,
      agentId: typeof entry.agentId === 'string' ? entry.agentId.trim() : undefined,
      modeId: typeof entry.modeId === 'string' ? entry.modeId.trim() : undefined,
      fileScopes,
      dependsOn,
    });
  }

  return steps;
}

export function parseExecutionPlan(text: string, availableAgentIds: string[]): ExecutionPlan | undefined {
  const available = new Set(availableAgentIds);
  for (const candidate of extractJsonCandidates(text)) {
    const parsed = parseCandidate(candidate);
    if (parsed === undefined) continue;
    const steps = normalizeSteps(parsed);
    if (steps.length === 0) continue;

    const total = steps.length;
    const normalized = steps.map((step, index) => ({
      ...step,
      agentId: step.agentId && available.has(step.agentId) ? step.agentId : undefined,
      dependsOn: (step.dependsOn ?? []).filter((value) => value < index),
    }));
    if (total > 12) return { steps: normalized.slice(0, 12) };
    return { steps: normalized };
  }
  return undefined;
}

export function assignDefaultAgents(steps: PlanStep[], agentIds: string[]): PlanStep[] {
  if (agentIds.length === 0) return steps;
  return steps.map((step, index) => ({
    ...step,
    agentId: step.agentId ?? agentIds[index % agentIds.length],
  }));
}

/**
 * Planner v3 heuristic fallback: this should be a todo list. A single todo that
 * delegates the raw task to the least-busy agent is always valid.
 */
export function heuristicPlannerDecision(text: string): PlannerDecision {
  return {
    steps: [
      {
        title: 'Run the task',
        description: text.trim() || 'Complete the user task.',
      },
    ],
    reason: 'Could not parse a structured plan; falling back to a single delegated todo.',
  };
}

function decisionFromCandidate(parsed: unknown, available: Set<string>): PlannerDecision | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const entry = parsed as Record<string, unknown>;

  // Legacy candidates that still emit decision:"broadcast" carry no breakdown;
  // the caller surfaces "planner produced no steps" instead of broadcasting.
  if (entry.decision === 'broadcast') {
    return { steps: [], reason: typeof entry.reason === 'string' ? entry.reason : undefined };
  }

  const steps = normalizeSteps(entry);
  if (steps.length === 0) return undefined;

  const normalized = steps.map((step, index) => ({
    ...step,
    agentId: step.agentId && available.has(step.agentId) ? step.agentId : undefined,
    dependsOn: (step.dependsOn ?? []).filter((value) => value < index),
  }));

  return {
    steps: normalized.length > 12 ? normalized.slice(0, 12) : normalized,
    reason: typeof entry.reason === 'string' ? entry.reason : undefined,
  };
}

/**
 * Parses the planner v3 AI decision. The decision is always a step list;
 * the broadcast/split choice no longer exists. Prefers JSON candidates,
 * falls back to a single-todo heuristic so a malformed reply never stalls.
 */
export function parsePlannerDecision(text: string, availableAgentIds: string[]): PlannerDecision {
  const available = new Set(availableAgentIds);
  for (const candidate of extractJsonCandidates(text)) {
    const parsed = parseCandidate(candidate);
    if (parsed === undefined) continue;
    const decision = decisionFromCandidate(parsed, available);
    if (decision) return decision;
  }
  return heuristicPlannerDecision(text);
}