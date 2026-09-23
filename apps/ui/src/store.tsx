import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  AGENTS,
  initialAgentConfigs,
  initialTasks,
  providerRegistry,
  STATUS,
} from './lib/data';
import { api, getToken, setToken } from './lib/api';
import type {
  AdapterInfo,
  AdapterSession,
  AgentConfigs,
  GlobalStatus,
  LogEntry,
  PageId,
  ProjectRecord,
  RightTab,
  Task,
  Toast,
  ToastType,
} from './lib/types';

export type AppScreen = 'boot' | 'auth' | 'projects' | 'app';

export interface ModalState {
  title: string;
  kind: 'settings' | 'addTask' | 'agentConfig' | 'newProject';
  agentId?: string;
}

export interface Store {
  screen: AppScreen;
  login: (pin: string) => Promise<boolean>;
  logout: () => Promise<void>;
  goToProjects: () => void;
  projects: ProjectRecord[];
  activeProject: ProjectRecord | null;
  loadProjects: () => Promise<void>;
  createProject: (name: string, path: string) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
  openProject: (project: ProjectRecord) => void;
  page: PageId;
  showPage: (p: PageId) => void;
  rightTab: RightTab;
  switchRightTab: (t: RightTab) => void;
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;
  paused: boolean;
  togglePauseAll: () => void;
  globalStatus: GlobalStatus;
  updateGlobalStatus: (text: string, color: GlobalStatus['color'], icon: string, pulse: boolean) => void;
  modal: ModalState | null;
  openModal: (m: ModalState) => void;
  closeModal: () => void;
  toasts: Toast[];
  showToast: (title: string, message: string, type?: ToastType) => void;
  dismissToast: (id: number) => void;
  logs: LogEntry[];
  addLog: (type: string, message: string | Record<string, unknown>, agentId?: string, taskId?: string) => void;
  clearLogs: () => void;
  terminalRef: RefObject<HTMLDivElement | null>;
  agentConfigs: AgentConfigs;
  saveAgentConfig: (agentId: string, modes: AgentConfigs[string]['modes']) => void;
  updateAgentRoute: (agentId: string, mode: string, field: 'provider' | 'model', value: string) => void;
  submitNewTask: (opts: { title: string; desc: string; agentId: string; mode: string }) => void;
  adapters: AdapterInfo[];
  loadAdapters: () => Promise<void>;
  setAdapterActive: (id: string, active: boolean) => Promise<void>;
  sessions: AdapterSession[];
  loadSessions: (projectId: string) => Promise<void>;
  refreshSessions: (projectId: string) => Promise<void>;
  setSessions: (sessions: AdapterSession[]) => void;
}

const COLOR_CLASSES: Record<GlobalStatus['color'], string> = {
  indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  sky: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
};

const TOAST_STYLE: Record<ToastType, { wrap: string; icon: string; iconColor: string }> = {
  info: { wrap: 'border-app-border bg-app-surface text-app-text', icon: 'info', iconColor: 'text-app-text' },
  success: { wrap: 'border-emerald-500/30 bg-[#0f172a] text-app-textStrong', icon: 'check-circle', iconColor: 'text-emerald-400' },
  error: { wrap: 'border-rose-500/30 bg-[#170f11] text-app-textStrong', icon: 'alert-circle', iconColor: 'text-rose-400' },
  warning: { wrap: 'border-amber-500/30 bg-[#1a160f] text-app-textStrong', icon: 'alert-triangle', iconColor: 'text-amber-400' },
};

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('StoreProvider missing');
  return ctx;
}

function logTypeColor(type: string): string {
  if (type.includes('error') || type.includes('failed')) return 'text-rose-400';
  if (type.includes('completed') || type.includes('success')) return 'text-emerald-400';
  if (type.includes('started') || type.includes('ready')) return 'text-indigo-400';
  if (type.includes('conflict') || type.includes('permission')) return 'text-amber-400';
  if (type.includes('output')) return 'text-slate-300';
  return 'text-app-text';
}

export function formatLogTime(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<AppScreen>('boot');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [page, setPage] = useState<PageId>('workflow');
  const [rightTab, setRightTab] = useState<RightTab>('todo');
  const [tasks, setTasks] = useState<Task[]>(() => JSON.parse(JSON.stringify(initialTasks)));
  const [paused, setPaused] = useState(false);
  const [globalStatus, setGlobalStatus] = useState<GlobalStatus>({
    text: 'Orchestrating (2 Agents Active)',
    color: 'indigo',
    icon: 'dot',
    pulse: true,
  });
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfigs>(
    () => JSON.parse(JSON.stringify(initialAgentConfigs)),
  );
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [sessions, setSessionsState] = useState<AdapterSession[]>([]);
  const simStarted = useRef(false);

  const showPage = (p: PageId) => setPage(p);
  const switchRightTab = (t: RightTab) => setRightTab(t);

  const login = useCallback(async (pin: string): Promise<boolean> => {
    try {
      const res = await api.login(pin);
      setToken(res.token);
      setScreen('projects');
      try {
        setProjects(await api.listProjects());
      } catch {
        setProjects([]);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setToken(null);
    setActiveProject(null);
    setScreen('auth');
  }, []);

  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      setProjects(await api.listProjects());
    } catch {
      setProjects([]);
    }
  }, []);

  const createProject = useCallback(
    async (name: string, path: string): Promise<boolean> => {
      try {
        const project = await api.createProject(name, path);
        await loadProjects();
        setActiveProject(project);
        setScreen('app');
        setPage('workflow');
        return true;
      } catch {
        return false;
      }
    },
    [loadProjects],
  );

  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    try {
      await api.deleteProject(id);
      setProjects((list) => list.filter((p) => p.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  const loadAdapters = useCallback(async (): Promise<void> => {
    try {
      setAdapters(await api.listAdapters());
    } catch {
      setAdapters([]);
    }
  }, []);

  const setAdapterActive = useCallback(async (id: string, active: boolean): Promise<void> => {
    const previous = adapters;
    setAdapters((list) => list.map((a) => (a.id === id ? { ...a, active } : a)));
    try {
      await api.setAdapterActive(id, active);
    } catch {
      setAdapters(previous);
    }
  }, [adapters]);

  const loadSessions = useCallback(async (projectId: string): Promise<void> => {
    try {
      setSessions(await api.listSessions(projectId));
    } catch {
      setSessions([]);
    }
  }, []);

  const refreshSessions = useCallback(async (projectId: string): Promise<void> => {
    await loadSessions(projectId);
  }, [loadSessions]);

  const setSessions = useCallback((sessions: AdapterSession[]) => {
    setSessionsState(sessions);
  }, []);

  const openProject = useCallback((project: ProjectRecord) => {
    setActiveProject(project);
    setScreen('app');
    setPage('workflow');
    // Load sessions for the project to show current status
    loadSessions(project.id).catch(() => undefined);
  }, [loadSessions]);

  useEffect(() => {
    if (screen === 'app') {
      loadAdapters();
    }
  }, [screen, loadAdapters]);

  const goToProjects = useCallback(() => {
    setActiveProject(null);
    setScreen('projects');
  }, []);

  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setScreen('auth');
        return;
      }
      try {
        await api.authStatus();
        setScreen('projects');
        try {
          setProjects(await api.listProjects());
        } catch {
          setProjects([]);
        }
      } catch {
        setToken(null);
        setScreen('auth');
      }
    })();
  }, []);

  const updateGlobalStatus = (
    text: string,
    color: GlobalStatus['color'],
    icon: string,
    pulse: boolean,
  ) => setGlobalStatus({ text, color, icon, pulse });

  const addLog = (type: string, message: string | Record<string, unknown>, agentId?: string, taskId?: string) => {
    setLogs((prev) => [...prev, { time: formatLogTime(), type, message, agentId, taskId }]);
  };

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs]);

  const clearLogs = () => setLogs([]);

  const dismissToast = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const showToast = (title: string, message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, title, message, type }]);
    window.setTimeout(() => dismissToast(id), 4000);
  };

  const togglePauseAll = () => {
    if (paused) {
      addLog('system.command', 'Resuming all active agents.');
      setTasks((prev) => prev.map((t) => (t.status === 'PAUSED' ? { ...t, status: 'RUNNING' } : t)));
      updateGlobalStatus('Orchestrating (2 Agents Active)', 'indigo', 'loader-2', true);
    } else {
      addLog('system.command', 'Pause signal sent to all agents.');
      setTasks((prev) => prev.map((t) => (t.status === 'RUNNING' ? { ...t, status: 'PAUSED' } : t)));
      updateGlobalStatus('System Paused', 'amber', 'pause-circle', false);
    }
    setPaused((p) => !p);
  };

  const saveAgentConfig = (agentId: string, modes: AgentConfigs[string]['modes']) => {
    setAgentConfigs((prev) => ({ ...prev, [agentId]: { modes } }));
  };

  const updateAgentRoute = (
    agentId: string,
    mode: string,
    field: 'provider' | 'model',
    value: string,
  ) => {
    setAgentConfigs((prev) => {
      const cfg = prev[agentId];
      if (!cfg) return prev;
      const modes = { ...cfg.modes, [mode]: { ...cfg.modes[mode] } };
      if (field === 'provider') {
        modes[mode].provider = value;
        modes[mode].model = providerRegistry[value][0];
      } else {
        modes[mode].model = value;
      }
      return { ...prev, [agentId]: { modes } };
    });
    const cfg = agentConfigs[agentId]?.modes[mode];
    if (field === 'provider') {
      showToast('Routing Updated', `${agentId} [${mode}] now uses ${value} (${providerRegistry[value][0]})`, 'info');
      addLog('config.updated', `Changed ${agentId} mode '${mode}' to provider ${value}`, 'system');
    } else {
      showToast('Model Updated', `${agentId} [${mode}] now uses ${value}`, 'success');
      addLog('config.updated', `Changed ${agentId} mode '${mode}' to model ${value}`, 'system');
    }
  };

  const closeModal = () => setModal(null);

  const submitNewTask = (opts: { title: string; desc: string; agentId: string; mode: string }) => {
    const id = 'T00' + (tasks.length + 1);
    const newTask: Task = {
      id,
      title: opts.title,
      description: opts.desc,
      status: 'PENDING',
      agentId: opts.agentId,
      mode: opts.mode,
      workspace: 'worktree/' + id,
      dependencies: [],
    };
    setTasks((prev) => [...prev, newTask]);
    closeModal();
    showToast('Task Queued', `Task ${id} has been added to the planner.`, 'success');
    addLog('task.created', `New task added: ${opts.title}`, 'system', id);
  };

  // Boot simulation replicating reference.html startSimulation()
  useEffect(() => {
    if (simStarted.current) return;
    simStarted.current = true;

    addLog('system.boot', 'OpenCLI Core initialized.');
    addLog('workspace.manager', 'Detected 1 main repository, 3 active worktrees.');

    const t1 = window.setTimeout(() => {
      addLog('agent.output', 'Compiling TypeScript models...', 'codex', 'T002');
    }, 2000);

    const t2 = window.setTimeout(() => {
      addLog('agent.permission_requested', 'Command execution blocked by policy.', 'codex', 'T002');
      setTasks((prev) =>
        prev.map((t) =>
          t.id === 'T002'
            ? {
                ...t,
                status: 'ASK',
                agentRequest: {
                  type: 'permission',
                  message: 'I need to install the argon2 package to implement secure password hashing.',
                  command: 'npm install argon2 --save',
                },
              }
            : t,
        ),
      );
      updateGlobalStatus('Input Required', 'sky', 'message-square-dashed', true);
    }, 4500);

    const t3 = window.setTimeout(() => {
      addLog('agent.tool_called', { tool: 'readFile', file: 'src/api/routes.ts' }, 'opencode', 'T003');
    }, 6000);

    const t4 = window.setTimeout(() => {
      addLog('agent.ask', 'Requesting architectural decision from user.', 'opencode', 'T003');
      setTasks((prev) =>
        prev.map((t) =>
          t.id === 'T003'
            ? {
                ...t,
                status: 'ASK',
                agentRequest: {
                  type: 'choice',
                  message: 'Should I implement the Product API using REST or GraphQL? Both are supported in the codebase context.',
                  options: [
                    'Use standard REST endpoints (Express.js)',
                    'Setup a GraphQL schema and resolvers',
                  ],
                },
              }
            : t,
        ),
      );
    }, 8500);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: Store = {
    screen,
    login,
    logout,
    goToProjects,
    projects,
    activeProject,
    loadProjects,
    createProject,
    deleteProject,
    openProject,
    page,
    showPage,
    rightTab,
    switchRightTab,
    tasks,
    setTasks,
    paused,
    togglePauseAll,
    globalStatus,
    updateGlobalStatus,
    modal,
    openModal: setModal,
    closeModal,
    toasts,
    showToast,
    dismissToast,
    logs,
    addLog,
    clearLogs,
    terminalRef,
    agentConfigs,
    saveAgentConfig,
    updateAgentRoute,
    submitNewTask,
    adapters,
    loadAdapters,
    setAdapterActive,
    sessions,
    loadSessions,
    refreshSessions,
    setSessions,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { AGENTS, COLOR_CLASSES, TOAST_STYLE, logTypeColor, providerRegistry, STATUS };