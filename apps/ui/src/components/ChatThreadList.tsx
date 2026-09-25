import { useStore } from '../store';
import { Icon } from '../lib/icons';

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function ChatThreadList() {
  const { chatThreads, activeThread, selectChatThread, createChat, deleteChatThread } = useStore();

  return (
    <div className="w-56 shrink-0 border-r border-app-border flex flex-col bg-app-surface/40 hidden md:flex">
      <div className="h-12 border-b border-app-border flex items-center justify-between px-3 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-app-text font-semibold">Conversations</span>
        <button
          onClick={() => void createChat()}
          className="p-1 rounded text-app-text hover:text-app-textStrong hover:bg-app-hover transition-colors"
          title="New conversation"
        >
          <Icon name="plus" className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {chatThreads.length === 0 && (
          <div className="text-[11px] text-app-text px-2 py-3">No conversations yet.</div>
        )}
        {chatThreads.map((thread) => (
          <div
            key={thread.id}
            className={`group flex items-center gap-1 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
              activeThread?.id === thread.id ? 'bg-app-hover border border-app-border' : 'hover:bg-app-hover/60 border border-transparent'
            }`}
          >
            <button
              onClick={() => void selectChatThread(thread.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="text-xs text-app-textStrong truncate">{thread.title}</div>
              <div className="text-[10px] text-app-text mt-0.5">{relativeTime(thread.updatedAt)}</div>
            </button>
            <button
              onClick={() => void deleteChatThread(thread.id)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded text-app-text hover:text-rose-400 transition-opacity"
              title="Delete conversation"
            >
              <Icon name="trash-2" className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
