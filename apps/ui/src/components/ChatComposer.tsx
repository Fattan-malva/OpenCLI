import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useStore } from '../store';
import { adapterMeta } from '../lib/data';
import { Icon } from '../lib/icons';
import { api } from '../lib/api';
import type { AdapterCapabilities, ConfirmationPolicy, InteractionMode } from '../lib/types';

const INTERACTION_MODES: Array<{ id: InteractionMode; label: string; icon: string; hint: string }> = [
  { id: 'ask', label: 'Ask', icon: 'eye', hint: 'same read-only prompt to every running adapter' },
  { id: 'plan', label: 'Plan', icon: 'list-checks', hint: 'planner builds a todo list — nothing runs until you execute' },
  { id: 'agent', label: 'Agent', icon: 'bot', hint: 'planner splits the work and the team executes it together' },
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
  const { sessions, sendChat, activeThread, activeProject } = useStore();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [openMenu, setOpenMenu] = useState<'mode' | 'policy' | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('agent');
  const [confirmationPolicy, setConfirmationPolicy] = useState<ConfirmationPolicy>('default');
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [capModes, setCapModes] = useState<Record<string, AdapterCapabilities | null>>({});

  const running = useMemo(
    () => sessions.filter((session) => session.status === 'running'),
    [sessions],
  );

  useEffect(() => {
    if (!activeProject || running.length === 0) {
      setCapModes({});
      return;
    }
    let cancelled = false;
    for (const session of running) {
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
  }, [activeProject?.id, running.map((session) => session.adapterId).join(',')]);

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
      await sendChat(trimmed, undefined, undefined, interactionMode, confirmationPolicy);
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
                  : activeThread
                    ? interactionMode === 'ask'
                      ? 'Describe a task to run read-only across every running adapter'
                      : 'Give a task or ask a follow-up. Type @ to hand it to a specific agent.'
                    : interactionMode === 'ask'
                      ? 'Describe a task to run read-only across every running adapter'
                      : 'Describe the task you want the agents to do'
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