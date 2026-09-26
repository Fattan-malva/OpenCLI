import type { EventBus } from '@opencli/events';
import type { OpenCLIRepository } from '@opencli/db';
import type {
  ChatRequest,
  ConfirmationPolicy,
  ConversationItem,
  ConversationToolItem,
} from '@opencli/domain';
import type { AgentEvent } from './protocol/agentEvent.js';
import { applyEvents, conversationText, pendingRequest } from './conversation/turnState.js';
import { setSessionMode, setSessionModel, talkToSession, sendAnswerToRequest, isSessionBusy, type TurnResult } from './sessions.js';
import { shouldAutoApprove } from './settings.js';

export interface ChatRuntimeDeps {
  db: OpenCLIRepository;
  eventBus: EventBus;
}

export interface AgentTurnOptions {
  projectId: string;
  threadId: string;
  adapterId: string;
  adapterName?: string;
  messageId: string;
  text: string;
  taskId?: string;
  mode?: string;
  model?: { provider: string; model: string; spec?: string };
  timeoutMs?: number;
  /** Confirmation policy for this turn; falls back to the global setting. */
  policy?: ConfirmationPolicy;
}

export function toolTitle(name: string, title?: string): string {
  return title?.trim() || name || 'tool';
}

/**
 * Describes a control request in the shape the answer route and the older
 * message column both understand.
 *
 * The event already carries everything needed, so this is a translation rather
 * than a lookup: the request lives on the event, and the message column keeps a
 * copy only so a pending question survives a reload even if the item list is
 * trimmed.
 */
function controlRequestFrom(
  event: Extract<AgentEvent, { type: 'question' | 'permission' }>,
): ChatRequest {
  if (event.type === 'permission') {
    return {
      type: 'permission',
      requestId: event.data.requestId,
      message: event.data.detail ?? event.data.tool ?? 'The agent needs permission to continue',
      command: event.data.command,
    };
  }
  return {
    type: 'question',
    requestId: event.data.requestId,
    message: event.data.question,
    options: event.data.options.map((option) => option.label),
  };
}

export async function runAgentTurn(deps: ChatRuntimeDeps, opts: AgentTurnOptions): Promise<TurnResult> {
  const { projectId, threadId, adapterId, messageId, text, taskId, mode, model } = opts;
  const role = deps.db.getChatMessage(messageId)?.role ?? 'agent';
  // No assumed mode name: an adapter whose CLI publishes no modes is left on
  // whatever it is already using rather than being told a mode that may not
  // exist.
  const requestedMode = mode ?? '';
  const policy = opts.policy ?? 'default';

  deps.db.mergeChatMessageMeta(messageId, { agent: opts.adapterName, mode: requestedMode });

  await deps.eventBus.emit({
    type: 'chat.assistant_started',
    projectId,
    taskId,
    agentId: adapterId,
    payload: {
      threadId,
      messageId,
      adapterId,
      adapterName: opts.adapterName,
      taskId,
      role,
      meta: { mode: requestedMode },
    },
  });

  deps.db.updateChatMessage(messageId, { status: 'streaming' });

  if (mode) {
    const switched = await setSessionMode(projectId, adapterId, mode);
    if (!switched.ok) console.warn(`[chat] Could not set ${adapterId} to ${mode}: ${switched.error}`);
  }
  if (model) {
    // Only switch when the CLI actually publishes this model. Sending a spec it
    // does not know makes it answer "Model not found" instead of running, so it
    // is better to leave the session on the CLI's own configured default.
    const target = model.spec ?? `${model.provider}/${model.model}`;
    const applied = await setSessionModel(projectId, adapterId, model.provider, model.model, model.spec);
    if (!applied.ok) {
      console.warn(`[chat] Could not set ${target} on ${adapterId}: ${applied.error}`);
    }
  }

  /**
   * The conversation is the single source of truth for this turn.
   *
   * Every normalized event is folded into `items` first, and the transcript is
   * rebuilt from those items. The previous design appended formatted CLI lines
   * to one text column, which meant a tool call, a status line and prose all had
   * to be flattened into text and re-parsed by the UI to be shown as anything
   * other than a wall of glyphs.
   */
  let items: ConversationItem[] = deps.db.getChatMessage(messageId)?.items ?? [];

  /**
   * Persists the folded conversation and publishes only what changed.
   *
   * The whole item list is written because items arrive out of order relative to
   * storage (a tool completes after a later message has started), so the last
   * write has to win. `publish` is false for the initial fold, which only exists
   * to seed the reducer.
   */
  const commit = (next: ConversationItem[]) => {
    items = next;
    deps.db.saveChatMessageItems(messageId, items);
  };

  const publish = (event: AgentEvent, snapshot: ConversationItem[]) => {
    void deps.eventBus.emit({
      type: 'chat.turn_item',
      projectId,
      taskId,
      agentId: adapterId,
      payload: { threadId, messageId, adapterId, taskId, role, event, items: snapshot },
    });
  };

  /**
   * Control requests are answered through the turn, never as a new message.
   *
   * Auto-approval is the only case that resolves without a person, and it is
   * recorded as a tool-shaped item so the transcript still shows that something
   * was allowed on the user's behalf.
   */
  const handleControl = (kind: 'question' | 'permission', request: ChatRequest) => {
    if (shouldAutoApprove(policy, request)) {
      const label = request.command ?? request.message ?? 'request';
      const approved: ConversationToolItem = {
        kind: 'tool',
        id: `autoapprove:${request.requestId ?? kind}`,
        status: 'completed',
        seq: items.length,
        name: label,
        title: 'auto-approved',
        input: label,
        output: '',
      };
      commit([...items, approved]);
      publish(
        {
          type: 'tool',
          phase: 'complete',
          id: approved.id,
          seq: approved.seq,
          turnId: '',
          adapterId,
          timestamp: Date.now(),
          data: { name: approved.name, title: approved.title, input: approved.input, status: 'completed' },
        },
        items,
      );
      void sendAnswerToRequest(projectId, adapterId, 'yes, continue');
      return;
    }
    // Held open: the request stays in `request` on the message, and the turn
    // continues once the answer arrives on the same turn.
    deps.db.updateChatMessage(messageId, { request, status: 'awaiting_input' });
  };

  const result = await talkToSession({
    projectId,
    adapterId,
    text,
    timeoutMs: opts.timeoutMs,
    mode,
    model,
    handlers: {
      onEvent: (event) => {
        const next = applyEvents(items, [event]);
        if (next === items) return;
        commit(next);
        publish(event, next);

        // A control request is described by the event, so it is built here
        // rather than read back from the message. Reading it back looked
        // reasonable but nothing had written it yet, so the question reached
        // the transcript with no way to answer it and the turn just spun.
        if (event.type === 'question' || event.type === 'permission') {
          handleControl(event.type, controlRequestFrom(event));
        }
      },
      onMeta: (meta) => {
        deps.db.mergeChatMessageMeta(messageId, meta);
        void deps.eventBus.emit({
          type: 'chat.assistant_output',
          projectId,
          taskId,
          agentId: adapterId,
          payload: { threadId, messageId, adapterId, taskId, role, meta },
        });
      },
    },
  });

  // The message's text column is prose only, so a copy of the reply or a later
  // planning pass does not carry tool output and status glyphs with it.
  const finalItems = items;
  const prose = conversationText(finalItems);
  const stillPending = pendingRequest(finalItems);

  if (result.ok) {
    // A request that is still pending outlives this turn: it is answered on the
    // turn that follows, and clearing it here would make the question vanish
    // from the transcript before anyone could answer it.
    deps.db.updateChatMessage(messageId, {
      text: prose,
      items: finalItems,
      status: stillPending ? 'awaiting_input' : 'complete',
      request: stillPending ? deps.db.getChatMessage(messageId)?.request : undefined,
    });
    void deps.eventBus.emit({
      type: 'chat.assistant_completed',
      projectId,
      taskId,
      agentId: adapterId,
      payload: { threadId, messageId, adapterId, taskId, role, text: prose, items: finalItems },
    });
  } else {
    const detail = result.error ?? 'The agent turn did not complete';
    deps.db.updateChatMessage(messageId, {
      text: prose,
      items: finalItems,
      status: result.timedOut ? 'interrupted' : 'error',
    });
    void deps.eventBus.emit({
      type: result.timedOut ? 'chat.turn_interrupted' : 'chat.assistant_failed',
      projectId,
      taskId,
      agentId: adapterId,
      payload: { threadId, messageId, adapterId, taskId, role, error: detail },
    });
  }

  return result;
}

export interface AnswerRequestOptions {
  projectId: string;
  threadId: string;
  adapterId: string;
  adapterName?: string;
  /** Which message is holding the question or permission open. */
  messageId: string;
  /** The answer as the person gave it, or the option they picked. */
  answer: string;
  taskId?: string;
  mode?: string;
  model?: { provider: string; model: string; spec?: string };
  confirmationPolicy?: ConfirmationPolicy;
}

/**
 * Answers a question or permission the agent asked.
 *
 * This is deliberately not the same path as sending a chat message. The agent
 * stopped and asked; its answer has to go back to the session, and the agent
 * then carries on with the work it was already doing. Routing the answer through
 * "send a message" instead makes the agent treat the answer as a fresh request,
 * which is why approving a tool used to restart the turn from scratch.
 *
 * When no turn is in flight — the app was restarted, or the adapter was
 * restarted — the answer is sent as a normal prompt so the person is not left
 * with a question that can never be answered.
 */
export async function answerChatRequest(
  deps: ChatRuntimeDeps,
  opts: AnswerRequestOptions,
): Promise<{ delivered: boolean; resumed: boolean; error?: string }> {
  const { projectId, threadId, adapterId, messageId, answer } = opts;
  const message = deps.db.getChatMessage(messageId);
  if (!message) return { delivered: false, resumed: false, error: 'Message not found' };
  if (!message.request) return { delivered: false, resumed: false, error: 'This message is not waiting for an answer' };

  // Resolve the request in the transcript first, so the question stops being
  // offered even if delivery below fails and has to be retried.
  const items = (message.items ?? []).map((item) => {
    if ((item.kind === 'question' || item.kind === 'permission') && item.status === 'pending') {
      return { ...item, status: 'completed' as const, answer };
    }
    return item;
  });
  deps.db.updateChatMessage(messageId, {
    items,
    request: undefined,
    status: 'complete',
    text: conversationText(items),
  });

  if (isSessionBusy(projectId, adapterId)) {
    const delivered = await sendAnswerToRequest(projectId, adapterId, answer);
    if (delivered) {
      void deps.eventBus.emit({
        type: 'chat.turn_item',
        projectId,
        taskId: opts.taskId,
        agentId: adapterId,
        payload: { threadId, messageId, adapterId, taskId: opts.taskId, role: 'agent', items, answered: answer },
      });
      return { delivered: true, resumed: false };
    }
    return { delivered: false, resumed: false, error: 'The agent session did not accept the answer' };
  }

  // No turn to answer into, so the answer becomes the next turn. The agent
  // resumes from its own session history, which still holds the question.
  const resumed = await runAgentTurn(deps, {
    projectId,
    threadId,
    adapterId,
    adapterName: opts.adapterName,
    messageId,
    text: answer,
    taskId: opts.taskId,
    mode: opts.mode,
    model: opts.model,
    policy: opts.confirmationPolicy,
  });
  return { delivered: true, resumed: true, error: resumed.ok ? undefined : resumed.error };
}
