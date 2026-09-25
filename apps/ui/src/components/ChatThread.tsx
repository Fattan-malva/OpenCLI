import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ADAPTERS, useStore } from '../store';
import { Icon } from '../lib/icons';
import type { ChatMessage } from '../lib/types';

const STATUS_CHIP: Record<ChatMessage['status'], { label: string; icon: string; classes: string }> = {
  pending: { label: 'Queued', icon: 'clock', classes: 'text-app-text bg-app-border/40 border-app-border' },
  streaming: { label: 'Running', icon: 'loader-2', classes: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30' },
  complete: { label: 'Done', icon: 'check-circle-2', classes: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  error: { label: 'Failed', icon: 'x-circle', classes: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  interrupted: { label: 'Stopped', icon: 'ban', classes: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
};

function agentMeta(agentId?: string) {
  return (agentId && ADAPTERS[agentId]) || ADAPTERS.system;
}

type ActivityRow =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'thought'; text: string }
  | { type: 'file'; file: string; range?: string }
  | { type: 'retry'; text: string }
  | { type: 'error'; text: string }
  | { type: 'approval'; text: string };

function parseActivity(text: string): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const tool = line.match(/^⏺\s+([^()\s]+)(?:\((.*)\))?$/);
    if (tool) {
      rows.push({ type: 'tool', name: tool[1], detail: (tool[2] ?? '').trim() });
      continue;
    }
    const file = line.match(/^✎\s+(?:modified|created|deleted|changed)\s+(.+)$/i);
    if (file) {
      const match = file[1].match(/^(.*?)\s+\(lines?\s+(\d+)\s*-\s*(\d+)\)$/);
      rows.push(
        match
          ? { type: 'file', file: match[1], range: `lines ${match[2]}-${match[3]}` }
          : { type: 'file', file: file[1].replace(/\s+\(line\s+\d+\)$/, '') },
      );
      continue;
    }
    const thought = line.match(/^✳\s+(?:thinking\s+)?(.*)$/);
    if (thought) {
      rows.push({ type: 'thought', text: thought[1] });
      continue;
    }
    if (/^\[allow-all\]/i.test(line)) {
      rows.push({ type: 'approval', text: line });
      continue;
    }
    if (line.startsWith('↻')) {
      rows.push({ type: 'retry', text: line.slice(1).trim() });
      continue;
    }
    if (line.startsWith('!')) {
      rows.push({ type: 'error', text: line.slice(1).trim() });
      continue;
    }
    rows.push({ type: 'text', text: line });
  }
  return rows;
}

function ActivityOutput({ text, streaming }: { text: string; streaming: boolean }) {
  const rows = useMemo(() => parseActivity(text), [text]);
  const lastIdx = rows.length - 1;

  return (
    <div className="rounded-lg border border-app-border bg-[#0b0d10] px-3 py-2 font-mono text-[11px] leading-relaxed overflow-y-auto max-h-96">
      {rows.map((row, index) => {
        const live = streaming && index === lastIdx;
        const key = `${row.type}-${index}`;

        if (row.type === 'text') {
          return (
            <div key={key} className="text-app-textStrong whitespace-pre-wrap break-words">
              {row.text}
              {live && <LiveCursor />}
            </div>
          );
        }

        if (row.type === 'thought') {
          return (
            <div key={key} className={`flex items-start gap-1.5 ${live ? 'animate-pulse' : ''}`}>
              <Icon name="cpu" className="w-3 h-3 mt-[3px] shrink-0 text-purple-300/80" />
              <span className="text-purple-300/80 uppercase tracking-wide text-[10px] shrink-0">Thought</span>
              <span className="text-purple-300/90 italic whitespace-pre-wrap break-words min-w-0">{row.text || 'thinking…'}</span>
            </div>
          );
        }

        if (row.type === 'tool') {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <Icon name="terminal" className="w-3 h-3 shrink-0 text-sky-300" />
              <span className="text-sky-300 font-medium">{row.name}</span>
              {row.detail && row.detail !== row.name && (
                <span className="text-app-text/70 truncate min-w-0">{row.detail}</span>
              )}
              <span className="ml-auto shrink-0">
                {live ? (
                  <Icon name="loader-2" className="w-3 h-3 text-sky-300 animate-spin" />
                ) : streaming ? (
                  <Icon name="circle" className="w-2 h-2 text-app-text/50" />
                ) : (
                  <Icon name="check-circle-2" className="w-3 h-3 text-emerald-400/80" />
                )}
              </span>
            </div>
          );
        }

        if (row.type === 'file') {
          return (
            <div key={key} className={`flex items-center gap-1.5 ${live ? 'animate-pulse' : ''}`}>
              <Icon name="edit-2" className={`w-3 h-3 shrink-0 ${live ? 'text-amber-300' : 'text-amber-300/80'}`} />
              <span className="text-amber-300 truncate min-w-0">{row.file}</span>
              {row.range && (
                <span className="shrink-0 px-1 py-px rounded border border-amber-500/25 bg-amber-500/10 text-amber-300/90 text-[10px]">
                  {row.range}
                </span>
              )}
            </div>
          );
        }

        if (row.type === 'retry') {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <Icon name="refresh-cw" className="w-3 h-3 shrink-0 text-amber-400/90" />
              <span className="text-amber-400/90 whitespace-pre-wrap break-words">{row.text}</span>
            </div>
          );
        }

        if (row.type === 'error') {
          return (
            <div key={key} className="flex items-start gap-1.5">
              <Icon name="alert-circle" className="w-3 h-3 mt-[3px] shrink-0 text-rose-400" />
              <span className="text-rose-400 whitespace-pre-wrap break-words min-w-0">{row.text}</span>
            </div>
          );
        }

        return (
          <div key={key} className="pl-[18px] -indent-[18px]">
            <span className="inline-flex items-center gap-1.5 px-1.5 py-px rounded border border-sky-500/20 bg-sky-500/10 text-sky-300/90">
              <Icon name="check" className="w-2.5 h-2.5" />
              <span className="whitespace-pre-wrap break-words">{row.text}</span>
            </span>
          </div>
        );
      })}
      {streaming && rows.length === 0 && (
        <div className="flex items-center gap-2 text-app-text">
          <Icon name="loader-2" className="w-3 h-3 animate-spin" />
          Working…
        </div>
      )}
    </div>
  );
}

function LiveCursor() {
  return <span className="inline-block w-1 h-3 ml-px align-middle bg-emerald-400 animate-pulse" />;
}

function MessageActions({ agentId }: { agentId?: string }) {
  const { sendChat } = useStore();
  const [value, setValue] = useState('');

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !agentId) return;
    void sendChat(trimmed, agentId);
    setValue('');
  };

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit(value);
          }
        }}
        placeholder={`Reply to ${agentId}...`}
        className="flex-1 min-w-40 bg-app-bg border border-app-border rounded px-3 py-1.5 text-xs text-app-textStrong focus:outline-none focus:border-app-primary"
      />
      <button
        onClick={() => submit('yes, continue')}
        className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-600/90 hover:bg-emerald-500 text-white transition-colors"
      >
        Approve
      </button>
      <button
        onClick={() => submit('no, stop and explain what is blocked')}
        className="px-3 py-1.5 rounded text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 transition-colors"
      >
        Deny
      </button>
    </div>
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
  const { chatRequests } = useStore();
  const meta = agentMeta(message.agentId);
  const chip = STATUS_CHIP[message.status];
  const request = chatRequests[message.id] ?? message.request;
  const isPlanner = message.role === 'planner';

  let interactive: ReactNode = null;
  if (request) {
    interactive = (
      <div className={`mt-2 rounded-lg border p-3 ${request.type === 'permission' ? 'border-amber-500/30 bg-amber-500/5' : 'border-sky-500/30 bg-sky-500/5'}`}>
        <div className={`flex items-start gap-2 text-xs ${request.type === 'permission' ? 'text-amber-300' : 'text-sky-300'}`}>
          <Icon name={request.type === 'permission' ? 'shield-alert' : 'help-circle'} className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold">
              {request.type === 'permission' ? 'Permission required' : 'The agent is asking'}
            </div>
            <div className="opacity-90 break-words">{request.message}</div>
            {request.command && (
              <div className="mt-2 font-mono text-[11px] bg-[#09090b] border border-app-border rounded px-2 py-1 break-words">
                {request.command}
              </div>
            )}
          </div>
        </div>
        <MessageActions agentId={message.agentId} />
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${meta.bg} ${meta.border} ${meta.color}`}>
        <Icon name={isPlanner ? 'workflow' : meta.icon} className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold ${meta.color}`}>{isPlanner ? 'Planner' : meta.name}</span>
          {message.agentId && <span className="text-[10px] font-mono text-app-text">{message.agentId}</span>}
          <ModeBadge message={message} />
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${chip.classes}`}>
            <Icon name={chip.icon} className={`w-3 h-3 ${message.status === 'streaming' ? 'animate-spin' : ''}`} />
            {chip.label}
          </span>
          {message.taskId && (
            <span className="text-[10px] font-mono text-app-text border border-app-border rounded px-1.5 py-0.5">step</span>
          )}
        </div>

        {message.text && (
          <div className="mt-2">
            <ActivityOutput text={message.text} streaming={message.status === 'streaming'} />
          </div>
        )}

        {interactive}
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
            Give a prompt or a task below. OpenCLI asks the planner agent to split it into steps, then every
            running adapter works on its own step and streams the result back here.
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
