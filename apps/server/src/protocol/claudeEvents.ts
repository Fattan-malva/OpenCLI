// Claude stream-json -> protocol events.
//
// Claude's JSONL carries everything the chat needs, including the tool result
// in a following `user` message. Reading only the assistant side is what made
// bash output disappear: a tool call arrived, its result never did.
//
// The translator is per-turn and keeps its own buffers, so two sessions parsing
// Claude at the same time cannot see each other's half-received JSON.
import {
  createEventFactory,
  type AgentEvent,
  type AgentOption,
  type EventFactory,
} from './agentEvent.js';
import { planFrom } from './planPayload.js';

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Renders a tool result payload, which is a string, a block list, or an object. */
export function blockText(value: unknown, depth = 0): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (depth > 4) return '';
  if (Array.isArray(value)) return value.map((entry) => blockText(entry, depth + 1)).join('');
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  for (const field of ['content', 'output', 'result', 'stdout', 'message']) {
    if (record[field] === undefined) continue;
    const found = blockText(record[field], depth + 1);
    if (found) return found;
  }
  return '';
}

function safeJson(raw: string): unknown {
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Options a control request offers, when it offers any. */
function optionsFrom(source: Record<string, unknown>): AgentOption[] {
  const raw = source.options ?? source.choices ?? source.suggestions;
  if (!Array.isArray(raw)) return [];
  const options: AgentOption[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry === 'string') {
      options.push({ id: entry, label: entry });
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    const record = entry as Record<string, unknown>;
    const label = asText(record.label) ?? asText(record.name) ?? asText(record.title) ?? asText(record.value);
    if (!label) return;
    options.push({
      id: asText(record.id) ?? String(index),
      label,
      description: asText(record.description),
    });
  });
  return options;
}

export interface ClaudeTranslator {
  /** Feeds one parsed JSONL record; returns the events it produced. */
  push(record: Record<string, unknown>): AgentEvent[];
  /** Called when a turn ends, to close anything left open. */
  finish(reason: 'idle' | 'result' | 'error' | 'aborted', error?: string): AgentEvent[];
}

export function createClaudeTranslator(turnId: string, adapterId: string): ClaudeTranslator {
  const factory: EventFactory = createEventFactory(turnId, adapterId);
  /** Content-block index -> the tool call it opened. */
  const blocks = new Map<number, { id: string; name: string }>();
  /** Content-block index -> tool arguments streamed as JSON fragments. */
  const inputJson = new Map<number, string>();
  /** Tool calls whose arguments have already been reported. */
  const reportedInput = new Set<string>();
  /**
   * Tool call id -> tool name.
   *
   * A `tool_result` names the call by id but never repeats the tool, and it
   * arrives after the content block that opened the call has closed. Without
   * this the completed item would be anonymous.
   */
  const names = new Map<string, string>();
  const openText = new Map<number, string>();
  const openThinking = new Set<number>();

  function toolInputEvent(index: number): AgentEvent[] {
    const block = blocks.get(index);
    if (!block || reportedInput.has(block.id)) return [];
    const raw = inputJson.get(index);
    if (raw === undefined) return [];
    // A fragment set that is not yet valid JSON is held back, so a half-received
    // argument object is never shown.
    const input = safeJson(raw);
    if (input === undefined) return [];
    reportedInput.add(block.id);
    return [
      factory.emit({
        type: 'tool',
        phase: 'update',
        id: block.id,
        data: { name: block.name, input, status: 'running' },
      }),
    ];
  }

  function controlRequest(record: Record<string, unknown>): AgentEvent[] {
    const request = (record.request ?? record) as Record<string, unknown>;
    const subtype = String(request.subtype ?? request.type ?? '');
    const requestId = asText(record.request_id) ?? asText(request.request_id) ?? asText(request.id) ?? 'control';
    const toolName = asText((request.tool_name as Record<string, unknown>)?.name) ?? asText(request.toolName) ?? asText(request.tool);
    const input = (request.input ?? request.toolInput ?? request.params) as Record<string, unknown> | undefined;
    const command = asText(input?.command) ?? asText(request.command);
    const options = optionsFrom(request);

    if (subtype === 'can_use_tool' || subtype === 'permission' || request.permissionDecision !== undefined) {
      return [
        factory.emit({
          type: 'permission',
          phase: 'start',
          id: `permission:${requestId}`,
          data: {
            requestId,
            tool: toolName,
            command: command ?? (options.length === 0 ? toolName : undefined),
            detail: asText(request.reason) ?? asText(request.explanation),
          },
        }),
      ];
    }

    const question = asText(request.question) ?? asText(request.message) ?? asText(request.prompt) ?? asText(request.title);
    if (!question) return [];
    return [
      factory.emit({
        type: 'question',
        phase: 'start',
        id: `question:${requestId}`,
        data: {
          requestId,
          question,
          options,
          multiple: request.multiSelect === true || request.multiple === true,
        },
      }),
    ];
  }

  function streamEvent(event: Record<string, unknown>): AgentEvent[] {
    const kind = String(event.type ?? '');

    if (kind === 'content_block_start') {
      const index = Number(event.index ?? 0);
      const block = (event.content_block ?? {}) as Record<string, unknown>;
      const blockType = String(block.type ?? '');

      if (blockType === 'tool_use') {
        const id = asText(block.id) ?? `tool:${index}`;
        const name = asText(block.name) ?? 'tool';
        blocks.set(index, { id, name });
        names.set(id, name);
        inputJson.delete(index);
        const input = block.input;
        // The arguments are usually empty here and stream afterwards; reporting
        // now is what used to print `read({})`.
        if (input && typeof input === 'object' && Object.keys(input as object).length > 0) {
          reportedInput.add(id);
          return [
            factory.emit({
              type: 'tool',
              phase: 'start',
              id,
              data: { name, input, status: 'running' },
            }),
          ];
        }
        return [
          factory.emit({
            type: 'tool',
            phase: 'start',
            id,
            data: { name, status: 'running' },
          }),
        ];
      }

      if (blockType === 'thinking' || blockType === 'redacted_thinking') {
        openThinking.add(index);
        return [factory.emit({ type: 'thinking', phase: 'start', id: `thinking:${index}`, data: { text: '' } })];
      }

      openText.set(index, asText(block.text) ?? '');
      return [factory.emit({ type: 'message', phase: 'start', id: `text:${index}`, data: { text: '' } })];
    }

    if (kind === 'content_block_delta') {
      const index = Number(event.index ?? 0);
      const delta = (event.delta ?? {}) as Record<string, unknown>;
      const deltaType = String(delta.type ?? '');

      if (deltaType === 'text_delta') {
        const text = asText(delta.text);
        if (!text) return [];
        return [factory.emit({ type: 'message', phase: 'delta', id: `text:${index}`, data: { text } })];
      }
      if (deltaType === 'thinking_delta') {
        const text = asText(delta.thinking);
        if (!text) return [];
        return [factory.emit({ type: 'thinking', phase: 'delta', id: `thinking:${index}`, data: { text } })];
      }
      if (deltaType === 'input_json_delta') {
        const fragment = asText(delta.partial_json);
        if (fragment) inputJson.set(index, (inputJson.get(index) ?? '') + fragment);
        return [];
      }
      return [];
    }

    if (kind === 'content_block_stop') {
      const index = Number(event.index ?? 0);
      const events: AgentEvent[] = [];

      if (openText.has(index)) {
        openText.delete(index);
        events.push(factory.emit({ type: 'message', phase: 'complete', id: `text:${index}`, data: { text: '' } }));
      }
      if (openThinking.has(index)) {
        openThinking.delete(index);
        events.push(factory.emit({ type: 'thinking', phase: 'complete', id: `thinking:${index}`, data: { text: '' } }));
      }
      if (blocks.has(index)) {
        events.push(...toolInputEvent(index));
        blocks.delete(index);
        inputJson.delete(index);
      }
      return events;
    }

    return [];
  }

  function assistantMessage(record: Record<string, unknown>): AgentEvent[] {
    const message = (record.message ?? {}) as Record<string, unknown>;
    const content = message.content;
    if (!Array.isArray(content)) {
      const text = blockText(content);
      return text
        ? [factory.emit({ type: 'message', phase: 'delta', id: 'text:assistant', data: { text } })]
        : [];
    }

    const events: AgentEvent[] = [];
    let text = '';
    let blockIndex = 0;
    for (const raw of content) {
      if (!raw || typeof raw !== 'object') continue;
      const block = raw as Record<string, unknown>;
      const blockType = String(block.type ?? '');
      const slot = blockIndex++;

      if (blockType === 'text') {
        text += asText(block.text) ?? '';
        continue;
      }
      if (blockType === 'tool_use') {
        const id = asText(block.id) ?? `tool:${slot}`;
        const name = asText(block.name) ?? 'tool';
        // A `tool_result` names the call by id but never repeats the tool name,
        // so it is remembered here to keep the completed item identifiable.
        names.set(id, name);
        const input = block.input;
        events.push(
          factory.emit({
            type: 'tool',
            phase: 'start',
            id,
            data: { name, input, status: 'running' },
          }),
        );
        if (input && typeof input === 'object' && Object.keys(input as object).length > 0) {
          events.push(
            factory.emit({
              type: 'tool',
              phase: 'update',
              id,
              data: { name, input, status: 'running' },
            }),
          );
        }
        continue;
      }
      if (blockType === 'thinking') {
        const thought = asText(block.thinking) ?? '';
        if (thought) events.push(factory.emit({ type: 'thinking', phase: 'delta', id: `thinking:${slot}`, data: { text: thought } }));
        continue;
      }
      if (blockType === 'redacted_thinking') {
        events.push(
          factory.emit({
            type: 'thinking',
            phase: 'delta',
            id: `thinking:redacted:${slot}`,
            data: { text: '' },
          }),
        );
      }
    }
    if (text) events.push(factory.emit({ type: 'message', phase: 'delta', id: 'text:assistant', data: { text } }));
    return events;
  }

  function userMessage(record: Record<string, unknown>): AgentEvent[] {
    const message = (record.message ?? {}) as Record<string, unknown>;
    const content = message.content;
    if (!Array.isArray(content)) return [];

      const events: AgentEvent[] = [];
      for (const raw of content) {
        if (!raw || typeof raw !== 'object') continue;
        const block = raw as Record<string, unknown>;
        if (String(block.type ?? '') !== 'tool_result') continue;
        const id = asText(block.tool_use_id) ?? asText(block.toolUseId);
        if (!id) continue;
        const failed = block.is_error === true;
        const output = blockText(block.content);
        events.push(
          factory.emit({
            type: 'tool',
            phase: 'complete',
            id,
            data: {
              name: names.get(id) ?? 'tool',
              status: failed ? 'error' : 'completed',
              output,
              error: failed ? output || 'The tool reported an error' : undefined,
            },
          }),
        );
        // Claude reports a plan in the tool result rather than in a part, so it
        // is recognised here for the same reason as on the other adapter.
        const plan = planFrom(block.content);
        if (plan) {
          events.push(
            factory.emit({ type: 'plan', phase: 'complete', id: 'plan', data: { steps: plan.steps, reason: plan.reason } }),
          );
        }
      }
      return events;
  }

  return {
    push(record: Record<string, unknown>): AgentEvent[] {
      const type = String(record.type ?? '');

      if (type === 'stream_event') {
        return streamEvent((record.event ?? {}) as Record<string, unknown>);
      }
      if (type === 'assistant') {
        return assistantMessage(record);
      }
      if (type === 'user') {
        return userMessage(record);
      }
      if (type === 'control_request') {
        return controlRequest(record);
      }
      if (type === 'control_response') {
        return [
          factory.emit({
            type: 'turn',
            phase: 'complete',
            id: 'turn',
            data: { reason: 'idle' },
          }),
        ];
      }
      if (type === 'result') {
        const text = asText(record.result);
        const isError = record.is_error === true;
        const events: AgentEvent[] = [];
        if (text) events.push(factory.emit({ type: 'message', phase: 'delta', id: 'text:result', data: { text } }));
        events.push(
          factory.emit({
            type: 'turn',
            phase: 'complete',
            id: 'turn',
            data: { reason: isError ? 'error' : 'result', error: isError ? text ?? 'The agent reported an error' : undefined },
          }),
        );
        return events;
      }
      return [];
    },

    finish(reason, error): AgentEvent[] {
      const events: AgentEvent[] = [];
      for (const index of openText.keys()) {
        events.push(factory.emit({ type: 'message', phase: 'complete', id: `text:${index}`, data: { text: '' } }));
      }
      for (const index of openThinking) {
        events.push(factory.emit({ type: 'thinking', phase: 'complete', id: `thinking:${index}`, data: { text: '' } }));
      }
      for (const index of blocks.keys()) {
        events.push(...toolInputEvent(index));
      }
      openText.clear();
      openThinking.clear();
      blocks.clear();
      inputJson.clear();
      events.push(factory.emit({ type: 'turn', phase: 'complete', id: 'turn', data: { reason, error } }));
      return events;
    },
  };
}
