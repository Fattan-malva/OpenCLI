import type { EventBus } from '@opencli/events';
import type { OpenCLIRepository } from '@opencli/db';
import type { ChatRequest, ConfirmationPolicy } from '@opencli/domain';
import type { ProtocolActivity } from './sessionProtocol.js';
import { setSessionMode, setSessionModel, talkToSession, sendAnswerToRequest, type TurnResult } from './sessions.js';
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
  model?: { provider: string; model: string };
  timeoutMs?: number;
  /** Confirmation policy for this turn; falls back to the global setting. */
  policy?: ConfirmationPolicy;
}

export function extractPatchRange(detail?: string): string {
  const match = (detail ?? '').match(/@@\s*-\d+(?:,\d+)?\s*\+(\d+)(?:,(\d+))?/m);
  if (!match) return '';
  const start = Number(match[1]);
  if (!Number.isFinite(start)) return '';
  const count = match[2] ? Number(match[2]) : NaN;
  return count > 0 ? ` (lines ${start}-${start + count - 1})` : ` (line ${start})`;
}

export function formatActivity(activity: ProtocolActivity): string {
  const detail = activity.detail ? ` ${activity.detail}` : '';
  if (activity.kind === 'tool') {
    return `⏺ ${activity.label}(${detail.trim()})\n`;
  }
  if (activity.kind === 'reasoning') {
    return `✳ ${activity.label}${detail}\n`;
  }
  if (activity.kind === 'file') {
    const action = activity.status === 'changed' ? 'modified' : activity.status ?? 'changed';
    return `✎ ${action} ${activity.label}${extractPatchRange(activity.detail)}\n`;
  }
  if (activity.kind === 'status') {
    if (activity.status === 'retry') return `↻ retry: ${activity.detail ?? 'provider unavailable'}\n`;
    return '';
  }
  return `${activity.status === 'error' ? '!' : '·'} ${activity.label}${detail}\n`;
}

export async function runAgentTurn(deps: ChatRuntimeDeps, opts: AgentTurnOptions): Promise<TurnResult> {
  const { projectId, threadId, adapterId, messageId, text, taskId, mode, model } = opts;
  const role = deps.db.getChatMessage(messageId)?.role ?? 'agent';
  const requestedMode = mode ?? 'build';
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
    const applied = await setSessionModel(projectId, adapterId, model.provider, model.model);
    if (!applied.ok) console.warn(`[chat] Could not set ${model.provider}/${model.model} on ${adapterId}: ${applied.error}`);
  }

  const append = (chunk: string, extra?: Record<string, unknown>) => {
    deps.db.appendChatMessageText(messageId, chunk);
    void deps.eventBus.emit({
      type: 'chat.assistant_output',
      projectId,
      taskId,
      agentId: adapterId,
      payload: { threadId, messageId, adapterId, taskId, role, text: chunk, ...extra },
    });
  };

  const result = await talkToSession({
    projectId,
    adapterId,
    text,
    timeoutMs: opts.timeoutMs,
    mode,
    model,
    handlers: {
      onText: (chunk) => append(chunk),
      onTool: (tool) => append(formatActivity({ kind: 'tool', label: tool })),
      onActivity: (activity) => {
        const line = formatActivity(activity);
        if (line) append(line);
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
      onRequest: (request: ChatRequest) => {
        if (shouldAutoApprove(policy, request)) {
          append(`\n[allow-all] auto-approved: ${request.command ?? request.message ?? ''}\n`, { request, autoApproved: true });
          void sendAnswerToRequest(projectId, adapterId, 'yes, continue');
          return;
        }
        deps.db.updateChatMessage(messageId, { request, status: 'streaming' });
        append(`\n[${request.type}] ${request.command ?? request.message}\n`, { request });
      },
    },
  });

  if (result.ok) {
    deps.db.appendChatMessageText(messageId, '✓ turn finished\n');
    deps.db.updateChatMessage(messageId, { status: 'complete', request: undefined });
    void deps.eventBus.emit({
      type: 'chat.assistant_completed',
      projectId,
      taskId,
      agentId: adapterId,
      payload: { threadId, messageId, adapterId, taskId, role, text: result.text },
    });
  } else {
    const detail = result.error ?? 'The agent turn did not complete';
    deps.db.appendChatMessageText(messageId, `\n! ${detail}\n`);
    deps.db.updateChatMessage(messageId, { status: result.timedOut ? 'interrupted' : 'error' });
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
