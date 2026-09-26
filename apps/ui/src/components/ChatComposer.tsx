import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useStore } from '../store';
import { adapterMeta } from '../lib/data';
import { Icon } from '../lib/icons';
import { api } from '../lib/api';
import type { AdapterCapabilities, ConfirmationPolicy, InteractionMode } from '../lib/types';

/**
 * OpenCLI's own operating modes.
 *
 * These belong to OpenCLI rather than to any adapter, so they are fixed. What an
 * adapter contributes (its primary agents) is discovered from the CLI, and is
 * shown in a separate "Adapter mode" chip so names like "ask" or "plan" are never
 * ambiguous between the two layers.
 */
const INTERACTION_MODES: Array<{ id: InteractionMode; label: string; icon: string; hint: string }> = [
  {
    id: 'ask',
    label: 'Ask',
    icon: 'eye',
    hint: 'ask the selected adapter only. No task, no workflow, nobody else runs',
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: 'list-checks',
    hint: 'the selected adapter writes a todo list. Nothing runs until you execute it',
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: 'bot',
    hint: 'plan the work, then route each step across your active adapters',
  },
];

const POLICIES: Array<{ id: ConfirmationPolicy; label: string; icon: string; hint: string }> = [
  { id: 'default', label: 'Default Permission', icon: 'shield-alert', hint: 'asks you before running anything' },
  { id: 'allowAll', label: 'Allow All', icon: 'circle-check', hint: 'auto-approves permissions, still asks questions' },
  { id: 'autoPilot', label: 'Auto Pilot', icon: 'zap', hint: 'auto-approves permissions and skips plan review' },
];

function ChipControl({
  icon,
  label,
  open,
  onClick,
}: {
  icon: string;
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
        open
          ? 'border-app-primary/50 bg-app-primary/10 text-app-textStrong'
          : 'border-app-border bg-app-surface text-app-text hover:bg-app-hover'
      }`}
    >
      <Icon name={icon} className="w-3.5 h-3.5" />
      <span>{label}</span>
      <Icon name="chevron-right" className={`w-3 h-3 transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
    </button>
  );
}

interface ModeEntry {
  adapterId: string;
  modeId: string;
  key: string;
}

export function ChatComposer() {
  const { sessions, sendChat, activeThread, activeProject, capabilities, loadCapabilities } = useStore();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [openMenu, setOpenMenu] = useState<'adapter' | 'adapterMode' | 'mode' | 'policy' | null>(null);
  // Ask is the default: it is the only mode with no side effects.
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('ask');
  const [confirmationPolicy, setConfirmationPolicy] = useState<ConfirmationPolicy>('default');
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [capModes, setCapModes] = useState<Record<string, AdapterCapabilities | null>>({});

  // The one adapter this conversation talks to. Distinct from "active":
  // several adapters can be active and available to a workflow while the chat
  // itself is addressed to exactly one.
  const [chatAdapterId, setChatAdapterId] = useState<string | null>(null);
  // That adapter's own primary mode, discovered from the CLI.
  const [adapterMode, setAdapterMode] = useState<string>('');

  const running = useMemo(
    () => sessions.filter((session) => session.status === 'running'),
    [sessions],
  );

  const runningIds = running.map((session) => session.adapterId);
  const runningKey = runningIds.join(',');

  // Restore the conversation's own adapter and mode, so switching threads does
  // not silently move the chat somewhere else.
  useEffect(() => {
    if (!activeThread) return;
    if (activeThread.chatAdapterId) setChatAdapterId(activeThread.chatAdapterId);
    if (activeThread.adapterMode) setAdapterMode(activeThread.adapterMode);
    if (activeThread.interactionMode) setInteractionMode(activeThread.interactionMode);
  }, [activeThread?.id, activeThread?.chatAdapterId, activeThread?.adapterMode, activeThread?.interactionMode]);

  // Fall back to the first running adapter only when the thread has no choice
  // yet. A stopped adapter is never silently replaced mid-conversation.
  useEffect(() => {
    if (chatAdapterId && runningIds.includes(chatAdapterId)) return;
    setChatAdapterId(activeThread?.chatAdapterId ?? runningIds[0] ?? null);
  }, [runningKey, activeThread?.chatAdapterId]);

  // Read each running CLI's own primary agents. Discovery is cached server-side,
  // so this is cheap after the first call.
  useEffect(() => {
    if (!activeProject || running.length === 0) {
      setCapModes({});
      return;
    }
    let cancelled = false;
    for (const session of running) {
      void loadCapabilities(session.adapterId);
      api
        .getProjectAdapterCapabilities(activeProject.id, session.adapterId)
        .then((caps) => {
          if (!cancelled) setCapModes((current) => ({ ...current, [session.adapterId]: caps }));
        })
        .catch(() => {
          if (!cancelled) setCapModes((current) => ({ ...current, [session.adapterId]: null }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, runningKey]);

  /** Primary agents the selected CLI reported, or nothing if it reported none. */
  const adapterModes = useMemo(() => {
    if (!chatAdapterId) return [] as string[];
    const fromCli = (capModes[chatAdapterId]?.modes ?? []).map((mode) => mode.id);
    if (fromCli.length > 0) return fromCli;
    return (capabilities[chatAdapterId]?.modes ?? []).map((mode) => mode.id);
  }, [chatAdapterId, capModes, capabilities]);

  // Keep the adapter mode valid for whichever adapter is selected.
  useEffect(() => {
    if (adapterModes.length === 0) {
      setAdapterMode('');
      return;
    }
    if (!adapterMode || !adapterModes.includes(adapterMode)) setAdapterMode(adapterModes[0]!);
  }, [adapterModes.join(','), adapterMode]);

  const modeEntries = useMemo(() => {
    const entries: ModeEntry[] = [];
    for (const session of running) {
      const caps = capModes[session.adapterId];
      const modes = caps?.modes ?? [];
      if (modes.length > 0) {
        for (const mode of modes) {
          entries.push({ adapterId: session.adapterId, modeId: mode.id, key: `${session.adapterId}/${mode.id}` });
        }
      } else {
        // No invented mode: fall back to what the session reports, else nothing.
        const fallback = session.activeMode ?? '';
        entries.push({ adapterId: session.adapterId, modeId: fallback, key: `${session.adapterId}/${fallback}` });
      }
    }
    return entries;
  }, [running, capModes]);

  const matches = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return modeEntries.filter((entry) => entry.key.toLowerCase().includes(query));
  }, [mention, modeEntries]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.start, matches.length]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openMenu]);

  const handleChange = (value: string) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;

    let nextMention: { start: number; query: string } | null = null;
    const atIndex = value.lastIndexOf('@', caret - 1);
    if (atIndex >= 0) {
      const tokenStart = atIndex === 0 || /\s/.test(value[atIndex - 1]);
      const noGap = !/\s/.test(value.slice(atIndex + 1, caret));
      if (tokenStart && noGap && caret > atIndex) {
        nextMention = {
          start: atIndex,
          query: value.slice(atIndex + 1, caret),
        };
      }
    }
    setMention(nextMention);
    setText(value);
  };

  const insertMention = (entry: ModeEntry) => {
    const el = textareaRef.current;
    if (!el || !mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(el.selectionStart);
    const tag = `@${entry.adapterId}/${entry.modeId}`;
    const next = `${before}${tag} ${after}`;
    setText(next);
    // A mention is an explicit routing decision, so it also moves the
    // conversation's target rather than only annotating the text.
    setChatAdapterId(entry.adapterId);
    if (entry.modeId) setAdapterMode(entry.modeId);
    const position = before.length + tag.length + 1;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(position, position);
    });
    setMention(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % matches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((index) => (index - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        insertMention(matches[mentionIndex % matches.length]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      // The message is addressed to exactly one adapter, in one of that
      // adapter's own modes. Interaction mode decides how it is handled.
      await sendChat(trimmed, chatAdapterId ?? undefined, adapterMode || undefined, interactionMode, confirmationPolicy);
      setText('');
      setMention(null);
    } finally {
      setSending(false);
    }
  };

  const modeOption = INTERACTION_MODES.find((item) => item.id === interactionMode) ?? INTERACTION_MODES[0];
  const policyOption = POLICIES.find((item) => item.id === confirmationPolicy) ?? POLICIES[0];

  return (
    <div className="border-t border-app-border bg-app-surface/60 shrink-0">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
        <div className="relative">
          {mention && matches.length > 0 && (
            <div className="absolute left-0 bottom-full mb-2 w-72 z-40 rounded-lg border border-app-border bg-app-surface shadow-lg shadow-black/40 p-1.5 space-y-0.5">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-app-text">Agents &amp; modes</div>
              {matches.map((entry, index) => {
                const meta = adapterMeta(entry.adapterId);
                const selected = index === mentionIndex % matches.length;
                return (
                  <button
                    key={entry.key}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertMention(entry)}
                    onMouseEnter={() => setMentionIndex(index)}
                    className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                      selected ? 'bg-app-primary/10' : 'hover:bg-app-hover'
                    }`}
                  >
                    <Icon name={meta.icon} className={`w-4 h-4 shrink-0 ${meta.color}`} />
                    <span className="text-xs text-app-textStrong">{entry.adapterId}</span>
                    <span className="text-[10px] font-mono text-app-text">/</span>
                    <span className="text-[10px] font-mono text-app-primary">{entry.modeId}</span>
                    {selected && <Icon name="check" className="w-3.5 h-3.5 ml-auto shrink-0 text-app-primary" />}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => handleChange(event.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder={
                running.length === 0
                  ? 'Start an adapter session on the Adapters page to chat with agents'
                  : interactionMode === 'ask'
                    ? `Ask ${chatAdapterId ?? 'the selected adapter'} something. Only this adapter answers.`
                    : interactionMode === 'plan'
                      ? `Ask ${chatAdapterId ?? 'the selected adapter'} for a plan. Nothing runs until you execute it.`
                      : 'Describe the work. It is planned, then routed across your active adapters.'
              }
              className="flex-1 resize-none bg-app-bg border border-app-border rounded-lg px-3 py-2 text-sm text-app-textStrong focus:outline-none focus:border-app-primary placeholder-app-text/50"
            />
            <button
              onClick={() => void submit()}
              disabled={!text.trim() || sending}
              className="px-3.5 py-2 rounded-lg bg-app-primary hover:bg-indigo-600 disabled:opacity-40 disabled:hover:bg-app-primary text-white transition-colors flex items-center gap-1.5 text-sm font-medium"
            >
              <Icon name="send" className="w-4 h-4" />
              Send
            </button>
          </div>
        </div>

        <div ref={boxRef} className="mt-2 flex items-center gap-2 flex-wrap">
          {/* Which single adapter this conversation talks to. */}
          <div className="relative">
            <ChipControl
              icon={chatAdapterId ? adapterMeta(chatAdapterId).icon : 'bot'}
              label={chatAdapterId ? adapterMeta(chatAdapterId).name : 'No adapter'}
              open={openMenu === 'adapter'}
              onClick={() => setOpenMenu(openMenu === 'adapter' ? null : 'adapter')}
            />
            {openMenu === 'adapter' && (
              <div className="absolute left-0 bottom-full mb-1 w-64 z-20 rounded-lg border border-app-border bg-app-surface shadow-lg shadow-black/20 p-1.5 space-y-0.5">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-app-text">
                  Chat with one adapter
                </div>
                {running.length === 0 && (
                  <div className="px-2 py-2 text-[11px] text-app-text">No adapter session is running.</div>
                )}
                {running.map((session) => {
                  const meta = adapterMeta(session.adapterId);
                  const selected = session.adapterId === chatAdapterId;
                  return (
                    <button
                      key={session.adapterId}
                      onClick={() => {
                        setChatAdapterId(session.adapterId);
                        setOpenMenu(null);
                      }}
                      className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                        selected ? 'bg-app-primary/10' : 'hover:bg-app-hover'
                      }`}
                    >
                      <Icon name={meta.icon} className={`w-4 h-4 shrink-0 ${meta.color}`} />
                      <span className="text-xs text-app-textStrong truncate">{meta.name}</span>
                      <span className="text-[10px] font-mono text-app-text">{session.adapterId}</span>
                      {selected && (
                        <Icon name="check" className="w-3.5 h-3.5 ml-auto shrink-0 text-app-primary" />
                      )}
                    </button>
                  );
                })}
                {running.length > 1 && (
                  <div className="px-2 py-1.5 text-[10px] text-app-text border-t border-app-border mt-1">
                    Active: {running.map((s) => s.adapterId).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* That adapter's own primary modes, exactly as the CLI reported them. */}
          {adapterModes.length > 0 && (
            <div className="relative">
              <ChipControl
                icon="terminal"
                label={adapterMode}
                open={openMenu === 'adapterMode'}
                onClick={() => setOpenMenu(openMenu === 'adapterMode' ? null : 'adapterMode')}
              />
              {openMenu === 'adapterMode' && (
                <div className="absolute left-0 bottom-full mb-1 w-56 z-20 rounded-lg border border-app-border bg-app-surface shadow-lg shadow-black/20 p-1.5 space-y-0.5">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-app-text">
                    {chatAdapterId} modes
                  </div>
                  {adapterModes.map((id) => {
                    const selected = id === adapterMode;
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          setAdapterMode(id);
                          setOpenMenu(null);
                        }}
                        className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                          selected ? 'bg-app-primary/10' : 'hover:bg-app-hover'
                        }`}
                      >
                        <span className="text-xs font-mono text-app-textStrong">{id}</span>
                        {selected && (
                          <Icon name="check" className="w-3.5 h-3.5 ml-auto shrink-0 text-app-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="relative">
            <ChipControl icon={modeOption.icon} label={modeOption.label} open={openMenu === 'mode'} onClick={() => setOpenMenu(openMenu === 'mode' ? null : 'mode')} />
            {openMenu === 'mode' && (
              <div className="absolute left-0 bottom-full mb-1 w-72 z-20 rounded-lg border border-app-border bg-app-surface shadow-lg shadow-black/20 p-1.5 space-y-0.5">
                {INTERACTION_MODES.map((option) => {
                  const selected = interactionMode === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        setInteractionMode(option.id);
                        setOpenMenu(null);
                      }}
                      className={`w-full flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                        selected ? 'bg-app-primary/10' : 'hover:bg-app-hover'
                      }`}
                    >
                      <Icon name={option.icon} className={`w-4 h-4 mt-0.5 shrink-0 ${selected ? 'text-app-primary' : 'text-app-text'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-app-textStrong">{option.label}</span>
                        <span className="block text-[10px] text-app-text mt-0.5">{option.hint}</span>
                      </span>
                      {selected && <Icon name="check" className="w-3.5 h-3.5 mt-1 shrink-0 text-app-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="relative">
            <ChipControl icon={policyOption.icon} label={policyOption.label} open={openMenu === 'policy'} onClick={() => setOpenMenu(openMenu === 'policy' ? null : 'policy')} />
            {openMenu === 'policy' && (
              <div className="absolute left-0 bottom-full mb-1 w-72 z-20 rounded-lg border border-app-border bg-app-surface shadow-lg shadow-black/20 p-1.5 space-y-0.5">
                {POLICIES.map((option) => {
                  const selected = confirmationPolicy === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        setConfirmationPolicy(option.id);
                        setOpenMenu(null);
                      }}
                      className={`w-full flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                        selected ? 'bg-app-primary/10' : 'hover:bg-app-hover'
                      }`}
                    >
                      <Icon name={option.icon} className={`w-4 h-4 mt-0.5 shrink-0 ${selected ? 'text-app-primary' : 'text-app-text'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-app-textStrong">{option.label}</span>
                        <span className="block text-[10px] text-app-text mt-0.5">{option.hint}</span>
                      </span>
                      {selected && <Icon name="check" className="w-3.5 h-3.5 mt-1 shrink-0 text-app-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}