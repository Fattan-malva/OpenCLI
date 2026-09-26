// Layer 2 of the chat pipeline: the protocol contract.
//
// An adapter's own output is translated into exactly these events. Nothing
// downstream — not the conversation store, not the UI — is allowed to look at
// adapter text, because adapter text is a rendering of the protocol, not the
// protocol itself. That is what stops a Kilo update from breaking the chat.
//
// Every event has:
//   id        stable identity of the *subject* (a tool call, a message part),
//             so repeated events about it fold into one conversation item.
//   seq       per-turn monotonic order, so the UI can order without timestamps.
//   phase     start | delta | update | complete.
//
// `delta` accumulates into the subject. `update` replaces the subject's
// non-text state. `complete` closes it.

import type { ConversationToolData } from '@opencli/domain';

export type AgentEventPhase = 'start' | 'delta' | 'update' | 'complete';

export type AgentEventType =
  | 'turn'
  | 'message'
  | 'thinking'
  | 'tool'
  | 'skill'
  | 'todo'
  | 'file_change'
  | 'question'
  | 'permission'
  | 'status'
  | 'error';

/** A choice the agent offered, so the UI renders buttons rather than prose. */
export interface AgentOption {
  id: string;
  label: string;
  description?: string;
}

export interface TurnData {
  agent?: string;
  mode?: string;
  provider?: string;
  model?: string;
  /** Why the turn ended, for `phase: 'complete'`. */
  reason?: 'idle' | 'result' | 'error' | 'aborted';
  error?: string;
}

export interface MessageData {
  text: string;
}

export interface ThinkingData {
  text: string;
}

export interface ToolData extends ConversationToolData {}

/** Tools whose arguments are a command line rather than a data object. */
const SHELL_TOOLS = new Set(['bash', 'shell', 'sh', 'run', 'runcommand', 'exec', 'powershell', 'cmd']);

export function isShellTool(name: string): boolean {
  return SHELL_TOOLS.has(name.toLowerCase());
}

/**
 * The command a shell tool is about to run, when its arguments contain one.
 *
 * Adapters disagree on the argument name, so every spelling any of them uses is
 * accepted. Returns undefined rather than guessing when none is present.
 */
export function shellCommand(name: string, input: unknown): string | undefined {
  if (!isShellTool(name)) return undefined;
  if (typeof input === 'string') return input.trim() || undefined;
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const field of ['command', 'cmd', 'script', 'input', 'shellCommand']) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    // Some adapters wrap the command in an argv array.
    if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
      const joined = value.join(' ').trim();
      if (joined) return joined;
    }
  }
  return undefined;
}

export interface SkillData {
  name: string;
  skillId?: string;
  detail?: string;
}

export interface TodoEntry {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: string;
}

export interface TodoData {
  items: TodoEntry[];
}

export interface FileChangeData {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
  patch?: string;
}

export interface QuestionData {
  requestId: string;
  question: string;
  options: AgentOption[];
  /** True when more than one option may be chosen. */
  multiple?: boolean;
}

export interface PermissionData {
  requestId: string;
  tool?: string;
  command?: string;
  risk?: 'low' | 'medium' | 'high';
  detail?: string;
}

export interface StatusData {
  label: string;
  detail?: string;
}

export interface ErrorData {
  message: string;
  retryable?: boolean;
}

interface AgentEventBase {
  id: string;
  seq: number;
  turnId: string;
  adapterId: string;
  timestamp: number;
}

/** Every event is about something with an identity, so repeated ones can fold. */
interface Subject {
  /** Stable identity of the subject: a tool call, a message part, a request. */
  id: string;
}

type AgentEventBody = Subject &
  (
    | { type: 'turn'; phase: 'start' | 'complete'; data: TurnData }
    | { type: 'message'; phase: 'start' | 'delta' | 'complete'; data: MessageData }
    | { type: 'thinking'; phase: 'start' | 'delta' | 'complete'; data: ThinkingData }
    | { type: 'tool'; phase: 'start' | 'update' | 'complete'; data: ToolData }
    | { type: 'skill'; phase: 'start' | 'update' | 'complete'; data: SkillData }
    | { type: 'todo'; phase: 'update' | 'complete'; data: TodoData }
    | { type: 'file_change'; phase: 'complete'; data: FileChangeData }
    | { type: 'question'; phase: 'start' | 'complete'; data: QuestionData }
    | { type: 'permission'; phase: 'start' | 'complete'; data: PermissionData }
    | { type: 'status'; phase: 'update'; data: StatusData }
    | { type: 'error'; phase: 'complete'; data: ErrorData }
  );

export type AgentEvent = AgentEventBase & AgentEventBody;

/**
 * Numbers the events of one turn.
 *
 * Each adapter translator gets its own factory, so seq is per-turn and an event
 * from a different session can never interleave into this turn's ordering.
 */
export function createEventFactory(turnId: string, adapterId: string) {
  let seq = 0;
  return {
    emit<T extends AgentEventBody>(body: T): AgentEvent {
      seq += 1;
      return { ...body, seq, turnId, adapterId, timestamp: Date.now() } as AgentEvent;
    },
    get count(): number {
      return seq;
    },
  };
}

export type EventFactory = ReturnType<typeof createEventFactory>;

/**
 * True when the turn cannot progress until the user answers.
 *
 * This is what makes a question a control request rather than output: the
 * runtime holds the turn open, and the answer travels back down the control
 * channel instead of becoming a new turn.
 */
export function awaitsUser(event: AgentEvent): boolean {
  return (
    (event.type === 'question' || event.type === 'permission') && event.phase === 'start'
  );
}

export function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === 'turn' && event.phase === 'complete';
}

/** Longest tool output kept per call. Enough for a build, short enough for a row. */
export const TOOL_OUTPUT_LIMIT = 20_000;

/** Longest tool argument object kept per call. */
export const TOOL_INPUT_LIMIT = 8_000;

export function clampText(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false };
  return { text: value.slice(0, limit), truncated: true };
}
