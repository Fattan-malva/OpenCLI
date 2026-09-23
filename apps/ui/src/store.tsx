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
  WorkflowRecord,
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
  workflows: WorkflowRecord[];
  activeWorkflow: WorkflowRecord | null;
  loadWorkflows: (projectId: string) => Promise<void>;
  loadTasks: (projectId: string) => Promise<void>;
  loadEvents: (projectId: string) => Promise<void>;
  selectWorkflow: (workflow: WorkflowRecord) => Promise<void>;
  paused: boolean;
  togglePauseAll: () => Promise<void>;
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
  submitNewTask: (opts: { title: string; desc: string; agentId: string; mode: string }) => Promise<boolean>;
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

function mapBackendTask(task: {
  id: string;
  workflowId?: string;
  title: string;
  description?: string;
  status: string;
  agentId?: string;
  modeId?: string;
  workspaceId?: string;
  dependencies: string[];
}): Task {
  const statusMap: Record<string, Task['status']> = {
    pending: 'PENDING',
    ready: 'READY',
    running: 'RUNNING',
    paused: 'PAUSED',
    failed: 'FAILED',
    blocked: 'BLOCKED',
    review: 'REVIEW',
    completed: 'COMPLETED',
    cancelled: 'FAILED',
  };
  return {
    id: task.id,
    workflowId: task.workflowId,
    title: task.title,
    description: task.description ?? '',
    status: statusMap[task.status] ?? 'PENDING',
    agentId: task.agentId ?? 'system',
    mode: task.modeId ?? 'build',
    workspace: task.workspaceId ?? 'project',
    dependencies: task.dependencies,
  };
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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowRecord | null>(null);
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

  const loadWorkflows = useCallback(async (projectId: string): Promise<void> => {
    try {
      const list = await api.listWorkflows(projectId);
      setWorkflows(list);
      setActiveWorkflow((current) => {
        if (current) {
          const refreshed = list.find((workflow) => workflow.id === current.id);
          if (refreshed) return refreshed;
        }
        return list.find((workflow) => workflow.status === 'running' || workflow.status === 'paused') ?? list[0] ?? null;
      });
    } catch {
      setWorkflows([]);
      setActiveWorkflow(null);
    }
  }, []);

  const selectWorkflow = useCallback(async (workflow: WorkflowRecord): Promise<void> => {
    setActiveWorkflow(workflow);
    if (!activeProject) return;
    try {
      const list = await api.getWorkflowTasks(workflow.id);
      setTasks(list.map(mapBackendTask));
    } catch {
      setTasks([]);
    }
  }, [activeProject?.id, loadEvents]);

  const loadTasks = useCallback(async (projectId: string): Promise<void> => {
    try {
      const list = await api.listTasks(projectId);
      setTasks(list.map(mapBackendTask));
    } catch {
      setTasks([]);
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
        await loadWorkflows(project.id);
        await loadTasks(project.id);
        await loadEvents(project.id);
        return true;
      } catch {
        return false;
      }
    },
    [loadProjects, loadTasks, loadWorkflows, loadEvents],
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

  const loadEvents = useCallback(async (projectId: string): Promise<void> => {
    try {
      const events = await api.listEvents(projectId, 200);
      setLogs(events.reverse().map((event) => ({
        time: new Date(event.timestamp).toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          fractionalSecondDigits: 3,
        } as Intl.DateTimeFormatOptions),
        type: event.type,
        message: event.payload,
        agentId: event.agentId,
        taskId: event.taskId,
      })));
    } catch {
      setLogs([]);
    }
  }, []);

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
    setTasks([]);
    setLogs([]);
    void Promise.all([loadWorkflows(project.id), loadTasks(project.id), loadEvents(project.id), loadSessions(project.id)]);
  }, [loadSessions, loadTasks, loadWorkflows]);

  useEffect(() => {
    if (screen !== 'app' || !activeProject || !getToken()) return;

    const stream = new EventSource(`/api/events/stream?projectId=${encodeURIComponent(activeProject.id)}`);
    let refreshTimer: number | undefined;
    const stateEvents = new Set([
      'workflow.created',
      'workflow.started',
      'workflow.paused',
      'workflow.resumed',
      'workflow.completed',
      'workflow.failed',
      'workflow.cancelled',
      'task.ready',
      'task.started',
      'task.blocked',
      'task.completed',
      'task.failed',
      'task.retried',
      'task.cancelled',
      'workspace.created',
      'workspace.conflict',
      'workspace.released',
      'agent.started',
      'agent.completed',
      'agent.failed',
      'agent.crashed',
    ]);

    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void Promise.all([
          loadWorkflows(activeProject.id),
          loadTasks(activeProject.id),
          loadSessions(activeProject.id),
        ]);
      }, 120);
    };

    stream.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as {
          type?: string;
          projectId?: string;
          taskId?: string;
          agentId?: string;
          timestamp?: string;
          payload?: Record<string, unknown>;
        };
        if (!event.type || event.type === 'connected') return;
        if (event.projectId && event.projectId !== activeProject.id) return;

        if (event.timestamp) {
          setLogs((prev) => [
            ...prev,
            {
              time: new Date(event.timestamp).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3,
              } as Intl.DateTimeFormatOptions),
              type: event.type ?? 'event',
              message: event.payload ?? {},
              agentId: event.agentId,
              taskId: event.taskId,
            },
          ].slice(-1000));
        }

        if (stateEvents.has(event.type ?? '')) scheduleRefresh();
      } catch {
        // Ignore malformed event payloads.
      }
    };

    return () => {
      stream.close();
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [screen, activeProject?.id, loadWorkflows, loadTasks, loadSessions]);

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

  const togglePauseAll = useCallback(async (): Promise<void> => {
    if (!activeWorkflow) {
      showToast('No Workflow', 'There is no active workflow to pause or resume.', 'warning');
      return;
    }

    try {
      if (activeWorkflow.status === 'running') {
        await api.pauseWorkflow(activeWorkflow.id);
        setPaused(true);
        updateGlobalStatus('Workflow Paused', 'amber', 'pause-circle', false);
        addLog('workflow.paused', `Paused workflow ${activeWorkflow.id}`, 'system');
      } else if (activeWorkflow.status === 'paused') {
        await api.resumeWorkflow(activeWorkflow.id);
        setPaused(false);
        updateGlobalStatus('Workflow Running', 'indigo', 'loader-2', true);
        addLog('workflow.resumed', `Resumed workflow ${activeWorkflow.id}`, 'system');
      }

      const projectId = activeProject?.id ?? activeWorkflow.projectId;
      await Promise.all([loadWorkflows(projectId), loadTasks(projectId)]);
    } catch (error: any) {
      showToast('Workflow Error', error?.message ?? 'Unable to change workflow state.', 'error');
    }
  }, [activeWorkflow, activeProject?.id, loadWorkflows, loadTasks, showToast]);

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

  const submitNewTask = async (opts: { title: string; desc: string; agentId: string; mode: string }): Promise<boolean> => {
    if (!activeProject) {
      showToast('No Project', 'Open a project before creating a workflow task.', 'warning');
      return false;
    }
    try {
      const created = await api.createTask(activeProject.id, {
        title: opts.title,
        description: opts.desc,
        workflowId: activeWorkflow?.id,
        agentId: opts.agentId,
        modeId: opts.mode,
      });
      const task = mapBackendTask(created);
      setTasks((prev) => [...prev, task]);
      await loadWorkflows(activeProject.id);
      closeModal();
      showToast('Task Queued', `Task ${task.id} has been added to the workflow.`, 'success');
      addLog('task.created', `New task added: ${opts.title}`, 'system', task.id);
      return true;
    } catch (error: any) {
      showToast('Task Failed', error?.message ?? 'Unable to create task.', 'error');
      return false;
    }
  };

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
    workflows,
    activeWorkflow,
    loadWorkflows,
    loadTasks,
    loadEvents,
    selectWorkflow,
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