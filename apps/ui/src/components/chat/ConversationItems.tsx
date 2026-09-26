import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../../lib/icons';
import type {
  ConversationErrorItem,
  ConversationFileChangeItem,
  ConversationItem,
  ConversationPermissionItem,
  ConversationQuestionItem,
  ConversationSkillItem,
  ConversationStatusItem,
  ConversationTextItem,
  ConversationTodoItem,
  ConversationToolItem,
} from '../../lib/types';

/**
 * Renders one item the agent produced.
 *
 * Each branch receives a real, named shape from the server. Nothing here
 * inspects a string looking for a marker or a prefix, because the server has
 * already decided what each thing is. A tool call is a tool call, so it can be
 * collapsed, expanded and styled as one.
 *
 * `messageId` is the message this item belongs to, which is what an answer is
 * sent against. The item's own `requestId` identifies the question to the agent;
 * the message identifies where to send the answer.
 */
export function ConversationItemView({ item, messageId }: { item: ConversationItem; messageId: string }) {
  switch (item.kind) {
    case 'message':
      return <MessageItem item={item} />;
    case 'thinking':
      return <ThinkingItem item={item} />;
    case 'tool':
      return <ToolBlock item={item} />;
    case 'skill':
      return <SkillItem item={item} />;
    case 'todo':
      return <TodoItem item={item} />;
    case 'file_change':
      return <FileChangeItem item={item} />;
    case 'question':
      return <QuestionItem item={item} messageId={messageId} />;
    case 'permission':
      return <PermissionItem item={item} messageId={messageId} />;
    case 'status':
      return <StatusItem item={item} />;
    case 'error':
      return <ErrorItem item={item} />;
    default:
      return null;
  }
}

function MessageItem({ item }: { item: ConversationTextItem }) {
  if (!item.text) return null;
  return (
    <div className="text-[12.5px] leading-relaxed text-app-textStrong whitespace-pre-wrap break-words">
      {item.text}
    </div>
  );
}

/**
 * Reasoning, collapsed by default.
 *
 * It is kept out of the answer on purpose: reading a model's private reasoning
 * is not the same as reading its conclusion, and mixing the two makes it hard to
 * see what was actually decided.
 */
function ThinkingItem({ item }: { item: ConversationTextItem }) {
  const [open, setOpen] = useState(false);
  if (!item.text) return null;

  return (
    <div className="rounded border border-purple-500/20 bg-purple-500/5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-purple-300/90 hover:text-purple-200 transition-colors"
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="w-3 h-3 shrink-0" />
        <Icon name="brain" className="w-3 h-3 shrink-0" />
        <span>{open ? 'Hide reasoning' : 'Reasoning'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2 text-[11.5px] leading-relaxed text-purple-200/70 italic whitespace-pre-wrap break-words border-t border-purple-500/15 pt-2">
          {item.text}
        </div>
      )}
    </div>
  );
}

/** Tools whose arguments are a command line, shown as one. */
const SHELL_TOOLS = new Set(['bash', 'shell', 'sh', 'run', 'runcommand', 'exec', 'powershell', 'cmd']);

function isShellTool(name: string): boolean {
  return SHELL_TOOLS.has(name.trim().toLowerCase());
}

/** Renders a tool's arguments as readable text without pretending to know more. */
function formatInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

const TOOL_STATUS: Record<ConversationToolItem['status'], { label: string; classes: string }> = {
  pending: { label: 'Queued', classes: 'text-app-text border-app-border' },
  running: { label: 'Running', classes: 'text-sky-300 border-sky-500/30' },
  completed: { label: 'Done', classes: 'text-emerald-400 border-emerald-500/30' },
  failed: { label: 'Failed', classes: 'text-rose-400 border-rose-500/30' },
  cancelled: { label: 'Cancelled', classes: 'text-app-text border-app-border' },
};

/**
 * A tool call, collapsed to one line and expandable to the full result.
 *
 * This is the shape that was missing: a bash call used to reach the transcript
 * as `⏺ bash({"command":"npm test"})` with no output at all, so there was
 * nothing to expand and no way to see what the command actually printed.
 *
 * Output is collapsed by default because a build or test run can be thousands
 * of lines, but the command line is always visible — that is the part someone
 * reads to know what the agent is doing.
 */
function ToolBlock({ item }: { item: ConversationToolItem }) {
  const shell = isShellTool(item.name);
  // Output is the reason to expand, so a tool that produced none starts closed
  // and one that did starts open: an empty expander teaches nothing.
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(item.output || item.error || item.truncated);
  const status = TOOL_STATUS[item.status];
  const command = item.command ?? (shell ? formatInput(item.input) : item.title);

  return (
    <div className="rounded border border-app-border bg-[#0b0d10] overflow-hidden">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((value) => !value)}
        aria-expanded={open}
        disabled={!hasDetails}
        className={`w-full text-left px-2.5 py-1.5 flex items-start gap-2 transition-colors ${
          hasDetails ? 'hover:bg-white/[0.03] cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className="shrink-0 w-3 h-4 flex items-center justify-center text-app-text">
          {item.status === 'running' ? (
            <Icon name="loader-2" className="w-3 h-3 animate-spin" />
          ) : hasDetails ? (
            <Icon name={open ? 'chevron-down' : 'chevron-right'} className="w-3 h-3" />
          ) : (
            <Icon name={item.status === 'failed' ? 'x-circle' : 'check'} className="w-3 h-3" />
          )}
        </span>
        <span className="shrink-0 text-[11px] font-semibold text-sky-300 font-mono pt-[1px]">{item.name}</span>
        {command && (
          <span className="flex-1 min-w-0 font-mono text-[11.5px] text-app-text truncate pt-[1px]" title={command}>
            {command}
          </span>
        )}
        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${status.classes}`}>{status.label}</span>
      </button>

      {open && hasDetails && (
        <div className="border-t border-app-border">
          {!shell && item.input !== undefined && (
            <details className="border-b border-app-border/60">
              <summary className="px-2.5 py-1 text-[10.5px] text-app-text cursor-pointer select-none hover:text-app-textStrong transition-colors">
                Arguments
              </summary>
              <pre className="px-2.5 pb-2 font-mono text-[11px] text-app-text whitespace-pre-wrap break-words">
                {formatInput(item.input)}
              </pre>
            </details>
          )}
          {item.error && (
            <pre className="px-2.5 py-2 font-mono text-[11px] text-rose-300 whitespace-pre-wrap break-words">
              {item.error}
            </pre>
          )}
          {item.output && (
            <pre className="px-2.5 py-2 font-mono text-[11px] leading-relaxed text-app-text whitespace-pre-wrap break-words max-h-96 overflow-auto">
              {item.output}
              {item.truncated && (
                <span className="block mt-1 text-[10px] text-amber-400/80">
                  Output was too large to keep in full; showing the stored portion.
                </span>
              )}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function SkillItem({ item }: { item: ConversationSkillItem }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-app-text">
      <Icon name="sparkles" className="w-3.5 h-3.5 text-amber-300 shrink-0" />
      <span className="text-app-textStrong font-medium">{item.name}</span>
      {item.detail && <span className="truncate">{item.detail}</span>}
    </div>
  );
}

function TodoItem({ item }: { item: ConversationTodoItem }) {
  const done = item.items.filter((entry) => entry.status === 'completed').length;
  return (
    <details className="rounded border border-app-border bg-[#0b0d10] px-2.5 py-1.5">
      <summary className="flex items-center gap-2 text-[11.5px] cursor-pointer select-none list-none">
        <Icon name="chevron-right" className="w-3 h-3 text-app-text shrink-0 group-open:rotate-90" />
        <Icon name="list-todo" className="w-3.5 h-3.5 text-app-text shrink-0" />
        <span className="text-app-textStrong">{done} of {item.items.length} done</span>
      </summary>
      <ul className="mt-1.5 space-y-0.5 border-t border-app-border/60 pt-1.5">
        {item.items.map((entry) => (
          <li key={entry.id} className="flex items-start gap-2 text-[11.5px]">
            <Icon
              name={entry.status === 'completed' ? 'check' : entry.status === 'cancelled' ? 'x' : 'circle'}
              className={`w-3 h-3 mt-0.5 shrink-0 ${
                entry.status === 'completed' ? 'text-emerald-400' : 'text-app-text'
              }`}
            />
            <span className={entry.status === 'completed' ? 'text-app-text line-through' : 'text-app-textStrong'}>
              {entry.content}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FileChangeItem({ item }: { item: ConversationFileChangeItem }) {
  const tone =
    item.action === 'created' ? 'text-emerald-400' : item.action === 'deleted' ? 'text-rose-400' : 'text-amber-300';
  return (
    <details className="rounded border border-app-border bg-[#0b0d10] px-2.5 py-1.5">
      <summary className="flex items-center gap-2 text-[11.5px] cursor-pointer select-none list-none">
        <Icon name="chevron-right" className="w-3 h-3 text-app-text shrink-0" />
        <Icon name="file-code" className="w-3.5 h-3.5 shrink-0" />
        <span className={`font-medium ${tone}`}>{item.action}</span>
        <span className="font-mono text-app-textStrong truncate">{item.path}</span>
        {(item.additions || item.deletions) && (
          <span className="shrink-0 font-mono text-[10.5px]">
            <span className="text-emerald-400">+{item.additions ?? 0}</span>{' '}
            <span className="text-rose-400">-{item.deletions ?? 0}</span>
          </span>
        )}
      </summary>
      {item.patch && (
        <pre className="mt-1.5 px-2.5 py-2 border-t border-app-border/60 font-mono text-[11px] text-app-text whitespace-pre-wrap break-words max-h-96 overflow-auto">
          {item.patch}
        </pre>
      )}
    </details>
  );
}

function StatusItem({ item }: { item: ConversationStatusItem }) {
  // Busy and idle are the adapter's heartbeat, not news. Showing them turns a
  // quiet turn into a flickering log.
  if (item.label === 'busy' || item.label === 'idle') return null;
  return (
    <div className="flex items-center gap-2 text-[11px] text-amber-400/90">
      <Icon name="refresh-cw" className="w-3 h-3 shrink-0" />
      <span className="text-app-textStrong">{item.label}</span>
      {item.detail && <span className="truncate">{item.detail}</span>}
    </div>
  );
}

function ErrorItem({ item }: { item: ConversationErrorItem }) {
  return (
    <div className="flex items-start gap-2 rounded border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 text-[11.5px] text-rose-300">
      <Icon name="alert-octagon" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="break-words">{item.message}</span>
    </div>
  );
}

/**
 * A question the agent asked.
 *
 * The answer is sent as an answer, not as a message, so the agent continues the
 * work it was in the middle of. The resolved answer stays visible afterwards so
 * the transcript records what was decided.
 */
function QuestionItem({ item, messageId }: { item: ConversationQuestionItem; messageId: string }) {
  const { answerRequest, answerable } = useAnswers();
  const pending = item.status === 'pending' && answerable;
  const [text, setText] = useState('');

  if (item.answer) {
    return (
      <div className="rounded border border-sky-500/20 bg-sky-500/5 px-2.5 py-1.5 text-[11.5px]">
        <div className="flex items-start gap-2 text-sky-300">
          <Icon name="help-circle" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="break-words">{item.question}</span>
        </div>
        <div className="mt-1 pl-5.5 text-app-text">
          <span className="text-app-text">Answered: </span>
          <span className="text-app-textStrong">{item.answer}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-sky-500/30 bg-sky-500/5 px-2.5 py-2">
      <div className="flex items-start gap-2 text-[11.5px] text-sky-300">
        <Icon name="help-circle" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span className="break-words font-medium">{item.question}</span>
      </div>

      {pending && (
        <div className="mt-2 pl-5.5 space-y-1.5">
          {item.options.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {item.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void answerRequest(messageId, option.label)}
                  title={option.description}
                  className="px-2 py-1 rounded text-[11px] border border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 transition-colors"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <input
                type="text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && text.trim()) void answerRequest(messageId, text.trim());
                }}
                placeholder="Your answer…"
                className="flex-1 min-w-40 bg-app-bg border border-app-border rounded px-2 py-1 text-[11px] text-app-textStrong focus:outline-none focus:border-sky-500"
              />
              <button
                type="button"
                disabled={!text.trim()}
                onClick={() => void answerRequest(messageId, text.trim())}
                className="px-2.5 py-1 rounded text-[11px] font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-40"
              >
                Answer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A permission the agent asked for. */
function PermissionItem({ item, messageId }: { item: ConversationPermissionItem; messageId: string }) {
  const { answerRequest, answerable } = useAnswers();
  const pending = item.status === 'pending' && answerable;
  const [text, setText] = useState('');

  if (item.answer) {
    const allowed = item.answer.toLowerCase().startsWith('y');
    return (
      <div className={`rounded border px-2.5 py-1.5 text-[11.5px] ${allowed ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-rose-500/20 bg-rose-500/5'}`}>
        <div className="flex items-start gap-2">
          <Icon name={allowed ? 'shield-alert' : 'circle-slash'} className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${allowed ? 'text-emerald-400' : 'text-rose-400'}`} />
          <div className="min-w-0">
            <div className={allowed ? 'text-emerald-300' : 'text-rose-300'}>
              {allowed ? 'Allowed' : 'Refused'}
              {item.command ? ` · ${item.command}` : ''}
            </div>
            {item.detail && <div className="text-app-text break-words">{item.detail}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
      <div className="flex items-start gap-2 text-[11.5px] text-amber-300">
        <Icon name="shield-alert" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold">Permission required</div>
          {item.detail && <div className="opacity-90 break-words">{item.detail}</div>}
          {item.command && (
            <pre className="mt-1.5 font-mono text-[11px] bg-[#09090b] border border-app-border rounded px-2 py-1 whitespace-pre-wrap break-words">
              {item.command}
            </pre>
          )}
        </div>
      </div>

      {pending && (
        <div className="mt-2 pl-5.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void answerRequest(messageId, 'yes, continue')}
            className="px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-600/90 hover:bg-emerald-500 text-white transition-colors"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => void answerRequest(messageId, 'no, stop and explain what is blocked')}
            className="px-2.5 py-1 rounded text-[11px] font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 transition-colors"
          >
            Deny
          </button>
          <input
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && text.trim()) void answerRequest(messageId, text.trim());
            }}
            placeholder="Or answer in your own words…"
            className="flex-1 min-w-40 bg-app-bg border border-app-border rounded px-2 py-1 text-[11px] text-app-textStrong focus:outline-none focus:border-amber-500"
          />
        </div>
      )}
    </div>
  );
}

/**
 * How an answer reaches the agent.
 *
 * The blocks need the store's answer action, but importing the store here would
 * make every item a consumer of the whole app state. A narrow context keeps the
 * dependency to the one function that matters, and keeps the delivery path in a
 * single place: the store, not the components.
 */
const AnswersContext = createContext<{
  answerRequest: (requestId: string, answer: string) => Promise<void>;
  /** False when the message holding the request is not on screen. */
  answerable: boolean;
}>({ answerRequest: async () => undefined, answerable: false });

export function AnswersProvider({
  value,
  children,
}: {
  value: { answerRequest: (requestId: string, answer: string) => Promise<void>; answerable: boolean };
  children: ReactNode;
}) {
  return <AnswersContext.Provider value={value}>{children}</AnswersContext.Provider>;
}

function useAnswers() {
  return useContext(AnswersContext);
}

/** Keeps the newest item in view while a turn is still arriving. */
export function useFollowOutput(active: boolean, dependency: unknown) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    ref.current?.scrollIntoView({ block: 'end' });
  }, [dependency, active]);
  return ref;
}
