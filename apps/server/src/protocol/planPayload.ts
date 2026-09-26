// Recognising a plan wherever an adapter happens to put it.
//
// A plan is a JSON document, and adapters emit it from tool arguments, from tool
// output, and from ordinary assistant text. Matching on the shape rather than on
// a tool name is what makes this work across adapters instead of only for the
// one whose name happens to be `step`.
import type { ConversationPlanStep } from '@opencli/domain';

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stepList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const steps = (value as { steps?: unknown }).steps;
    if (Array.isArray(steps)) return steps;
  }
  return [];
}

function normalizeStep(raw: unknown, index: number): ConversationPlanStep | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entry = raw as Record<string, unknown>;
  const title = asText(entry.title);
  // A plan step with no title is not a step. Requiring one is also what keeps
  // unrelated JSON that happens to have a `steps` key from being shown as a
  // plan.
  if (!title) return undefined;

  const fileScopes = Array.isArray(entry.fileScopes)
    ? entry.fileScopes.filter((scope): scope is string => typeof scope === 'string' && scope.trim().length > 0)
    : undefined;
  const dependsOn = Array.isArray(entry.dependsOn)
    ? entry.dependsOn.filter(
        (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0,
      )
    : undefined;

  return {
    id: asText(entry.id) ?? String(index),
    title,
    description: asText(entry.description),
    agentId: asText(entry.agentId),
    modeId: asText(entry.modeId),
    fileScopes: fileScopes?.length ? fileScopes : undefined,
    dependsOn: dependsOn?.length ? dependsOn : undefined,
  };
}

export interface PlanPayload {
  steps: ConversationPlanStep[];
  reason?: string;
}

/**
 * Reads a plan out of a value, or returns undefined when it is not one.
 *
 * Anything that parses as JSON is tried, including a JSON document embedded in
 * prose, because the same tool has been seen returning both the bare object and
 * the object wrapped in explanation.
 */
export function planFrom(value: unknown): PlanPayload | undefined {
  const candidates: unknown[] = [value];

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return undefined;
    try {
      candidates.push(JSON.parse(text));
    } catch {
      // Not a bare document. Look for one embedded in the text.
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try {
          candidates.push(JSON.parse(text.slice(first, last + 1)));
        } catch {
          return undefined;
        }
      }
    }
  }

  for (const candidate of candidates) {
    const list = stepList(candidate);
    if (list.length === 0) continue;
    const steps = list.map(normalizeStep).filter((step): step is ConversationPlanStep => Boolean(step));
    if (steps.length === 0) continue;
    const reason =
      candidate && typeof candidate === 'object' ? asText((candidate as { reason?: unknown }).reason) : undefined;
    return { steps, reason };
  }

  return undefined;
}
