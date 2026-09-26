import type { AdapterMeta, TaskStatus, Workspace } from './types';

/**
 * Presentation only: icon and colour for each CLI.
 *
 * Nothing here describes a CLI's behaviour. Modes, models and providers all come
 * from the server manifest, so an adapter missing from this map still renders
 * correctly via `adapterMeta`.
 */
export const ADAPTERS: Record<string, AdapterMeta> = {
  system: { name: 'OpenCLI Core', icon: 'server', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  claude: { name: 'Claude Code', icon: 'cpu', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  opencode: { name: 'OpenCode', icon: 'terminal', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  kilocode: { name: 'Kilo Code', icon: 'ghost', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  planner: { name: 'Planner', icon: 'workflow', color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
};

/**
 * Presentation metadata for any adapter id.
 *
 * Adapters absent from `ADAPTERS` fall back to a neutral style and the name the
 * server reported, so a newly installed CLI never renders blank.
 */
export function adapterMeta(agentId?: string, serverName?: string): AdapterMeta {
  const known = agentId ? ADAPTERS[agentId] : undefined;
  if (known) return serverName && agentId === 'claude' ? { ...known, name: serverName } : known;
  return {
    name: serverName || agentId || 'Adapter',
    icon: 'terminal',
    color: 'text-app-text',
    bg: 'bg-app-border/30',
    border: 'border-app-border',
  };
}

export interface StatusMeta {
  label: string;
  icon: string;
  classes: string;
}

export const STATUS: Record<TaskStatus, StatusMeta> = {
  PENDING: { label: 'Pending', icon: 'clock', classes: 'text-app-text bg-app-border/50 border-app-border' },
  READY: { label: 'Ready', icon: 'play-circle', classes: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
  RUNNING: { label: 'Running', icon: 'loader-2', classes: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20 animate-pulse-border' },
  PAUSED: { label: 'Paused', icon: 'pause-circle', classes: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  ASK: { label: 'Requires Input', icon: 'message-square-dashed', classes: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
  REVIEW: { label: 'Needs Review', icon: 'eye', classes: 'text-amber-400 bg-amber-500/10 border-amber-500/30 ring-1 ring-amber-500/50' },
  COMPLETED: { label: 'Completed', icon: 'check-circle-2', classes: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  BLOCKED: { label: 'Blocked', icon: 'ban', classes: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  FAILED: { label: 'Failed', icon: 'x-circle', classes: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
};

export const workspacesData: Workspace[] = [
  { id: 'main', branch: 'master', path: 'C:/Projects/marketplace', status: 'clean', locks: [] },
  { id: 'worktree/T002', branch: 'feat/auth-service', path: '.opencli/workspaces/T002', status: 'modified', locks: ['src/auth'] },
  { id: 'worktree/T003', branch: 'feat/product-api', path: '.opencli/workspaces/T003', status: 'conflict', locks: ['src/api', 'package.json'] },
  { id: 'worktree/T004', branch: 'feat/frontend-list', path: '.opencli/workspaces/T004', status: 'clean', locks: [] },
];