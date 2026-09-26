import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../store';
import { adapterMeta } from '../lib/data';
import { Icon } from '../lib/icons';
import { AdapterIcon } from './AdapterIcon';
import { AnswersProvider, ConversationItemView } from './chat/ConversationItems';
import type { ChatMessage } from '../lib/types';

const STATUS_CHIP: Record<ChatMessage['status'], { label: string; icon: string; classes: string }> = {
  pending: { label: 'Queued', icon: 'clock', classes: 'text-app-text bg-app-border/40 border-app-border' },
  streaming: { label: 'Running', icon: 'loader-2', classes: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30' },
  awaiting_input: { label: 'Needs you', icon: 'help-circle', classes: 'text-sky-300 bg-sky-500/10 border-sky-500/30' },
  complete: { label: 'Done', icon: 'check-circle-2', classes: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  error: { label: 'Failed', icon: 'x-circle', classes: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  interrupted: { label: 'Stopped', icon: 'ban', classes: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
};

function agentMeta(agentId?: string) {
  return adapterMeta(agentId);
}

/**
 * The agent's turn, rendered from its items.
 *
 * The server folds protocol events into a list of named items, and this renders
 * that list. It used to instead take one text column and guess at each line by
 * its glyph — `⏺` for a tool, `✳` for reasoning — which is why tool output was
 * invisible and a tool call could not be expanded. Nothing here parses text
 * any more; a message with no items falls back to its prose.
 */
function TurnItems({ message }: { message: ChatMessage }) {
  const { answerRequest, chatRequests } = useStore();
  const streaming = message.status === 'streaming';
  const items = message.items ?? [];
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!streaming) return;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [items.length, streaming]);

  if (items.length === 0) {
    if (!message.text) {
      return streaming ? (
        <div className="flex items-center gap-2 text-app-text text-xs">
          <span className="inline-block w-1.5 h-3.5 bg-emerald-400 animate-caret" />
          Waiting for the first token…
        </div>
      ) : null;
    }
    return (
      <div className="rounded-lg border border-app-border bg-[#0b0d10] px-3 py-2">
        <div className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-app-textStrong">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <AnswersProvider
      value={{
        answerRequest,
        // Only the message that is actually holding a request offers the
        // controls, so an old question further up the transcript stays readable
        // instead of looking like something to answer again.
        answerable: Boolean(chatRequests[message.id]),
      }}
    >
      <div className="space-y-1.5">
        {items.map((item) => (
          <ConversationItemView key={item.id} item={item} messageId={message.id} />
        ))}
        <div ref={endRef} />
      </div>
    </AnswersProvider>
  );
}

function ModeBadge({ message }: { message: ChatMessage }) {
  const mode = message.meta?.mode;
  const model = message.meta?.model;
  const provider = message.meta?.provider;
  if (!mode && !model) return null;

  return (
    <span className="flex items-center gap-1 text-[10px] text-app-text font-mono">
      {mode && (
        <span className="px-1.5 py-0.5 rounded border border-app-border bg-app-bg text-app-textStrong">{mode}</span>
      )}
      {provider && model && (
        <span className="px-1.5 py-0.5 rounded border border-app-border bg-app-bg truncate max-w-40" title={`${provider}/${model}`}>
          {provider}/{model}
        </span>
      )}
      {!provider && model && (
        <span className="px-1.5 py-0.5 rounded border border-app-border bg-app-bg truncate max-w-40">{model}</span>
      )}
    </span>
  );
}

function AgentMessage({ message }: { message: ChatMessage }) {
  const meta = agentMeta(message.agentId);
  const chip = STATUS_CHIP[message.status];
  const isPlanner = message.role === 'planner';
  const hasContent = Boolean(message.items?.length) || Boolean(message.text);

  return (
    <div className="flex gap-3">
      <div className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${meta.bg} ${meta.border} ${meta.color}`}>
        {isPlanner ? (
          <Icon name="workflow" className="w-4 h-4" />
        ) : (
          <AdapterIcon id={message.agentId ?? 'system'} className="w-4 h-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {/* The adapter is named once, right after its mark. The raw id used to
              be repeated beside the display name, which read as two different
              adapters rather than one adapter described twice. */}
          <span className={`text-xs font-semibold ${meta.color}`}>{isPlanner ? 'Planner' : meta.name}</span>
          <ModeBadge message={message} />
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${chip.classes}`}>
            {/* A running turn shows a circular loader. A turn waiting on a person
                does not spin, because nothing is happening until they answer. */}
            <Icon
              name={chip.icon}
              className={`w-3 h-3 ${message.status === 'streaming' ? 'animate-spin' : ''}`}
            />
            {chip.label}
          </span>
          {message.taskId && (
            <span className="text-[10px] font-mono text-app-text border border-app-border rounded px-1.5 py-0.5">step</span>
          )}
        </div>

        {hasContent && (
          <div className="mt-2">
            <TurnItems message={message} />
          </div>
        )}
      </div>
    </div>
  );
}

function PlanBanner({ workflowId }: { workflowId: string }) {
  const { tasks, activeProject, activeThread, executeChatPlan, sessions } = useStore();
  const running = sessions.filter((session) => session.status === 'running').length;
  const steps = useMemo(
    () => tasks.filter((task) => task.workflowId === workflowId).length,
    [tasks, workflowId],
  );

  return (
    <div className="border border-indigo-500/30 bg-indigo-500/10 rounded-lg px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
      <Icon name="list-checks" className="w-4 h-4 text-indigo-300 shrink-0" />
      <div className="min-w-0 flex-1 text-xs text-app-text">
        <span className="font-semibold text-app-textStrong">Plan ready</span>
        {' — '}
        {steps > 0 ? `${steps} step${steps === 1 ? '' : 's'}` : 'a todo list'} created for this conversation.
        Nothing has run yet. Review it on the Workflow board, then execute to hand the steps to the running adapters.
      </div>
      {running > 0 ? (
        <button
          onClick={() => executeChatPlan()}
          disabled={!activeProject || !activeThread}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          <Icon name="play" className="w-3.5 h-3.5" />
          Execute plan
        </button>
      ) : (
        <span className="text-[11px] text-amber-400 border border-amber-500/20 bg-amber-500/5 rounded px-2 py-1">
          Start an adapter session first
        </span>
      )}
    </div>
  );
}

export function ChatThread() {
  const { chatMessages, activeThread, sessions, workflows } = useStore();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastText = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1]?.text.length ?? 0 : 0;
  const draftPlan = useMemo(
    () =>
      activeThread?.workflowId
        ? workflows.find((workflow) => workflow.id === activeThread.workflowId && workflow.status === 'draft')
        : undefined,
    [activeThread?.workflowId, workflows],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages.length, lastText]);

  const running = useMemo(
    () => sessions.filter((session) => session.status === 'running').map((session) => session.adapterId),
    [sessions],
  );

  if (!activeThread) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <Icon name="message-square-dashed" className="w-9 h-9 mx-auto mb-3 text-app-text" />
          <div className="text-sm font-medium text-app-textStrong">Start a conversation</div>
          <div className="text-xs text-app-text mt-1.5">
            Pick one adapter to talk to. <span className="text-app-textStrong">Ask</span> answers with that
            adapter alone, <span className="text-app-textStrong">Plan</span> turns your request into a todo list
            you review first, and <span className="text-app-textStrong">Agent</span> plans and then routes the steps
            across every active adapter.
          </div>
          {running.length === 0 && (
            <div className="mt-4 text-xs text-amber-400 border border-amber-500/20 bg-amber-500/5 rounded-lg px-3 py-2 inline-block">
              No adapter session is running. Start one on the Adapters page first.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        {/* This conversation is addressed to exactly one adapter, even when
            several are active and available to a workflow. */}
        {activeThread.chatAdapterId && (
          <div className="flex items-center gap-2 text-[11px] text-app-text">
            <Icon name="bot" className="w-3.5 h-3.5" />
            <span>Chatting with</span>
            <span className="text-app-textStrong font-medium">{activeThread.chatAdapterId}</span>
            {activeThread.adapterMode && (
              <>
                <span className="text-app-text">in</span>
                <span className="font-mono text-app-primary">{activeThread.adapterMode}</span>
              </>
            )}
            {activeThread.planStatus && activeThread.planStatus !== 'none' && (
              <span className="ml-auto px-1.5 py-0.5 rounded bg-app-border text-app-text">
                plan: {activeThread.planStatus}
              </span>
            )}
          </div>
        )}
        {draftPlan && <PlanBanner workflowId={draftPlan.id} />}
        {chatMessages.map((message) => {
          if (message.role === 'user') {
            return (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-br-sm border border-app-primary/30 bg-app-primary/15 px-3.5 py-2.5">
                  <pre className="text-sm text-app-textStrong whitespace-pre-wrap break-words font-sans">{message.text}</pre>
                </div>
              </div>
            );
          }

          if (message.role === 'system') {
            return (
              <div key={message.id} className="flex justify-center">
                <div className="flex items-start gap-2 text-[11px] text-app-text border border-app-border bg-app-surface rounded-lg px-3 py-2 max-w-lg">
                  <Icon name="info" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span className="whitespace-pre-wrap break-words">{message.text}</span>
                </div>
              </div>
            );
          }

          return <AgentMessage key={message.id} message={message} />;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
