// Layer 3 of the chat pipeline: the conversation.
//
// A conversation turn is an ordered list of items, folded from protocol events.
// This is the only representation the UI consumes: it renders items, and never
// parses adapter text or folds events itself. That is why a reload shows exactly
// what was streamed — the server already decided what each piece means.
import {
  clampText,
  shellCommand,
  TOOL_INPUT_LIMIT,
  TOOL_OUTPUT_LIMIT,
  type AgentEvent,
} from '../protocol/agentEvent.js';
import type {
  ConversationFileChangeItem,
  ConversationItem,
  ConversationItemStatus,
  ConversationPermissionItem,
  ConversationQuestionItem,
  ConversationSkillItem,
  ConversationStatusItem,
  ConversationTextItem,
  ConversationTodoItem,
  ConversationPlanItem,
  ConversationToolData,
  ConversationToolItem,
} from '@opencli/domain';

function indexOfItem(items: ConversationItem[], id: string): number {
  return items.findIndex((item) => item.id === id);
}

function appendText(
  items: ConversationItem[],
  id: string,
  seq: number,
  chunk: string,
  kind: 'message' | 'thinking',
): ConversationItem[] {
  if (!chunk) return items;
  const index = indexOfItem(items, id);
  if (index === -1) return [...items, { id, kind, status: 'running', seq, text: chunk }];
  const item = items[index];
  if (item.kind !== 'message' && item.kind !== 'thinking') return items;
  const next = items.slice();
  next[index] = { ...item, text: item.text + chunk };
  return next;
}

/**
 * Closes an open text item.
 *
 * A `complete` event carries whatever the adapter considered final, which is
 * often empty for a stream. So the longer of the two is kept, never the shorter:
 * a final empty snapshot must not erase what already streamed.
 */
function closeText(
  items: ConversationItem[],
  id: string,
  status: ConversationItemStatus,
  finalText: string,
): ConversationItem[] {
  const index = indexOfItem(items, id);
  if (index === -1) {
    if (!finalText) return items;
    return [...items, { id, kind: 'message', status, seq: 0, text: finalText }];
  }
  const item = items[index];
  if (item.kind !== 'message' && item.kind !== 'thinking') return items;
  const next = items.slice();
  next[index] = { ...item, status, text: finalText.length > item.text.length ? finalText : item.text };
  return next;
}

/**
 * Maps the state an adapter reported onto an item status.
 *
 * Completion is taken from what the CLI said, not from the absence of another
 * event, so a tool that reports `running` stays visibly running.
 */
function reportedStatus(reported: string | undefined, phase: 'start' | 'update' | 'complete', failed: boolean): ConversationItemStatus {
  if (failed) return 'failed';
  const value = (reported ?? '').toLowerCase();
  if (value === 'error' || value === 'failed') return 'failed';
  if (value === 'cancelled' || value === 'aborted' || value === 'rejected') return 'cancelled';
  if (value === 'completed' || value === 'complete' || value === 'success' || value === 'done') return 'completed';
  return phase === 'complete' ? 'completed' : 'running';
}

function clipInput(input: unknown): unknown {
  if (input === undefined) return undefined;
  if (typeof input === 'string') {
    return input.length > TOOL_INPUT_LIMIT ? `${input.slice(0, TOOL_INPUT_LIMIT)}…` : input;
  }
  try {
    const serialized = JSON.stringify(input);
    if (serialized.length <= TOOL_INPUT_LIMIT) return input;
    return `${serialized.slice(0, TOOL_INPUT_LIMIT)}…`;
  } catch {
    return undefined;
  }
}

function replaceItem(items: ConversationItem[], item: ConversationItem): ConversationItem[] {
  const index = indexOfItem(items, item.id);
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}

function mergeTool(
  items: ConversationItem[],
  id: string,
  seq: number,
  data: ConversationToolData,
  phase: 'start' | 'update' | 'complete',
): ConversationItem[] {
  const index = indexOfItem(items, id);
  const previous = index === -1 ? undefined : items[index];

  // An `update` only carries what changed, so absent fields keep the value an
  // earlier event delivered instead of wiping the arguments already received.
  const name = data.name ?? (previous?.kind === 'tool' ? previous.name : undefined) ?? 'tool';
  const input = data.input !== undefined ? data.input : previous?.kind === 'tool' ? previous.input : undefined;
  const clipped = clipInput(input);
  const output = data.output !== undefined ? clampText(data.output, TOOL_OUTPUT_LIMIT) : undefined;
  const error = data.error ?? (previous?.kind === 'tool' ? previous.error : undefined);
  const previousOutput = previous?.kind === 'tool' ? previous.output : undefined;

  const item: ConversationToolItem = {
    id,
    kind: 'tool',
    status: reportedStatus(data.status, phase, Boolean(error)),
    seq: previous?.seq ?? seq,
    name,
    input: clipped,
    command: shellCommand(name, clipped) ?? (previous?.kind === 'tool' ? previous.command : undefined),
    output: output?.text ?? previousOutput,
    error,
    title: data.title ?? (previous?.kind === 'tool' ? previous.title : undefined),
    metadata: data.metadata ?? (previous?.kind === 'tool' ? previous.metadata : undefined),
    truncated: output?.truncated || (previous?.kind === 'tool' ? previous.truncated : undefined),
  };

  return replaceItem(items, item);
}

/** The single todo widget, so a checklist updates in place. */
const TODO_ITEM_ID = 'todo';

/**
 * Folds one protocol event into the item list.
 *
 * Returns the same array reference when nothing changed, so a caller can use
 * identity to decide whether a write is needed.
 */
export function applyEvent(items: ConversationItem[], event: AgentEvent): ConversationItem[] {
  switch (event.type) {
    case 'turn':
      return items;

    case 'message':
    case 'thinking': {
      const kind = event.type;
      if (event.phase === 'complete') return closeText(items, event.id, 'completed', event.data.text);
      return appendText(items, event.id, event.seq, event.data.text, kind);
    }

    case 'tool':
      return mergeTool(items, event.id, event.seq, event.data, event.phase);

    case 'skill': {
      const index = indexOfItem(items, event.id);
      const previous = index === -1 ? undefined : items[index];
      const item: ConversationSkillItem = {
        id: event.id,
        kind: 'skill',
        status: event.phase === 'complete' ? 'completed' : 'running',
        seq: previous?.seq ?? event.seq,
        name: event.data.name,
        skillId: event.data.skillId ?? (previous?.kind === 'skill' ? previous.skillId : undefined),
        detail: event.data.detail ?? (previous?.kind === 'skill' ? previous.detail : undefined),
      };
      return replaceItem(items, item);
    }

    case 'todo': {
      const index = indexOfItem(items, TODO_ITEM_ID);
      const previous = index === -1 ? undefined : items[index];
      const item: ConversationTodoItem = {
        id: TODO_ITEM_ID,
        kind: 'todo',
        status: event.phase === 'complete' ? 'completed' : 'running',
        seq: previous?.seq ?? event.seq,
        items: event.data.items ?? [],
      };
      return replaceItem(items, item);
    }

    case 'plan': {
      // One live plan per turn, because the agent is working to one plan. Two
      // would read as two competing sets of steps.
      const index = indexOfItem(items, 'plan');
      const item: ConversationPlanItem = {
        id: 'plan',
        kind: 'plan',
        status: event.phase === 'complete' ? 'completed' : 'running',
        seq: index === -1 ? event.seq : (items[index]?.seq ?? event.seq),
        steps: event.data.steps,
        reason: event.data.reason,
      };
      return replaceItem(items, item);
    }

    case 'file_change': {
      const item: ConversationFileChangeItem = {
        id: event.id,
        kind: 'file_change',
        status: 'completed',
        seq: event.seq,
        path: event.data.path,
        action: event.data.action,
        additions: event.data.additions,
        deletions: event.data.deletions,
        patch: event.data.patch,
      };
      return replaceItem(items, item);
    }

    case 'question': {
      const index = indexOfItem(items, event.id);
      const previous = index === -1 ? undefined : items[index];
      if (event.phase === 'complete') {
        if (index === -1) return items;
        const next = items.slice();
        next[index] = { ...(previous as ConversationQuestionItem), status: 'completed' };
        return next;
      }
      const item: ConversationQuestionItem = {
        id: event.id,
        kind: 'question',
        status: 'pending',
        seq: previous?.seq ?? event.seq,
        requestId: event.data.requestId,
        question: event.data.question,
        options: event.data.options ?? [],
        multiple: event.data.multiple,
      };
      return replaceItem(items, item);
    }

    case 'permission': {
      const index = indexOfItem(items, event.id);
      const previous = index === -1 ? undefined : items[index];
      if (event.phase === 'complete') {
        if (index === -1) return items;
        const next = items.slice();
        next[index] = { ...(previous as ConversationPermissionItem), status: 'completed' };
        return next;
      }
      const prior = previous?.kind === 'permission' ? previous : undefined;
      const item: ConversationPermissionItem = {
        id: event.id,
        kind: 'permission',
        status: 'pending',
        seq: prior?.seq ?? event.seq,
        requestId: event.data.requestId,
        tool: event.data.tool ?? prior?.tool,
        command: event.data.command ?? prior?.command,
        detail: event.data.detail ?? prior?.detail,
      };
      return replaceItem(items, item);
    }

    case 'status': {
      const item: ConversationStatusItem = {
        id: event.id,
        kind: 'status',
        status: 'completed',
        seq: event.seq,
        label: event.data.label,
        detail: event.data.detail,
      };
      return replaceItem(items, item);
    }

    case 'error': {
      // A repeated failure is folded into the item that already reports it, so a
      // retry loop does not fill the transcript with the same line.
      const existing = items.find((item) => item.kind === 'error' && item.message === event.data.message);
      if (existing) return items;
      return replaceItem(items, {
        id: event.id,
        kind: 'error',
        status: 'failed',
        seq: event.seq,
        message: event.data.message,
      });
    }

    default:
      return items;
  }
}

/** Applies a batch in order, returning the final list. */
export function applyEvents(items: ConversationItem[], events: AgentEvent[]): ConversationItem[] {
  let current = items;
  for (const event of events) current = applyEvent(current, event);
  return current;
}

/**
 * The assistant's prose, in order.
 *
 * This is what a copy of the reply contains, and what the planner reads back.
 * Tool calls, reasoning and status lines are excluded on purpose: they are not
 * what the agent said.
 */
export function conversationText(items: ConversationItem[]): string {
  return items
    .filter((item): item is ConversationTextItem => item.kind === 'message')
    .map((item) => item.text)
    .join('');
}

/** The first request still waiting for an answer, if any. */
export function pendingRequest(
  items: ConversationItem[],
): { id: string; kind: 'question' | 'permission' } | undefined {
  const item = items.find(
    (entry): entry is ConversationQuestionItem | ConversationPermissionItem =>
      (entry.kind === 'question' || entry.kind === 'permission') && entry.status === 'pending',
  );
  return item ? { id: item.id, kind: item.kind } : undefined;
}
