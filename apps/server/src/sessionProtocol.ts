import type { ChatRequest } from '@opencli/domain';

export interface ProtocolActivity {
  kind: 'tool' | 'reasoning' | 'file' | 'status' | 'info';
  label: string;
  detail?: string;
  status?: string;
}

export interface ProtocolChunk {
  text?: string;
  tool?: string;
  request?: ChatRequest;
  done?: boolean;
  error?: string;
  activity?: ProtocolActivity;
}

export function createLineBuffer(): { push: (chunk: string) => string[] } {
  let buffer = '';
  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      return lines.map((line) => line.trim()).filter(Boolean);
    },
  };
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function oneLine(value: string, max = 240): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function summarize(value: unknown, max = 200): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return oneLine(value, max);
  try {
    return oneLine(JSON.stringify(value), max);
  } catch {
    return undefined;
  }
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content || undefined;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    const entry = block as Record<string, unknown>;
    if (entry.type === 'text') {
      const text = asText(entry.text);
      if (text) parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join('') : undefined;
}

function requestFromControlRequest(payload: Record<string, unknown>): ChatRequest | undefined {
  const request = (payload.request ?? payload) as Record<string, unknown>;
  const subtype = String(request.subtype ?? request.type ?? '');
  const toolName = asText((request.tool_name as Record<string, unknown>)?.name) ?? asText(request.toolName);
  const input = (request.input ?? request.toolInput) as Record<string, unknown> | undefined;
  const command = asText(input?.command) ?? asText(request.command) ?? toolName;

  if (subtype === 'can_use_tool' || subtype === 'permission' || request.permissionDecision) {
    return {
      type: 'permission',
      message: command ? `Allow ${toolName ?? 'tool'} to run?` : 'Permission requested by the agent.',
      command,
    };
  }
  return undefined;
}

/**
 * Tool arguments arrive as a stream of JSON fragments keyed by content block, so
 * they are accumulated here and reported once the block closes. Emitting the
 * tool at block start instead would always show `read({})`, because the input
 * is not populated until the fragments arrive.
 */
const toolInputBuffer = new Map<number, string>();
const toolNameBuffer = new Map<number, string>();

function parsePartialJson(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Only report once the fragment is valid JSON, so a half-arrived object is
  // never displayed as a broken argument list.
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return undefined;
  }
}

function parseClaude(payload: Record<string, unknown>): ProtocolChunk {
  const type = String(payload.type ?? '');

  if (type === 'stream_event') {
    const event = (payload.event ?? {}) as Record<string, unknown>;
    if (event.type === 'content_block_delta') {
      const delta = (event.delta ?? {}) as Record<string, unknown>;
      const text = asText(delta.text);
      if (text) return { text };
      const thinking = asText(delta.thinking);
      if (thinking) return { activity: { kind: 'reasoning', label: 'thinking', detail: oneLine(thinking) } };
      if (String(delta.type ?? '') === 'input_json_delta') {
        const index = Number(event.index ?? 0);
        const fragment = asText(delta.partial_json);
        if (fragment) toolInputBuffer.set(index, (toolInputBuffer.get(index) ?? '') + fragment);
      }
      return {};
    }
    if (event.type === 'content_block_stop') {
      const index = Number(event.index ?? 0);
      const label = toolNameBuffer.get(index);
      const raw = toolInputBuffer.get(index);
      toolNameBuffer.delete(index);
      toolInputBuffer.delete(index);
      if (!label) return {};
      // Fall back to the start-of-block input when no fragments were streamed.
      return { activity: { kind: 'tool', label, detail: parsePartialJson(raw ?? '') ?? '{}', status: 'started' } };
    }
    if (event.type === 'content_block_start') {
      const block = (event.content_block ?? {}) as Record<string, unknown>;
      if (block.type === 'tool_use') {
        const name = asText(block.name) ?? 'tool';
        // The input is usually empty at this point; it streams as
        // input_json_delta fragments and is reported at content_block_stop.
        toolNameBuffer.set(Number(event.index ?? 0), name);
        if (block.input && Object.keys(block.input as object).length > 0) {
          toolNameBuffer.delete(Number(event.index ?? 0));
          return { activity: { kind: 'tool', label: name, detail: summarize(block.input), status: 'started' } };
        }
        return {};
      }
      if (block.type === 'thinking') {
        return { activity: { kind: 'reasoning', label: 'thinking' } };
      }
    }
    return {};
  }

  if (type === 'assistant' || type === 'user') {
    const message = (payload.message ?? {}) as Record<string, unknown>;
    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const entry = block as Record<string, unknown>;
        if (entry.type === 'tool_use') {
          const activity: ProtocolActivity = {
            kind: 'tool',
            label: asText(entry.name) ?? 'tool',
            detail: summarize(entry.input),
            status: 'started',
          };
          const text = textFromContent(content);
          return text ? { text, activity } : { activity };
        }
        if (entry.type === 'thinking') {
          return { activity: { kind: 'reasoning', label: 'thinking', detail: oneLine(asText(entry.thinking) ?? '') } };
        }
      }
    }
    if (type === 'user') return {};
    const text = textFromContent(content);
    return text ? { text } : {};
  }

  if (type === 'control_request') {
    const request = requestFromControlRequest(payload);
    return request ? { request } : {};
  }
  if (type === 'control_response') return { done: true };

  if (type === 'result') {
    const text = asText(payload.result);
    return { text, done: true, error: payload.is_error === true ? text ?? 'Agent reported an error' : undefined };
  }

  return {};
}

export type OpencodeSignal =
  | {
      type: 'assistant-message';
      messageId: string;
      agent?: string;
      mode?: string;
      provider?: string;
      model?: string;
      completed?: boolean;
      error?: string;
    }
  | {
      type: 'part';
      partId: string;
      messageId: string;
      kind: 'text' | 'tool' | 'reasoning' | 'step' | 'file';
      text?: string;
      label?: string;
      detail?: string;
      status?: string;
      incremental?: boolean;
    }
  | { type: 'status'; value: string; detail?: string }
  | { type: 'error'; message: string }
  | { type: 'request'; request: ChatRequest }
  | { type: 'idle' };

function errorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return asText(value);
  const record = value as Record<string, unknown>;
  const data = record.data as Record<string, unknown> | undefined;
  return asText(record.message) ?? asText(data?.message) ?? asText(record.error);
}

export function parseOpencodeEvent(payload: Record<string, unknown>): OpencodeSignal[] {
  const type = String(payload.type ?? '');
  const properties = (payload.properties ?? {}) as Record<string, unknown>;
  const sessionId = asText(properties.sessionID);
  const signals: OpencodeSignal[] = [];

  if (type === 'message.updated') {
    const info = (properties.info ?? {}) as Record<string, unknown>;
    const infoId = asText(info.id);
    const role = String(info.role ?? '');
    if (infoId && role === 'assistant') {
      const time = (info.time ?? {}) as Record<string, unknown>;
      signals.push({
        type: 'assistant-message',
        messageId: infoId,
        agent: asText(info.agent),
        mode: asText(info.mode),
        provider: asText(info.providerID),
        model: asText(info.modelID),
        completed: typeof time.completed === 'number',
        error: errorMessage(info.error),
      });
    }
    return signals;
  }

  if (type === 'message.part.delta') {
    const delta = (properties.delta ?? {}) as Record<string, unknown>;
    const partId = asText(properties.partID) ?? asText(properties.partId) ?? 'delta';
    const messageId = asText(properties.messageID) ?? 'unknown';
    const text = asText(delta.text) ?? asText(delta.content);
    if (text) signals.push({ type: 'part', partId, messageId, kind: 'text', text, incremental: true });
    return signals;
  }

  if (type === 'message.part.updated') {
    const part = (properties.part ?? {}) as Record<string, unknown>;
    const partId = asText(part.id);
    const messageId = asText(part.messageID);
    if (!partId || !messageId) return signals;
    const partType = String(part.type ?? '');

    if (partType === 'text') {
      signals.push({ type: 'part', partId, messageId, kind: 'text', text: asText(part.text) });
    } else if (partType === 'reasoning') {
      signals.push({
        type: 'part',
        partId,
        messageId,
        kind: 'reasoning',
        text: asText(part.text),
        label: 'thinking',
      });
    } else if (partType === 'tool' || partType === 'tool-invocation') {
      const state = (part.state ?? {}) as Record<string, unknown>;
      signals.push({
        type: 'part',
        partId,
        messageId,
        kind: 'tool',
        label: asText(part.tool) ?? asText(part.name) ?? 'tool',
        detail: summarize(state.input ?? part.input),
        status: String(state.status ?? 'started'),
      });
    } else if (partType === 'step-start' || partType === 'step-finish') {
      signals.push({
        type: 'part',
        partId,
        messageId,
        kind: 'step',
        label: partType === 'step-start' ? 'working' : 'step finished',
        status: partType === 'step-start' ? 'busy' : 'idle',
      });
    } else if (partType === 'patch' || partType === 'file') {
      signals.push({
        type: 'part',
        partId,
        messageId,
        kind: 'file',
        label: asText(part.filename) ?? asText(part.path) ?? 'file',
        detail: summarize(part.text ?? part.patch),
        status: 'changed',
      });
    }
    return signals;
  }

  if (type === 'session.idle') {
    signals.push({ type: 'idle' });
    return signals;
  }

  if (type === 'session.status') {
    const status = (properties.status ?? {}) as Record<string, unknown>;
    const value = String(status.type ?? '');
    if (value === 'idle') signals.push({ type: 'idle' });
    else if (value === 'retry') {
      signals.push({ type: 'status', value, detail: oneLine(asText(status.message) ?? '', 200) });
    } else signals.push({ type: 'status', value });
    return signals;
  }

  if (type === 'session.error') {
    signals.push({ type: 'error', message: errorMessage(properties.error) ?? 'Adapter reported an error' });
    return signals;
  }

  if (type === 'session.diff') {
    const files = Array.isArray(properties.files) ? properties.files : [];
    for (const file of files) {
      const entry = (file ?? {}) as Record<string, unknown>;
      signals.push({
        type: 'part',
        partId: `diff:${asText(entry.file) ?? asText(entry.path) ?? 'file'}`,
        messageId: 'session',
        kind: 'file',
        label: asText(entry.file) ?? asText(entry.path) ?? 'file',
        status: 'changed',
      });
    }
    return signals;
  }

  if (type === 'permission.updated' || type === 'permission.asked' || type === 'question.asked') {
    const isQuestion = type === 'question.asked';
    const title = asText(properties.title) ?? asText(properties.tool) ?? asText(properties.command);
    const request: ChatRequest = isQuestion
      ? { type: 'question', message: asText(properties.message) ?? title ?? 'The agent is asking' }
      : { type: 'permission', message: title ?? 'Permission requested by the agent.', command: asText(properties.command) ?? title };
    signals.push({ type: 'request', request });
    return signals;
  }

  if (type === 'message.part.completed') {
    const part = (properties.part ?? {}) as Record<string, unknown>;
    if (String(part.type ?? '') === 'text' && asText(part.text)) {
      signals.push({
        type: 'part',
        partId: asText(part.id) ?? 'text',
        messageId: asText(part.messageID) ?? 'unknown',
        kind: 'text',
        text: asText(part.text),
      });
    }
  }

  if (sessionId) return signals;
  return signals;
}

function parsePlainJson(payload: Record<string, unknown>): ProtocolChunk {
  const text = asText(payload.text) ?? asText(payload.message) ?? textFromContent(payload.content);
  if (text) return { text };
  if (payload.type === 'done' || payload.done === true) return { done: true };
  if (payload.error) return { error: asText(payload.error) };
  return {};
}

export function parseSessionLine(line: string, adapterId: string): ProtocolChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      payload = undefined;
    }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      const chunk =
        adapterId === 'claude'
          ? parseClaude(record)
          : adapterId === 'opencode' || adapterId === 'kilocode'
            ? parsePlainJson(record)
            : parsePlainJson(record);
      if (chunk && Object.keys(chunk).length > 0) return chunk;
      return null;
    }
  }

  return { text: trimmed };
}

export function extractResponseText(value: unknown, depth = 0): string {
  if (depth > 6) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => extractResponseText(entry, depth + 1)).filter(Boolean).join('');
  }
  if (!value || typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  for (const field of ['text', 'content', 'parts', 'message', 'result', 'output']) {
    if (record[field] === undefined) continue;
    const found = extractResponseText(record[field], depth + 1);
    if (found) return found;
  }
  return '';
}
