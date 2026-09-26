// OpenCode / Kilo server-sent events -> protocol events.
//
// Two things differ from Claude's stream and both matter here:
//
//   1. Text and reasoning parts arrive as *cumulative snapshots*, not deltas.
//      This translator keeps the previous length per part and emits the slice
//      that is new, so the conversation sees ordinary deltas.
//   2. A tool part reports its whole lifecycle in `state`, including `output`.
//      That output is the bash stdout, and reading it is the difference between
//      an expandable command and a bare tool name.
import {
  createEventFactory,
  type AgentEvent,
  type AgentOption,
  type EventFactory,
  type FileChangeData,
  type TodoEntry,
} from './agentEvent.js';
import { blockText } from './claudeEvents.js';

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function errorMessage(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 3) return asText(value);
  const record = value as Record<string, unknown>;
  const data = record.data as Record<string, unknown> | undefined;
  return (
    asText(record.message) ??
    asText(data?.message) ??
    asText(record.error) ??
    errorMessage(data?.error, depth + 1)
  );
}

/** Tools whose arguments are a todo list, so a checklist can be rendered. */
const TODO_TOOLS = new Set(['todowrite', 'write_todos', 'todo_write', 'update_todo_list', 'todoread', 'todo']);

function todoItems(input: unknown): TodoEntry[] {
  if (!input || typeof input !== 'object') return [];
  const record = input as Record<string, unknown>;
  const raw = record.todos ?? record.items ?? record.list;
  if (!Array.isArray(raw)) return [];
  const items: TodoEntry[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry === 'string') {
      items.push({ id: String(index), content: entry, status: 'pending' });
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    const content = asText(item.content) ?? asText(item.text) ?? asText(item.title) ?? asText(item.task);
    if (!content) return;
    const status = String(item.status ?? 'pending');
    items.push({
      id: asText(item.id) ?? String(index),
      content,
      status:
        status === 'in_progress' || status === 'active' || status === 'running'
          ? 'in_progress'
          : status === 'completed' || status === 'done'
            ? 'completed'
            : status === 'cancelled' || status === 'deleted'
              ? 'cancelled'
              : 'pending',
      priority: asText(item.priority),
    });
  });
  return items;
}

function optionsFrom(value: unknown): AgentOption[] {
  if (!Array.isArray(value)) return [];
  const options: AgentOption[] = [];
  value.forEach((entry, index) => {
    if (typeof entry === 'string') {
      options.push({ id: entry, label: entry });
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    const record = entry as Record<string, unknown>;
    const label = asText(record.label) ?? asText(record.name) ?? asText(record.title) ?? asText(record.value);
    if (!label) return;
    options.push({ id: asText(record.id) ?? String(index), label, description: asText(record.description) });
  });
  return options;
}

function fileChangeFrom(entry: Record<string, unknown>): FileChangeData | undefined {
  const path = asText(entry.file) ?? asText(entry.path) ?? asText(entry.filename);
  if (!path) return undefined;
  const action = String(entry.action ?? entry.status ?? 'modified');
  const additions = typeof entry.additions === 'number' ? entry.additions : undefined;
  const deletions = typeof entry.deletions === 'number' ? entry.deletions : undefined;
  return {
    path,
    action: action === 'added' || action === 'created' ? 'created' : action === 'deleted' || action === 'removed' ? 'deleted' : 'modified',
    additions,
    deletions,
    patch: asText(entry.patch) ?? asText(entry.diff),
  };
}

export interface OpencodeTranslator {
  push(payload: Record<string, unknown>): AgentEvent[];
  finish(reason: 'idle' | 'result' | 'error' | 'aborted', error?: string): AgentEvent[];
}

export function createOpencodeTranslator(turnId: string, adapterId: string): OpencodeTranslator {
  const factory: EventFactory = createEventFactory(turnId, adapterId);
  /** Part id -> text already reported, so a snapshot yields only its new tail. */
  const seenText = new Map<string, string>();
  /**
   * Message id -> the role the server reported for it.
   *
   * OpenCode streams the conversation, not just the reply: the person's own
   * message is published as a text part alongside the agent's. Without this the
   * prompt came back as something the agent had said, so every turn repeated the
   * question inside its own answer.
   */
  const messageRoles = new Map<string, string>();
  let answered = false;

  /** True when a part is known to belong to the person rather than the agent. */
  function isUserPart(part: Record<string, unknown>): boolean {
    if (String(part.role ?? '') === 'user') return true;
    const messageId = asText(part.messageID) ?? asText(part.messageId);
    if (!messageId) return false;
    return messageRoles.get(messageId) === 'user';
  }

  /** Part id -> whether that part was the person's, so deltas can be filtered too. */
  const userParts = new Set<string>();

  function deltaFromSnapshot(partId: string, text: string): string {
    const previous = seenText.get(partId) ?? '';
    seenText.set(partId, text);
    if (!text) return '';
    // A snapshot that does not extend the previous one is a replacement, not an
    // append, so the whole new value is the delta.
    return text.startsWith(previous) ? text.slice(previous.length) : text;
  }

  function toolPhase(status: string): 'start' | 'update' | 'complete' {
    if (status === 'pending' || status === 'queued') return 'start';
    if (status === 'running' || status === 'in_progress') return 'update';
    return 'complete';
  }

  function partUpdated(part: Record<string, unknown>): AgentEvent[] {
    // The person's own words are already shown as their message, so echoing
    // them into the agent's turn only repeats the prompt.
    const partId = asText(part.id) ?? 'part';
    if (isUserPart(part)) {
      userParts.add(partId);
      return [];
    }

    const partType = String(part.type ?? '');

    if (partType === 'text') {
      const text = asText(part.text) ?? '';
      if (!text) return [];
      const delta = deltaFromSnapshot(partId, text);
      if (!delta) return [];
      return [factory.emit({ type: 'message', phase: 'delta', id: partId, data: { text: delta } })];
    }

    if (partType === 'reasoning') {
      const text = asText(part.text) ?? '';
      const delta = text ? deltaFromSnapshot(`reason:${partId}`, text) : '';
      if (!delta) return [];
      return [factory.emit({ type: 'thinking', phase: 'delta', id: partId, data: { text: delta } })];
    }

    if (partType === 'tool' || partType === 'tool-invocation' || partType === 'dynamic-tool') {
      const state = (part.state ?? {}) as Record<string, unknown>;
      const name = asText(part.tool) ?? asText(part.name) ?? 'tool';
      const status = String(state.status ?? 'pending');
      const phase = toolPhase(status);
      const input = state.input ?? part.input;
      const output = blockText(state.output ?? state.result ?? part.output);
      const error = errorMessage(state.error ?? part.error);
      const events: AgentEvent[] = [
        factory.emit({
          type: 'tool',
          phase,
          id: partId,
          data: {
            name,
            status,
            input,
            // An update carries output even while still running, because a tool
            // streams its result before it reports completion.
            output: output || undefined,
            error,
            title: asText(state.title) ?? asText(part.title),
            metadata: (state.metadata ?? part.metadata) as Record<string, unknown> | undefined,
          },
        }),
      ];

      if (TODO_TOOLS.has(name.toLowerCase())) {
        const items = todoItems(input);
        if (items.length > 0) {
          events.push(
            factory.emit({ type: 'todo', phase: phase === 'complete' ? 'complete' : 'update', id: 'todo', data: { items } }),
          );
        }
      }
      return events;
    }

    if (partType === 'skill') {
      const state = (part.state ?? {}) as Record<string, unknown>;
      const name = asText(part.name) ?? asText(part.skill) ?? asText(part.tool) ?? 'skill';
      const status = String(state.status ?? 'running');
      return [
        factory.emit({
          type: 'skill',
          phase: status === 'completed' || status === 'error' ? 'complete' : 'start',
          id: partId,
          data: {
            name,
            skillId: asText(part.skillID) ?? asText(part.skillId),
            detail: asText(state.detail) ?? asText(part.detail),
          },
        }),
      ];
    }

    // `step-start` and `step-finish` are the adapter's own progress markers.
    // They carry no content, and the turn's progress is already shown by the
    // message's status, so surfacing them only added "working" and
    // "step finished" lines between the agent's actual words.

    if (partType === 'patch' || partType === 'file') {
      const change = fileChangeFrom({ ...part, action: partType === 'patch' ? 'modified' : part.action });
      if (!change) return [];
      return [factory.emit({ type: 'file_change', phase: 'complete', id: `file:${change.path}`, data: change })];
    }

    if (partType === 'agent') {
      const name = asText(part.name) ?? asText(part.agent);
      if (!name) return [];
      const status = String((part.state as Record<string, unknown> | undefined)?.status ?? 'running');
      return [
        factory.emit({
          type: 'skill',
          phase: status === 'completed' ? 'complete' : 'start',
          id: partId,
          data: { name, detail: asText(part.description) },
        }),
      ];
    }

    return [];
  }

  function requestFrom(properties: Record<string, unknown>, kind: 'question' | 'permission'): AgentEvent[] {
    // The exact shape has moved between releases, so every field the payload
    // could plausibly use is read rather than one guessed key.
    const nested = (properties.question ?? properties.permission ?? properties.request) as Record<string, unknown> | undefined;
    const source = nested && typeof nested === 'object' ? { ...properties, ...nested } : properties;

    const requestId =
      asText(source.id) ?? asText(source.callID) ?? asText(source.permissionID) ?? asText(source.questionID) ?? 'request';
    const options = optionsFrom(source.options ?? source.choices);

    if (kind === 'question') {
      const question =
        asText(source.question) ??
        blockText(source.question) ??
        asText(source.message) ??
        blockText(source.parts) ??
        asText(source.prompt) ??
        asText(source.title) ??
        blockText(source.content);
      if (!question) return [];
      return [
        factory.emit({
          type: 'question',
          phase: 'start',
          id: `question:${requestId}`,
          data: { requestId, question, options, multiple: source.multiple === true },
        }),
      ];
    }

    const command = asText(source.command) ?? asText(source.cmd);
    const tool = asText(source.tool) ?? asText(source.toolName) ?? asText(source.title);
    const detail = errorMessage(source.error) ?? asText(source.reason) ?? asText(source.description);
    if (!command && !tool && !detail && !options.length) return [];
    return [
      factory.emit({
        type: 'permission',
        phase: 'start',
        id: `permission:${requestId}`,
        data: { requestId, tool, command: command ?? undefined, detail },
      }),
    ];
  }

  return {
    push(payload: Record<string, unknown>): AgentEvent[] {
      const type = String(payload.type ?? '');
      const properties = (payload.properties ?? {}) as Record<string, unknown>;

      if (type === 'message.part.delta') {
        const delta = (properties.delta ?? {}) as Record<string, unknown>;
        const partId = asText(properties.partID) ?? asText(properties.partId) ?? 'delta';
        // A part already identified as the person's stays out of the reply, on
        // the delta path as well as the snapshot path.
        if (userParts.has(partId)) return [];
        const text = asText(delta.text) ?? asText(delta.content);
        if (!text) return [];
        // A real delta is already incremental, so nothing is compared against
        // the snapshot buffer.
        return [factory.emit({ type: 'message', phase: 'delta', id: partId, data: { text } })];
      }

      if (type === 'message.part.updated' || type === 'message.part.completed') {
        const part = (properties.part ?? {}) as Record<string, unknown>;
        if (!Object.keys(part).length) return [];
        return partUpdated(part);
      }

      if (type === 'message.updated') {
        const info = (properties.info ?? {}) as Record<string, unknown>;
        // The role is recorded for every message, not just the agent's, because
        // knowing which message is the person's is what lets their own text be
        // left out of the reply.
        const messageId = asText(info.id);
        if (messageId) messageRoles.set(messageId, String(info.role ?? ''));
        if (String(info.role ?? '') !== 'assistant') return [];
        const time = (info.time ?? {}) as Record<string, unknown>;
        const failure = errorMessage(info.error);
        const events: AgentEvent[] = [
          factory.emit({
            type: 'turn',
            phase: 'start',
            id: 'turn',
            data: {
              agent: asText(info.agent),
              mode: asText(info.mode),
              provider: asText(info.providerID),
              model: asText(info.modelID),
            },
          }),
        ];
        if (failure) {
          events.push(factory.emit({ type: 'error', phase: 'complete', id: 'turn:error', data: { message: failure } }));
          events.push(
            factory.emit({ type: 'turn', phase: 'complete', id: 'turn', data: { reason: 'error', error: failure } }),
          );
          return events;
        }
        if (typeof time.completed === 'number' && !answered) {
          answered = true;
          events.push(
            factory.emit({ type: 'turn', phase: 'complete', id: 'turn', data: { reason: 'result' } }),
          );
        }
        return events;
      }

      if (type === 'session.idle') {
        return [factory.emit({ type: 'turn', phase: 'complete', id: 'turn', data: { reason: 'idle' } })];
      }

      if (type === 'session.status') {
        const status = (properties.status ?? {}) as Record<string, unknown>;
        const value = String(status.type ?? '');
        if (value === 'idle') {
          return [factory.emit({ type: 'turn', phase: 'complete', id: 'turn', data: { reason: 'idle' } })];
        }
        if (!value) return [];
        if (value === 'retry') {
          return [
            factory.emit({
              type: 'status',
              phase: 'update',
              id: 'status:retry',
              data: { label: 'retry', detail: asText(status.message) ?? 'provider unavailable' },
            }),
          ];
        }
        return [factory.emit({ type: 'status', phase: 'update', id: `status:${value}`, data: { label: value } })];
      }

      if (type === 'session.error') {
        const message = errorMessage(properties.error) ?? 'Adapter reported an error';
        return [
          factory.emit({ type: 'error', phase: 'complete', id: 'turn:error', data: { message, retryable: true } }),
          factory.emit({ type: 'turn', phase: 'complete', id: 'turn', data: { reason: 'error', error: message } }),
        ];
      }

      if (type === 'session.diff') {
        const files = Array.isArray(properties.files) ? properties.files : [];
        const events: AgentEvent[] = [];
        for (const file of files) {
          if (!file || typeof file !== 'object') continue;
          const change = fileChangeFrom(file as Record<string, unknown>);
          if (!change) continue;
          events.push(
            factory.emit({ type: 'file_change', phase: 'complete', id: `file:${change.path}`, data: change }),
          );
        }
        return events;
      }

      if (type === 'question.asked' || type === 'question.updated' || type === 'question') {
        return requestFrom(properties, 'question');
      }
      if (type === 'permission.updated' || type === 'permission.asked' || type === 'permission') {
        return requestFrom(properties, 'permission');
      }

      if (type === 'todo.updated') {
        const items = todoItems(properties);
        if (!items.length) return [];
        return [factory.emit({ type: 'todo', phase: 'update', id: 'todo', data: { items } })];
      }

      return [];
    },

    finish(reason, error): AgentEvent[] {
      seenText.clear();
      return [factory.emit({ type: 'turn', phase: 'complete', id: 'turn', data: { reason, error } })];
    },
  };
}
