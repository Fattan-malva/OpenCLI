import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useStore } from '../store';
import { adapterMeta } from '../lib/data';
import { AdapterIcon } from './AdapterIcon';
import { Icon } from '../lib/icons';
import { api } from '../lib/api';
import type { AdapterCapabilities, ConfirmationPolicy, InteractionMode } from '../lib/types';

/**
 * OpenCLI's own operating modes.
 *
 * These belong to OpenCLI rather than to any adapter, so they are fixed. What an
 * adapter contributes (its primary agents) is discovered from the CLI, and is
 * reached with `@` or `/` instead of a chip, so names like "plan" are never
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
  /** A rendered mark rather than an icon name, so the two chips match the app. */
  icon: ReactNode;
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
        open
          ? 'border-app-primary/50 bg-app-primary/10 text-app-textStrong'
          : 'border-app-border bg-app-surface text-app-text hover:bg-app-hover'
      }`}
    >
      {icon}
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

interface SlashCommand {
  /** The literal text that runs it, shown in the palette. */
  command: string;
  label: string;
  hint: string;
  icon: ReactNode;
  run: () => void;
}

export function ChatComposer() {
  const { sessions, sendChat, activeThread, activeProject, capabilities, loadCapabilities } = useStore();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [openMenu, setOpenMenu] = useState<'mode' | 'policy' | null>(null);
  // Ask is the default: it is the only mode with no side effects.
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('ask');
  const [confirmationPolicy, setConfirmationPolicy] = useState<ConfirmationPolicy>('default');
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [capModes, setCapModes] = useState<Record<string, AdapterCapabilities | null>>({});

  // The one adapter this conversation talks to. Distinct from "active":
  // several adapters can be active and available to a workflow while the chat
  // itself is addressed to exactly one. Set with `@` or `/`, not a chip.
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

  /**
   * Everything the two remaining chips control, plus the adapter target, in one
   * list.
   *
   * The chips are for the two settings a person changes rarely and thinks about
   * deliberately. The target changes per message, so it belongs in the message
   * where `@` already handles it and `/` now handles it without leaving residue
   * in the text.
   */
  const commands = useMemo<SlashCommand[]>(() => {
    const list: SlashCommand[] = [];

    for (const option of INTERACTION_MODES) {
      list.push({
        command: `/mode ${option.id}`,
        label: `OpenCLI mode: ${option.label}`,
        hint: option.hint,
        icon: <Icon name={option.icon} className="w-4 h-4" />,
        run: () => setInteractionMode(option.id),
      });
    }

    for (const option of POLICIES) {
      list.push({
        command: `/permission ${option.id}`,
        label: `OpenCLI permission: ${option.label}`,
        hint: option.hint,
        icon: <Icon name={option.icon} className="w-4 h-4" />,
        run: () => setConfirmationPolicy(option.id),
      });
    }

    for (const entry of modeEntries) {
      const isCurrent = entry.adapterId === chatAdapterId && entry.modeId === adapterMode;
      list.push({
        command: `/${entry.key}`,
        label: `${adapterMeta(entry.adapterId).name} in ${entry.modeId || 'its default mode'}`,
        hint: isCurrent ? 'current target' : 'send this message to this adapter and mode',
        icon: <AdapterIcon id={entry.adapterId} className="w-4 h-4" />,
        run: () => {
          setChatAdapterId(entry.adapterId);
          if (entry.modeId) setAdapterMode(entry.modeId);
        },
      });
    }

    return list;
  }, [modeEntries, interactionMode, confirmationPolicy, chatAdapterId, adapterMode]);

  const commandMatches = useMemo(() => {
    if (!slash) return [];
    const query = slash.query.trim().toLowerCase();
    if (!query) return commands;
    return commands.filter((entry) => entry.command.toLowerCase().startsWith(query));
  }, [slash, commands]);

  useEffect(() => {
    setPaletteIndex(0);
  }, [mention?.start, matches.length, slash?.start, commandMatches.length]);

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

  /**
   * Finds a trigger character typed at the start of a word.
   *
   * Both `@` and `/` are matched here so routing and commands feel the same in
   * the hands: type the sigil, type what you want, press Enter.
   */
  const findTrigger = (value: string, caret: number, sigil: string) => {
    const at = value.lastIndexOf(sigil, caret - 1);
    if (at < 0) return null;
    const tokenStart = at === 0 || /\s/.test(value[at - 1]!);
    const noGap = !/\s/.test(value.slice(at + 1, caret));
    if (!tokenStart || !noGap || caret <= at) return null;
    return { start: at, query: value.slice(at + 1, caret) };
  };

  const handleChange = (value: string) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    setMention(findTrigger(value, caret, '@'));
    setSlash(findTrigger(value, caret, '/'));
    setText(value);
  };

  /** Replaces the trigger token, so a command leaves no residue in the message. */
  const replaceToken = (start: number, replacement: string) => {
    const el = textareaRef.current;
    const end = el?.selectionStart ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const next = `${before}${replacement}${after}`;
    setText(next);
    const position = before.length + replacement.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(position, position);
    });
  };

  const insertMention = (entry: ModeEntry) => {
    if (!mention) return;
    const tag = `@${entry.adapterId}/${entry.modeId}`;
    replaceToken(mention.start, `${tag} `);
    // A mention is an explicit routing decision, so it also moves the
    // conversation's target rather than only annotating the text.
    setChatAdapterId(entry.adapterId);
    if (entry.modeId) setAdapterMode(entry.modeId);
    setMention(null);
  };

  const runCommand = (entry: SlashCommand) => {
    entry.run();
    setSlash(null);
    // A command is an action, not a word, so it is removed from the message.
    // The extra space keeps the next word from being glued to what precedes it.
    replaceToken(slash?.start ?? text.length, '');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const listLength = mention ? matches.length : slash ? commandMatches.length : 0;
    const open = mention ? matches.length > 0 : slash ? commandMatches.length > 0 : false;

    if (open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPaletteIndex((index) => (index + 1) % listLength);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPaletteIndex((index) => (index - 1 + listLength) % listLength);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const chosen = listLength > 0 ? (paletteIndex % listLength) : 0;
        if (mention) insertMention(matches[chosen]!);
        else runCommand(commandMatches[chosen]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (mention) setMention(null);
        else setSlash(null);
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
      setSlash(null);
    } finally {
      setSending(false);
    }
  };

  const modeOption = INTERACTION_MODES.find((item) => item.id === interactionMode) ?? INTERACTION_MODES[0];
  const policyOption = POLICIES.find((item) => item.id === confirmationPolicy) ?? POLICIES[0];
  const targetLabel = chatAdapterId
    ? `${chatAdapterId}${adapterMode ? `/${adapterMode}` : ''}`
    : null;

  const placeholder =
    running.length === 0
      ? 'Start an adapter session on the Adapters page to chat with agents'
      : interactionMode === 'ask'
        ? `Ask ${targetLabel ?? 'the selected adapter'} something. Only this adapter answers.`
        : interactionMode === 'plan'
          ? `Ask ${targetLabel ?? 'the selected adapter'} for a plan. Nothing runs until you execute it.`
          : 'Describe the work. It is planned, then routed across your active adapters.';

  return (
    <div className="border-t border-app-border bg-app-surface/60 shrink-0">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
        <div className="relative">
          {mention && matches.length > 0 && (
            <div className="absolute left-0 bottom-full mb-2 w-72 z-40 rounded-lg border border-app-border bg-app-surface shadow-lg shadow-black/40 p-1.5 space-y-0.5">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-app-text">Agents &amp; modes</div>
              {matches.map((entry, index) => {
                const meta = adapterMeta(entry.adapterId);
                const selected = index === paletteIndex;
                return (
                  <button
                    key={entry.key}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertMention(entry)}
                    onMouseEnter={() => setPaletteIndex(index)}
                    className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                      selected ? 'bg-app-primary/10' : 'hover:bg-app-hover'
                    }`}
                  >
                    <AdapterIcon id={entry.adapterId} className="w-4 h-4 shrink-0" />
                    <span className="text-xs text-app-textStrong">{meta.name}</span>
                    <span className="text-[10px] font-mono text-app-text">/</span>
                    <span className="text-[10px] font-mono text-app-primary">{entry.modeId}</span>
                    {selected && <Icon name="check" className="w-3.5 h-3.5 ml-auto shrink-0 text-app-primary" />}
                  </button>
                );
              })}
            </div>
          )}

          {slash && commandMatches.length > 0 && (
            <div className="absolute left-0 bottom-full mb-2 w-80 z-40 rounded-lg border border-app-border bg-app-surface shadow-lg shadow-black/40 p-1.5 space-y-0.5">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-app-text">Commands</div>
              {commandMatches.map((entry, index) => {
                const selected = index === paletteIndex;
                return (
                  <button
                    key={entry.command}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runCommand(entry)}
                    onMouseEnter={() => setPaletteIndex(index)}
                    className={`w-full flex items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                      selected ? 'bg-app-primary/10' : 'hover:bg-app-hover'
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">{entry.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-app-textStrong">
                        <span className="font-mono text-app-primary">{entry.command}</span>
                      </span>
                      <span className="block text-[10px] text-app-text mt-0.5">{entry.hint}</span>
                    </span>
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
              placeholder={placeholder}
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
          {/*
            Where this message is going.

            Deliberately not a chip: it is a readout, not a control. It has no
            border and no chevron, so it cannot be mistaken for something to open.
            Changing it is done with @ or /, which keeps the routing decision in
            the message instead of in a row of dropdowns nobody remembers.
          */}
          <span className="flex items-center gap-1.5 text-[11px] text-app-text/70 pr-1">
            {chatAdapterId ? (
              <AdapterIcon id={chatAdapterId} className="w-3.5 h-3.5" />
            ) : (
              <Icon name="bot" className="w-3.5 h-3.5" />
            )}
            <span className="font-mono">{targetLabel ?? 'no adapter running'}</span>
            <span className="text-app-text/50">@</span>
          </span>

          <div className="relative">
            <ChipControl
              icon={<Icon name={modeOption.icon} className="w-3.5 h-3.5" />}
              label="OpenCLI Mode"
              open={openMenu === 'mode'}
              onClick={() => setOpenMenu(openMenu === 'mode' ? null : 'mode')}
            />
            {openMenu === 'mode' && (
              <div className="absolute left-0 bottom-full mb-1 w-72 z-20 rounded-lg border border-app-border bg-app-surface shadow-lg shadow-black/20 p-1.5 space-y-0.5">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-app-text">
                  Now: {modeOption.label}
                </div>
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
            <ChipControl
              icon={<Icon name={policyOption.icon} className="w-3.5 h-3.5" />}
              label="OpenCLI Permission"
              open={openMenu === 'policy'}
              onClick={() => setOpenMenu(openMenu === 'policy' ? null : 'policy')}
            />
            {openMenu === 'policy' && (
              <div className="absolute left-0 bottom-full mb-1 w-72 z-20 rounded-lg border border-app-border bg-app-surface shadow-lg shadow-black/20 p-1.5 space-y-0.5">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-app-text">
                  Now: {policyOption.label}
                </div>
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
