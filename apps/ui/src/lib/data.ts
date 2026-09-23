import type { AgentConfigs, AgentMeta, Task, TaskStatus, Workspace } from './types';

export const AGENTS: Record<string, AgentMeta> = {
  system: { name: 'OpenCLI Core', icon: 'server', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  claude: { name: 'Claude (Opus)', icon: 'cpu', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  codex: { name: 'Codex Agent', icon: 'code-2', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  opencode: { name: 'OpenCode', icon: 'terminal', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  aider: { name: 'Aider', icon: 'zap', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  kilo: { name: 'Kilo Agent', icon: 'ghost', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
};

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

export const initialTasks: Task[] = [
  {
    id: 'T001',
    title: 'Design Database Architecture',
    description: 'Create schema definitions for users, products, and orders.',
    status: 'COMPLETED',
    agentId: 'claude',
    mode: 'plan',
    workspace: 'main',
    dependencies: [],
  },
  {
    id: 'T002',
    title: 'Implement Auth Service',
    description: 'Setup JWT authentication and middleware.',
    status: 'RUNNING',
    agentId: 'codex',
    mode: 'build',
    workspace: 'worktree/T002',
    dependencies: ['T001'],
  },
  {
    id: 'T003',
    title: 'Develop Product API',
    description: 'CRUD operations for product catalog.',
    status: 'RUNNING',
    agentId: 'opencode',
    mode: 'build',
    workspace: 'worktree/T003',
    dependencies: ['T001'],
  },
  {
    id: 'T004',
    title: 'Frontend Product List',
    description: 'React components for product catalog.',
    status: 'PENDING',
    agentId: 'aider',
    mode: 'build',
    workspace: 'worktree/T004',
    dependencies: ['T003'],
  },
  {
    id: 'T005',
    title: 'Integration Testing',
    description: 'E2E tests for Auth and Products.',
    status: 'PENDING',
    agentId: 'claude',
    mode: 'test',
    workspace: 'worktree/T005',
    dependencies: ['T002', 'T003'],
  },
];

export const workspacesData: Workspace[] = [
  { id: 'main', branch: 'master', path: 'C:/Projects/marketplace', status: 'clean', locks: [] },
  { id: 'worktree/T002', branch: 'feat/auth-service', path: '.opencli/workspaces/T002', status: 'modified', locks: ['src/auth'] },
  { id: 'worktree/T003', branch: 'feat/product-api', path: '.opencli/workspaces/T003', status: 'conflict', locks: ['src/api', 'package.json'] },
  { id: 'worktree/T004', branch: 'feat/frontend-list', path: '.opencli/workspaces/T004', status: 'clean', locks: [] },
];

export const providerRegistry: Record<string, string[]> = {
  Anthropic: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  OpenAI: ['gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'],
  Google: ['gemini-1.5-pro', 'gemini-1.5-flash'],
  'Ollama (Local)': ['llama3', 'qwen2'],
};

export const initialAgentConfigs: AgentConfigs = {
  claude: {
    modes: {
      plan: { provider: 'Anthropic', model: 'claude-3-opus-20240229' },
      build: { provider: 'Anthropic', model: 'claude-3-sonnet-20240229' },
    },
  },
  codex: {
    modes: {
      build: { provider: 'OpenAI', model: 'gpt-4-turbo' },
    },
  },
  opencode: {
    modes: {
      plan: { provider: 'Anthropic', model: 'claude-3-opus-20240229' },
      build: { provider: 'Anthropic', model: 'claude-3-sonnet-20240229' },
      review: { provider: 'Google', model: 'gemini-1.5-pro' },
    },
  },
  aider: {
    modes: {
      build: { provider: 'OpenAI', model: 'gpt-4o' },
    },
  },
  kilo: {
    modes: {
      review: { provider: 'OpenAI', model: 'gpt-4o' },
      test: { provider: 'OpenAI', model: 'gpt-3.5-turbo' },
    },
  },
};