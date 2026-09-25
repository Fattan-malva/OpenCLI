import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../lib/icons';
import type { ConfirmationPolicy, InteractionMode } from '../lib/types';

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

export function ChatComposer() {
  const { sessions, sendChat, activeThread } = useStore();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [openMenu, setOpenMenu] = useState<'mode' | 'policy' | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('agent');
  const [confirmationPolicy, setConfirmationPolicy] = useState<ConfirmationPolicy>('default');

  const running = useMemo(
    () => sessions.filter((session) => session.status === 'running'),
    [sessions],
  );

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

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await sendChat(trimmed, undefined, undefined, interactionMode, confirmationPolicy);
      setText('');
    } finally {
      setSending(false);
    }
  };

  const modeOption = INTERACTION_MODES.find((item) => item.id === interactionMode) ?? INTERACTION_MODES[0];
  const policyOption = POLICIES.find((item) => item.id === confirmationPolicy) ?? POLICIES[0];

  return (
    <div className="border-t border-app-border bg-app-surface/60 shrink-0">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder={
              running.length === 0
                ? 'Start an adapter session on the Adapters page to chat with agents'
                : activeThread
                  ? interactionMode === 'ask'
                    ? 'Describe a task to run read-only across every running adapter'
                    : 'Give a task or ask a follow-up. Mode decides how the adapters cooperate.'
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

          <span className="text-[10px] text-app-text">
            {modeOption.hint} · {policyOption.hint}
          </span>
        </div>

        <div className="text-[10px] text-app-text mt-1.5">Enter to send, Shift+Enter for a new line.</div>
      </div>
    </div>
  );
}