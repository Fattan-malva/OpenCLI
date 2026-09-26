// Layer 1 of the chat pipeline: the adapter runtime.
//
// A CLI runs here for as long as its adapter is active, and every turn reuses
// that one process and one runtime session. Nothing in this file formats output
// for display: adapter output is translated into protocol events (see
// ./protocol) and handed to the turn, and the conversation decides what a user
// sees. Raw CLI bytes are the Terminal tab's business, not this file's.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { adapterCommand } from '@opencli/discovery';
import type { ChatRequest } from '@opencli/domain';
import { createLineBuffer, extractResponseText } from './sessionProtocol.js';
import { createClaudeTranslator, type ClaudeTranslator } from './protocol/claudeEvents.js';
import { createOpencodeTranslator, type OpencodeTranslator } from './protocol/opencodeEvents.js';
import type { AgentEvent } from './protocol/agentEvent.js';

export interface SessionState {
  projectId: string;
  adapterId: string;
  adapterName: string;
  pid: number | null;
  status: 'starting' | 'running' | 'exited' | 'failed';
  startedAt: string;
  endedAt?: string;
  command?: string;
  error?: string;
  serverUrl?: string;
  sessionId?: string;
  activeMode?: string;
  activeProvider?: string;
  activeModel?: string;
}

export interface TurnHandlers {
  onEvent?: (event: AgentEvent) => void;
  onRequest?: (request: ChatRequest) => void;
  onMeta?: (meta: { agent?: string; mode?: string; provider?: string; model?: string }) => void;
}

export interface TurnResult {
  ok: boolean;
  text: string;
  error?: string;
  timedOut?: boolean;
  meta?: { agent?: string; mode?: string; provider?: string; model?: string };
}

type Translator = ClaudeTranslator | OpencodeTranslator;

interface ActiveTurn {
  handlers: TurnHandlers;
  text: string;
  settled: boolean;
  settle: (result: TurnResult) => void;
  resetIdle?: () => void;
  /** The adapter's own assistant-message ids, to ignore other sessions' parts. */
  assistantIds: Set<string>;
  translator: Translator;
  /** Meta reported by the adapter for this turn, kept for the message badge. */
  meta: { agent?: string; mode?: string; provider?: string; model?: string };
  /**
   * A control request is outstanding, so the turn is waiting on the user and
   * must not be treated as stalled.
   */
  awaitingUser: boolean;
  /** True once a turn/complete event has been seen. */
  closing: boolean;
}

interface SessionEntry extends SessionState {
  child?: ChildProcess;
  lineBuffer: { push: (chunk: string) => string[] };
  queue: Promise<unknown>;
  turn?: ActiveTurn;
  eventStream?: AbortController;
  eventStreamReady?: Promise<boolean>;
  eventStreamConnected: boolean;
  /**
   * Agents the running server reported, cached for the life of the process.
   *
   * Discovering them spawns requests to the adapter, and doing that on every
   * chat message is what made the first token arrive late.
   */
  agentModes?: { at: number; modes: Array<{ id: string; name: string }> };
}

/** How long a discovered agent list stays fresh. */
const AGENT_MODES_TTL_MS = 60_000;

const SESSIONS = new Map<string, SessionEntry>();

function key(projectId: string, adapterId: string): string {
  return `${projectId}:${adapterId}`;
}

function createEntry(state: SessionState): SessionEntry {
  return {
    ...state,
    lineBuffer: createLineBuffer(),
    queue: Promise.resolve(),
    eventStreamConnected: false,
  };
}

function createTranslator(entry: SessionEntry, turnId: string): Translator {
  return entry.adapterId === 'claude'
    ? createClaudeTranslator(turnId, entry.adapterId)
    : createOpencodeTranslator(turnId, entry.adapterId);
}

/**
 * Applies one translated event to the turn.
 *
 * Terminal phases settle the turn; a control request parks it, because the
 * adapter is waiting for a person and an idle timeout would kill a turn that is
 * behaving correctly.
 */
function emitEvent(entry: SessionEntry, event: AgentEvent): void {
  const turn = entry.turn;
  if (!turn || turn.settled) return;

  turn.handlers.onEvent?.(event);

  if (event.type === 'turn' && event.phase === 'start') {
    const meta = {
      agent: event.data.agent ?? turn.meta.agent,
      mode: event.data.mode ?? turn.meta.mode,
      provider: event.data.provider ?? turn.meta.provider,
      model: event.data.model ?? turn.meta.model,
    };
    if (Object.entries(meta).some(([field, value]) => value && value !== turn.meta[field as keyof typeof turn.meta])) {
      turn.meta = meta;
      turn.handlers.onMeta?.(meta);
    }
    return;
  }

  if (event.type === 'message' && event.phase === 'delta') {
    turn.text += event.data.text;
  }

  if (event.type === 'question' || event.type === 'permission') {
    if (event.phase === 'start') {
      turn.awaitingUser = true;
      turn.handlers.onRequest?.({
        type: event.type,
        message: event.type === 'question' ? event.data.question : (event.data.detail ?? `Allow ${event.data.tool ?? 'the tool'} to run?`),
        command: event.type === 'permission' ? event.data.command : undefined,
        options: event.type === 'question' ? event.data.options.map((option) => option.label) : undefined,
        requestId: event.data.requestId,
      });
      // A parked turn is not idle: the person answering it is the activity.
      turn.resetIdle?.();
      return;
    }
    turn.awaitingUser = false;
    turn.resetIdle?.();
    return;
  }

  turn.resetIdle?.();

  if (event.type === 'turn' && event.phase === 'complete') {
    const reason = event.data.reason;
    if (reason === 'error') {
      settleTurn(entry, { ok: false, text: turn.text, error: event.data.error ?? 'The agent reported an error', meta: turn.meta });
      return;
    }
    if (reason === 'aborted') {
      settleTurn(entry, { ok: false, text: turn.text, error: event.data.error ?? 'Turn aborted', timedOut: true, meta: turn.meta });
      return;
    }
    settleTurn(entry, { ok: true, text: turn.text, meta: turn.meta });
  }
}

function settleTurn(entry: SessionEntry, result: TurnResult): void {
  const turn = entry.turn;
  if (!turn || turn.settled) return;
  entry.turn = undefined;
  turn.settle({ meta: turn.meta, ...result });
}

function waitForTurn(entry: SessionEntry, timeoutMs: number, idleMs: number): Promise<TurnResult> {
  return new Promise<TurnResult>((resolve) => {
    const turn = entry.turn;
    if (!turn) {
      resolve({ ok: false, text: '', error: 'Session turn was not initialised' });
      return;
    }

    let overallTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;

    const fail = (error: string) => {
      turn.settle({
        ok: false,
        text: turn.text,
        error: entry.eventStreamConnected ? error : `${error} (adapter event stream was not connected)`,
        timedOut: true,
      });
    };

    const finish = (result: TurnResult) => {
      if (overallTimer) clearTimeout(overallTimer);
      if (idleTimer) clearTimeout(idleTimer);
      turn.resetIdle = undefined;
      turn.settled = true;
      resolve(result);
    };

    turn.settle = finish;
    overallTimer = setTimeout(() => fail('Adapter did not finish its turn in time'), timeoutMs);
    idleTimer = setTimeout(() => fail('Adapter stopped responding'), idleMs);
    turn.resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fail('Adapter stopped responding'), idleMs);
    };
  });
}

/**
 * Reads one SSE block and feeds any event payloads to the turn.
 *
 * Events belonging to another runtime session are dropped here rather than
 * downstream: a server can host several sessions and only one of them is this
 * conversation's agent.
 */
function handleEventChunk(entry: SessionEntry, chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const raw = trimmed.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      payload = parsed as Record<string, unknown>;
    } catch {
      continue;
    }

    const properties = (payload.properties ?? {}) as Record<string, unknown>;
    if (entry.sessionId && properties.sessionID && properties.sessionID !== entry.sessionId) continue;

    for (const event of translate(entry, payload)) emitEvent(entry, event);
  }
}

function translate(entry: SessionEntry, payload: Record<string, unknown>): AgentEvent[] {
  const turn = entry.turn;
  if (!turn || turn.settled) return [];
  return turn.translator.push(payload);
}

function ensureEventStream(entry: SessionEntry): Promise<boolean> {
  if (!entry.serverUrl) return Promise.resolve(false);
  if (entry.eventStreamReady) return entry.eventStreamReady;

  const controller = new AbortController();
  entry.eventStream = controller;
  entry.eventStreamConnected = false;

  const ready = (async () => {
    try {
      const response = await fetch(`${entry.serverUrl}/event`, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return false;
      entry.eventStreamConnected = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) handleEventChunk(entry, block);
      }
      entry.eventStreamConnected = false;
      return true;
    } catch {
      entry.eventStreamConnected = false;
      return false;
    }
  })();

  entry.eventStreamReady = ready;
  return ready;
}

/**
 * Feeds a process's own stdout to the turn.
 *
 * Only JSONL records are read, and only by the adapter whose protocol defines
 * them. A serve adapter's stdout is its own logging — "listening on port…",
 * "session created" — and treating that as assistant text is what used to put
 * boot noise into the transcript. Raw bytes belong to the Terminal tab.
 *
 * stderr is not conversation content either, so it is logged and dropped.
 */
function deliverStdout(entry: SessionEntry, text: string): void {
  if (entry.adapterId !== 'claude') return;
  const turn = entry.turn;
  if (!turn || turn.settled) return;
  for (const line of entry.lineBuffer.push(text)) {
    const record = parseJsonRecord(line);
    if (!record) continue;
    for (const event of turn.translator.push(record)) emitEvent(entry, event);
    if (!entry.turn || entry.turn.settled) return;
  }
}

function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Feeds an HTTP response body to the turn.
 *
 * A prompt endpoint may answer with an event stream, newline-delimited events,
 * or a single JSON document. Only the first two are protocol; a plain JSON
 * document is a non-streaming answer, so its text is taken as the reply.
 */
function deliverResponse(entry: SessionEntry, text: string, mode: 'events' | 'text'): void {
  const turn = entry.turn;
  if (!turn || turn.settled) return;

  if (mode === 'text') {
    const record = parseJsonRecord(text.trim());
    if (record) {
      for (const event of turn.translator.push(record)) emitEvent(entry, event);
      return;
    }
    pushTurnText(entry, text);
    return;
  }

  for (const raw of splitEventLines(text)) {
    const record = parseJsonRecord(raw);
    if (!record) continue;
    for (const event of turn.translator.push(record)) emitEvent(entry, event);
    if (!entry.turn || entry.turn.settled) return;
  }
}

function splitEventLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== 'data: [DONE]' && line !== '[DONE]')
    .map((line) => (line.startsWith('data:') ? line.slice(5).trim() : line));
}

/**
 * Appends plain text to the current turn.
 *
 * The text is delivered as an ordinary message event rather than side-channel,
 * so there is exactly one path by which anything reaches the conversation.
 */
function pushTurnText(entry: SessionEntry, text: string): void {
  const turn = entry.turn;
  if (!turn || turn.settled || !text) return;
  emitEvent(entry, {
    type: 'message',
    phase: 'delta',
    id: 'text:response',
    seq: 0,
    turnId: '',
    adapterId: entry.adapterId,
    timestamp: Date.now(),
    data: { text },
  });
}

interface PromptTarget {
  path: string;
  body: (text: string, overrides: PromptOverrides) => Record<string, unknown>;
}

export interface PromptOverrides {
  mode?: string;
  model?: { provider: string; model: string; spec?: string };
}

function promptBody(text: string, overrides: PromptOverrides): Record<string, unknown> {
  const body: Record<string, unknown> = { parts: [{ type: 'text', text }] };
  if (overrides.mode) body.agent = overrides.mode;
  if (overrides.model?.provider && overrides.model.model) {
    // Both runtimes express a model as `provider/model` and split on the FIRST
    // slash: `kilo/kilo-auto/free` is provider `kilo`, model `kilo-auto/free`.
    // Splitting on the last slash instead yields `kilo/kilo-auto` + `free`,
    // which the CLI rejects with "Model not found".
    const spec = overrides.model.spec ?? `${overrides.model.provider}/${overrides.model.model}`;
    const cut = spec.indexOf('/');
    const providerID = cut > 0 ? spec.slice(0, cut) : spec;
    const modelID = cut > 0 ? spec.slice(cut + 1) : spec;
    body.model = { providerID, modelID, id: modelID };
  }
  return body;
}

function promptTargets(sessionId: string): PromptTarget[] {
  const encoded = encodeURIComponent(sessionId);
  return [
    { path: `/session/${encoded}/prompt_async`, body: promptBody },
    { path: `/session/${encoded}/message`, body: promptBody },
    {
      path: `/api/session/${encoded}/prompt`,
      body: (text, overrides) => ({ prompt: promptBody(text, overrides) }),
    },
  ];
}

/**
 * Pumps a prompt response body into the turn.
 *
 * The event stream that carries the turn is already open, so this body is only
 * read for the case where the endpoint answers inline. It still runs through
 * the translator, because a non-streaming endpoint replies with the same
 * protocol events, just all at once.
 */
async function pumpResponseStream(entry: SessionEntry, response: Response): Promise<void> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const record = parseJsonRecord(line);
        if (!record) continue;
        for (const event of translate(entry, record)) emitEvent(entry, event);
        if (!entry.turn || entry.turn.settled) {
          await reader.cancel().catch(() => undefined);
          return;
        }
      }
    }
  } catch {
    return;
  }
}

async function sendRemoteMessage(
  entry: SessionEntry,
  text: string,
  overrides: PromptOverrides,
): Promise<'streamed' | 'accepted' | 'failed'> {
  if (!entry.serverUrl || !entry.sessionId) return 'failed';

  const ready = ensureEventStream(entry);
  await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 5000))]);

  for (const target of promptTargets(entry.sessionId)) {
    try {
      const response = await fetch(`${entry.serverUrl}${target.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(target.body(text, overrides)),
      });

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      const isHtml = contentType.includes('text/html');
      if (!response.ok || isHtml) continue;

      if (contentType.includes('text/event-stream') || contentType.includes('ndjson')) {
        void pumpResponseStream(entry, response);
        return 'streamed';
      }

      if (response.status === 204) return 'accepted';

      const raw = await response.text();
      const trimmed = raw.trim();
      if (!trimmed) return 'accepted';

      let extracted = '';
      try {
        extracted = extractResponseText(JSON.parse(trimmed));
      } catch {
        extracted = '';
      }
      if (extracted) {
        pushTurnText(entry, extracted);
        settleTurn(entry, { ok: true, text: entry.turn?.text ?? extracted });
        return 'accepted';
      }

      return 'accepted';
    } catch {
      continue;
    }
  }

  return 'failed';
}

/**
 * Answers a pending control request on the turn that is already running.
 *
 * This is the difference between a control channel and a chat message. The
 * agent asked a question and stopped; its answer is delivered into the *same*
 * turn, which then continues and settles on its own completion event. Creating a
 * new turn instead makes the answer look like a fresh request to the agent, and
 * leaves the original turn parked forever.
 *
 * The text is the adapter's own answer vocabulary, so an adapter that expects a
 * specific token gets it; nothing is invented per request here.
 */
export async function sendAnswerToRequest(
  projectId: string,
  adapterId: string,
  answer: string,
): Promise<boolean> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry || !alive(entry)) return false;

  const turn = entry.turn;
  if (!turn || turn.settled) {
    // The turn already finished, so there is nothing left to answer. Saying so
    // is better than delivering text to a session that will treat it as a new
    // prompt.
    return false;
  }

  // Answering releases the turn, so its idle timer must not race the answer.
  turn.awaitingUser = false;
  turn.resetIdle?.();

  if (SERVE_ADAPTERS.has(adapterId) && entry.serverUrl && entry.sessionId) {
    const delivery = await sendRemoteMessage(entry, answer, {
      mode: entry.activeMode,
      model:
        entry.activeProvider && entry.activeModel
          ? { provider: entry.activeProvider, model: entry.activeModel }
          : undefined,
    });
    if (delivery !== 'failed') return true;
  }
  return writeStdinMessage(entry, answer);
}

/** True when a turn is parked on a person rather than working. */
export function isSessionAwaitingUser(projectId: string, adapterId: string): boolean {
  const entry = SESSIONS.get(key(projectId, adapterId));
  return Boolean(entry?.turn && !entry.turn.settled && entry.turn.awaitingUser);
}

/** True when a turn is running, whether it is working or waiting on a person. */
export function isSessionBusy(projectId: string, adapterId: string): boolean {
  const entry = SESSIONS.get(key(projectId, adapterId));
  return Boolean(entry?.turn && !entry.turn.settled);
}

export async function abortSessionTurn(projectId: string, adapterId: string): Promise<boolean> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry) return false;

  if (entry.serverUrl && entry.sessionId) {
    const encoded = encodeURIComponent(entry.sessionId);
    for (const path of [`/session/${encoded}/abort`, `/api/session/${encoded}/interrupt`]) {
      try {
        const response = await fetch(`${entry.serverUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        });
        if (response.ok) {
          settleTurn(entry, { ok: false, text: entry.turn?.text ?? '', error: 'Turn aborted', timedOut: true });
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  settleTurn(entry, { ok: false, text: entry.turn?.text ?? '', error: 'Turn interrupted', timedOut: true });
  return false;
}

function writeStdinMessage(entry: SessionEntry, text: string): boolean {
  const child = entry.child;
  if (!child?.stdin) return false;
  try {
    if (entry.adapterId === 'claude') {
      child.stdin.write(
        `${JSON.stringify({
          type: 'user',
          message: { role: 'user', content: text },
          parent_tool_use_id: null,
          session_id: entry.sessionId ?? undefined,
        })}\n`,
      );
    } else {
      child.stdin.write(`${text}\n`);
    }
    return true;
  } catch {
    return false;
  }
}

let turnCounter = 0;

function performTurn(
  entry: SessionEntry,
  text: string,
  handlers: TurnHandlers,
  timeoutMs: number,
  idleMs: number,
  overrides: PromptOverrides,
): Promise<TurnResult> {
  turnCounter += 1;
  const turnId = `${entry.adapterId}:${turnCounter}`;

  entry.turn = {
    handlers,
    text: '',
    settled: false,
    settle: () => undefined,
    assistantIds: new Set(),
    translator: createTranslator(entry, turnId),
    meta: { mode: overrides.mode },
    awaitingUser: false,
    closing: false,
  };
  const result = waitForTurn(entry, timeoutMs, idleMs);

  const dispatch = async () => {
    if (SERVE_ADAPTERS.has(entry.adapterId)) {
      const delivery = await sendRemoteMessage(entry, text, overrides);
      if (delivery === 'failed' && !writeStdinMessage(entry, text)) {
        settleTurn(entry, { ok: false, text: '', error: 'Could not deliver the message to this adapter session' });
      }
      return;
    }
    if (!writeStdinMessage(entry, text)) {
      settleTurn(entry, { ok: false, text: '', error: 'Process stdin unavailable' });
    }
  };

  void dispatch();
  return result;
}

export async function talkToSession(opts: {
  projectId: string;
  adapterId: string;
  text: string;
  timeoutMs?: number;
  idleMs?: number;
  mode?: string;
  model?: { provider: string; model: string };
  handlers?: TurnHandlers;
}): Promise<TurnResult> {
  const {
    projectId,
    adapterId,
    text,
    timeoutMs = 600_000,
    idleMs = 90_000,
    mode,
    model,
    handlers = {},
  } = opts;
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry) return { ok: false, text: '', error: `${adapterId} session does not exist` };
  if (!alive(entry)) return { ok: false, text: '', error: `${adapterId} session is not running` };

  const overrides: PromptOverrides = {
    mode: mode ?? entry.activeMode,
    model: model ?? (entry.activeProvider && entry.activeModel
      ? { provider: entry.activeProvider, model: entry.activeModel }
      : undefined),
  };

  const run = entry.queue.then(
    () => performTurn(entry, text, handlers, timeoutMs, idleMs, overrides),
    () => performTurn(entry, text, handlers, timeoutMs, idleMs, overrides),
  );
  entry.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const SERVE_ADAPTERS = new Set(['opencode', 'kilocode']);

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function serveArgs(adapterId: string, port: number): string[] | undefined {
  if (!SERVE_ADAPTERS.has(adapterId)) return undefined;
  return ['serve', '--port', String(port), '--hostname', '127.0.0.1'];
}

async function requestJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  let data: any = undefined;
  try {
    data = await response.json();
  } catch {
    // Some successful endpoints intentionally return no JSON body.
  }
  return { ok: response.ok, status: response.status, data };
}

async function listRemoteAgents(baseUrl: string): Promise<Array<{ id: string; name: string; mode: string; hidden?: boolean }>> {
  for (const path of ['/api/agent', '/agent']) {
    try {
      const response = await requestJson(baseUrl + path, {}, 5000);
      if (!response.ok) continue;
      const raw = response.data?.data ?? response.data;
      if (!Array.isArray(raw)) continue;
      return raw
        .filter((agent: any) => agent && typeof agent.name === 'string')
        .map((agent: any) => ({
          id: String(agent.id ?? agent.name),
          name: String(agent.name),
          mode: String(agent.mode ?? 'all'),
          hidden: Boolean(agent.hidden),
        }));
    } catch {
      // Try the compatibility endpoint below.
    }
  }
  return [];
}

async function remoteConfigModel(baseUrl: string): Promise<{ provider: string; model: string; spec: string } | undefined> {
  for (const path of ['/api/config', '/config', '/global/config', '/api/global/config']) {
    try {
      const response = await requestJson(baseUrl + path, {}, 5000);
      if (!response.ok) continue;
      const raw = response.data?.data ?? response.data;
      const spec = typeof raw?.model === 'string' ? raw.model.trim() : '';
      // Keep the spec whole. Splitting it here and rejoining it later is how
      // prefixes get lost, and the CLI then reports "Model not found".
      if (spec) {
        const index = spec.indexOf('/');
        return {
          provider: index > 0 ? spec.slice(0, index) : spec,
          model: index > 0 ? spec.slice(index + 1) : spec,
          spec,
        };
      }
    } catch {
      // Try the next compatibility endpoint.
    }
  }
  return undefined;
}

async function waitForServer(baseUrl: string, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const path of ['/global/health', '/api/global/health']) {
      try {
        const res = await requestJson(`${baseUrl}${path}`, {}, 1500);
        if (res.ok) return;
      } catch {
        // Server is still booting.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Adapter server did not become ready at ${baseUrl}`);
}

async function createRemoteSession(entry: SessionEntry): Promise<void> {
  if (!entry.serverUrl || !SERVE_ADAPTERS.has(entry.adapterId)) return;

  await waitForServer(entry.serverUrl);

  // Read runtime agents from the running server instead of parsing CLI text.
  // This keeps project-local Plan/Build/custom agents aligned with reality.
  const agents = await listRemoteAgents(entry.serverUrl);
  // Never hardcode agent names. The adapter is the source of truth.
  // OpenCLI only considers visible primary-capable agents.
  const selectable = agents.filter(
    (agent) => !agent.hidden && (agent.mode === 'primary' || agent.mode === 'all'),
  );
  const activeAgent = selectable[0];

  // Pin the configured model when the server exposes one so a headless
  // session does not silently resolve to an unrelated catalog default.
  const configuredModel = await remoteConfigModel(entry.serverUrl);

  const body: Record<string, unknown> = {};
  if (activeAgent) body.agent = activeAgent.id;
  if (configuredModel) {
    // Split on the first slash: the runtimes define a model as
    // `provider/model`, so `kilo/kilo-auto/free` is provider `kilo` plus model
    // `kilo-auto/free`.
    const spec = configuredModel.spec;
    const cut = spec.indexOf('/');
    const providerID = cut > 0 ? spec.slice(0, cut) : spec;
    const modelID = cut > 0 ? spec.slice(cut + 1) : spec;
    body.model = { providerID, id: modelID, modelID };
  }

  let created: any;
  for (const endpoint of ['/api/session', '/session']) {
    try {
      const response = await requestJson(`${entry.serverUrl}${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (response.ok) {
        created = response.data;
        break;
      }
    } catch {
      // Try the compatibility endpoint below.
    }
  }

  const session = created?.data ?? created;
  const sessionId = session?.id;
  if (!sessionId) {
    throw new Error(`Failed to create ${entry.adapterId} runtime session`);
  }

  entry.sessionId = String(sessionId);
  entry.activeMode = activeAgent?.id;
  entry.activeProvider = configuredModel?.provider;
  entry.activeModel = configuredModel?.model;
}

async function postSessionRuntime(
  entry: SessionEntry,
  path: 'agent' | 'model',
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (!entry.serverUrl || !entry.sessionId) return { ok: false, error: 'Runtime session is not ready' };

  const endpoints = [`/api/session/${encodeURIComponent(entry.sessionId)}/${path}`, `/session/${encodeURIComponent(entry.sessionId)}/${path}`];
  let lastError = 'Runtime session endpoint unavailable';
  for (const endpoint of endpoints) {
    try {
      const response = await requestJson(`${entry.serverUrl}${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (response.ok) return { ok: true };
      lastError = `${response.status}: ${response.data?.message ?? response.data?.error ?? 'request failed'}`;
    } catch (error: any) {
      lastError = error?.message ?? lastError;
    }
  }
  return { ok: false, error: lastError };
}

function migrateInvalidOpenCodeConfig(adapterId: string): void {
  if (adapterId !== 'opencode') return;

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (!home) return;

  const configPath = home + '\\.config\\opencode\\opencode.json';
  if (!existsSync(configPath)) return;

  try {
    const raw = readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;

    // Older OpenCLI builds incorrectly wrote {"mode":"plan"}.
    // OpenCode expects "default_agent" at the top level; "mode" belongs
    // inside an agent definition. Repair only this legacy field.
    if (typeof config.mode !== 'string') return;

    const backupPath = configPath + '.opencli-backup';
    if (!existsSync(backupPath)) copyFileSync(configPath, backupPath);

    const legacyMode = config.mode;
    delete config.mode;
    if (typeof config.default_agent !== 'string' && legacyMode.trim()) {
      config.default_agent = legacyMode;
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    console.warn('[opencode] Repaired legacy invalid config field "mode". Mapped it to "default_agent" and backed up the original at ' + backupPath);
  } catch (error: any) {
    console.warn('[opencode] Could not repair legacy config:', error?.message ?? error);
  }
}

function claudeArgs(): string[] {
  return ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
}

export function listSessions(projectId: string): SessionState[] {
  const out: SessionState[] = [];
  for (const entry of SESSIONS.values()) {
    if (entry.projectId !== projectId) continue;
    out.push(publicState(entry));
  }
  return out;
}

export function getSession(projectId: string, adapterId: string): SessionState | undefined {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry) return undefined;
  return publicState(entry);
}

function publicState(entry: SessionEntry): SessionState {
  const { child, lineBuffer, queue, turn, eventStream, eventStreamReady, eventStreamConnected, agentModes, ...state } = entry;
  return { ...state, status: resolveStatus(entry) };
}

function processAlive(entry: SessionEntry): boolean {
  if (!entry.child) return false;
  return entry.child.exitCode === null && entry.child.signalCode === null;
}

function alive(entry: SessionEntry): boolean {
  return entry.status === 'running' && processAlive(entry);
}

function inProgress(entry: SessionEntry): boolean {
  return (entry.status === 'starting' || entry.status === 'running') && processAlive(entry);
}

function resolveStatus(entry: SessionEntry): SessionState['status'] {
  if (entry.status === 'failed') return 'failed';
  if (!processAlive(entry)) return 'exited';
  return entry.status === 'starting' ? 'starting' : 'running';
}

export async function startSession(opts: {
  projectId: string;
  adapterId: string;
  adapterName: string;
  projectPath: string;
}): Promise<SessionState> {
  const { projectId, adapterId, adapterName, projectPath } = opts;
  const existing = SESSIONS.get(key(projectId, adapterId));
  if (existing && inProgress(existing)) {
    return publicState(existing);
  }

  if (!existsSync(projectPath)) {
    const error = `Project folder not found: ${projectPath}`;
    const state: SessionState = {
      projectId,
      adapterId,
      adapterName,
      pid: null,
      status: 'failed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      error,
    };
    const entry = createEntry(state);
    SESSIONS.set(key(projectId, adapterId), entry);
    console.error(`[${adapterId}] ${error}`);
    return state;
  }

  const cmd = adapterCommand(adapterId);
  if (adapterId === 'opencode') {
    migrateInvalidOpenCodeConfig(adapterId);
  }
  if (!cmd) {
    const state: SessionState = {
      projectId,
      adapterId,
      adapterName,
      pid: null,
      status: 'failed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      error: `Unknown adapter: ${adapterId}`,
    };
    SESSIONS.set(key(projectId, adapterId), createEntry(state));
    return state;
  }

  const port = SERVE_ADAPTERS.has(adapterId) ? await getFreePort() : undefined;
  const args = adapterId === 'claude' ? claudeArgs() : (port ? serveArgs(adapterId, port) ?? [] : []);
  const now = new Date().toISOString();
  const commandLine = `${cmd} ${args.join(' ')}`.trim();

  const state: SessionEntry = createEntry({
    projectId,
    adapterId,
    adapterName,
    pid: null,
    status: 'starting',
    startedAt: now,
    command: commandLine,
    serverUrl: port ? `http://127.0.0.1:${port}` : undefined,
  });

  const child = spawn(cmd, args, {
    cwd: projectPath,
    detached: false,
    windowsHide: true,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(process.platform !== 'win32' ? { TERM: 'dumb' } : {}),
    },
  });

  state.child = child;
  state.pid = child.pid ?? null;
  // Serve-based adapters are only truly active after their HTTP runtime
  // and remote session are ready. Keep the UI in a real loading state until then.
  if (state.pid && !SERVE_ADAPTERS.has(adapterId)) state.status = 'running';
  SESSIONS.set(key(projectId, adapterId), state);

  // Attach lifecycle listeners immediately after spawn. OpenCode may exit
  // before its HTTP control plane finishes initializing, and we must not miss
  // that transition or leave the session stuck in "running".
  child.stdout?.on('data', (data) => {
    const text = data.toString();
    console.log(`[${adapterId}] stdout:`, text);
    deliverStdout(state, text);
  });

  // stderr is diagnostics, not conversation. It was previously injected into
  // the reply, so a deprecation warning became something the agent "said".
  child.stderr?.on('data', (data) => {
    console.log(`[${adapterId}] stderr:`, data.toString());
  });

  child.on('exit', (code) => {
    console.log(`[${adapterId}] Process exited with code:`, code);
    const current = SESSIONS.get(key(projectId, adapterId));
    if (current) {
      current.status = code === 0 ? 'exited' : 'failed';
      current.endedAt = new Date().toISOString();
      current.child = undefined;
      current.eventStream?.abort();
      current.eventStream = undefined;
      current.eventStreamReady = undefined;
      current.eventStreamConnected = false;
      settleTurn(current, { ok: false, text: current.turn?.text ?? '', error: 'Adapter session stopped before finishing its turn' });
    }
  });

  child.on('error', (err) => {
    console.error(`[${adapterId}] Process error:`, err);
    const current = SESSIONS.get(key(projectId, adapterId));
    if (current) {
      current.status = 'failed';
      current.endedAt = new Date().toISOString();
      current.error = err.message;
      current.child = undefined;
      settleTurn(current, { ok: false, text: current.turn?.text ?? '', error: err.message });
    }
  });

  try {
    await createRemoteSession(state);
    if (processAlive(state)) state.status = 'running';
  } catch (error: any) {
    state.status = 'failed';
    state.endedAt = new Date().toISOString();
    state.error = error?.message ?? 'Failed to initialize runtime session';
    console.warn(`[${adapterId}] Runtime session initialization failed:`, state.error);
  }

  return publicState(state);
}

export async function stopSession(projectId: string, adapterId: string): Promise<boolean> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry || !entry.child || !entry.child.pid) return false;

  const pid = entry.child.pid;
  console.log(`[${adapterId}] Stopping process with PID: ${pid}`);

  try {
    if (process.platform === 'win32') {
      await new Promise<void>((res) => {
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, (err) => {
          if (err) console.error(`[${adapterId}] Failed to kill process:`, err);
          res();
        });
      });
    } else {
      entry.child.kill('SIGTERM');
    }
    console.log(`[${adapterId}] Process stopped successfully`);
  } catch (err) {
    console.error(`[${adapterId}] Error stopping process:`, err);
  }

  entry.status = 'exited';
  entry.endedAt = new Date().toISOString();
  entry.child = undefined;
  entry.eventStream?.abort();
  entry.eventStream = undefined;
  entry.eventStreamReady = undefined;
  entry.eventStreamConnected = false;
  settleTurn(entry, { ok: false, text: entry.turn?.text ?? '', error: 'Adapter session stopped', timedOut: true });
  return true;
}

export async function stopAll(projectId: string): Promise<void> {
  const entries = Array.from(SESSIONS.entries()).filter(([, entry]) => entry.projectId === projectId);
  for (const [key, entry] of entries) {
    if (entry.child?.pid) {
      try {
        if (process.platform === 'win32') {
          await new Promise<void>((resolve) => {
            execFile('taskkill', ['/pid', String(entry.child!.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
          });
        } else {
          entry.child.kill('SIGTERM');
        }
      } catch {
        // Ignore processes that already exited.
      }
    }
    entry.status = 'exited';
    entry.endedAt = new Date().toISOString();
    entry.child = undefined;
    entry.eventStream?.abort();
    entry.eventStream = undefined;
  entry.eventStreamReady = undefined;
  entry.eventStreamConnected = false;
    settleTurn(entry, { ok: false, text: entry.turn?.text ?? '', error: 'Adapter session stopped', timedOut: true });
    SESSIONS.delete(key);
  }
}

/**
 * Primary agents the running server offers, cached per session.
 *
 * This is asked for on the way into every chat message, and the answer only
 * changes when the project does. Asking the server each time added a round trip
 * before the prompt was even sent, which is what made the first reply arrive
 * late. `force` bypasses the cache for an explicit refresh.
 */
export async function getSessionAgentModes(
  projectId: string,
  adapterId: string,
  force = false,
): Promise<Array<{ id: string; name: string }>> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry?.serverUrl || !SERVE_ADAPTERS.has(adapterId)) return [];

  const cached = entry.agentModes;
  if (!force && cached && Date.now() - cached.at < AGENT_MODES_TTL_MS) return cached.modes;

  const agents = await listRemoteAgents(entry.serverUrl);
  const modes = agents
    .filter((agent) => !agent.hidden && (agent.mode === 'primary' || agent.mode === 'all'))
    .map((agent) => ({ id: agent.id, name: agent.name }));
  entry.agentModes = { at: Date.now(), modes };
  return modes;
}

export async function setSessionMode(
  projectId: string,
  adapterId: string,
  mode: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry || !alive(entry)) return { ok: false, error: 'Session not running' };

  if (SERVE_ADAPTERS.has(adapterId)) {
    const remote = await postSessionRuntime(entry, 'agent', { agent: mode });
    if (remote.ok) {
      entry.activeMode = mode;
      return { ok: true, output: `Session agent switched to ${mode}` };
    }
    // Fall back to the same slash command the CLI TUI understands.
  }

  if (!entry.child?.stdin) return { ok: false, error: 'Process stdin unavailable' };
  try {
    if (adapterId === 'claude') {
      entry.child.stdin.write(JSON.stringify({ type: 'mode', mode }) + '\\n');
    } else {
      entry.child.stdin.write(`/mode ${mode}\\n`);
    }
    entry.activeMode = mode;
    return { ok: true, output: `Sent mode switch to ${mode}` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to switch session mode' };
  }
}

export async function setSessionModel(
  projectId: string,
  adapterId: string,
  provider: string,
  model: string,
  spec?: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry || !alive(entry)) return { ok: false, error: 'Session not running' };

  // Prefer the exact spec the CLI published. Rebuilding `provider/model` drops
  // prefixes the CLI requires and it answers "model not found".
  const target = spec ?? `${provider}/${model}`;

  if (SERVE_ADAPTERS.has(adapterId)) {
    const remote = await postSessionRuntime(entry, 'model', { model: target });
    if (remote.ok) {
      entry.activeProvider = provider;
      entry.activeModel = model;
      return { ok: true, output: `Session model switched to ${target}` };
    }
  }

  if (!entry.child?.stdin) return { ok: false, error: 'Process stdin unavailable' };
  try {
    if (adapterId === 'claude') {
      entry.child.stdin.write(JSON.stringify({ type: 'config', model: target }) + '\n');
    } else {
      entry.child.stdin.write(`/models ${target}\n`);
    }
    entry.activeProvider = provider;
    entry.activeModel = model;
    return { ok: true, output: `Sent model switch to ${target}` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to switch session model' };
  }
}

export async function sendRuntimeCommand(
  projectId: string,
  adapterId: string,
  command: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const entry = SESSIONS.get(key(projectId, adapterId));
  if (!entry || !entry.child || !alive(entry)) {
    return { ok: false, error: 'Session not running' };
  }

  const child = entry.child;
  if (!child.stdin) {
    return { ok: false, error: 'Process stdin unavailable' };
  }

  try {
    if (adapterId === 'claude') {
      const payload = {
        type: 'user',
        message: command,
        parent_tool_use_id: null,
      };
      child.stdin.write(JSON.stringify(payload) + '\n');
      return { ok: true, output: 'Sent to Claude stdin' };
    }

    child.stdin.write(command + '\n');
    return { ok: true, output: 'Sent to CLI stdin' };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to send command' };
  }
}

export function shutdownAll(): void {
  for (const entry of SESSIONS.values()) {
    entry.eventStream?.abort();
    if (entry.child && entry.child.pid) {
      try {
        if (process.platform === 'win32') {
          execFile('taskkill', ['/pid', String(entry.child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
        } else {
          entry.child.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    }
  }
  SESSIONS.clear();
}
