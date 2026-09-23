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
  ADAPTERS,
  initialAdapterConfigs,
  providerRegistry,
  STATUS,
} from './lib/data';
import { api, getToken, setToken } from './lib/api';
import type {
  AdapterInfo,
  AdapterSession,
  AdapterConfigs,
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
  kind: 'settings' | 'addTask' | 'adapterConfig' | 'newProject' | 'newWorkflow';
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
  createWorkflow: (name: string, description?: string) => Promise<boolean>;
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
  adapterConfigs: AdapterConfigs;
  saveAdapterConfig: (agentId: string, modes: AdapterConfigs[string]['modes']) => void;
  updateAgentRoute: (agentId: string, mode: string, field: 'provider' | 'model', value: string) => void;
  submitNewTask: (opts: { title: string; desc: string; agentId: string; mode: string; dependencies?: string[]; fileScopes?: string[] }) => Promise<boolean>;
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
  if (type.includes('question')) return 'text-sky-300';
  if (type.includes('confirmation') || type.includes('permission')) return 'text-amber-300';
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
  const [adapterConfigs, setAdapterConfigs] = useState<AdapterConfigs>(
    () => JSON.parse(JSON.stringify(initialAdapterConfigs)),
  );
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [sessions, setSessionsState] = useState<AdapterSession[]>([]);

  const showPage = (p: PageId) => setPage(p);
  const switchRightTab = (t: RightTab) => setRightTab(t);

  const addLog = (type: string, message: string | Record<string, unknown>, agentId?: string, taskId?: string) => {
    setLogs((prev) => [...prev, { time: formatLogTime(), type, message, agentId, taskId }]);
  };

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

  const stopProjectSessions = useCallback(async (projectId: string): Promise<void> => {
    try {
      await api.stopAllSessions(projectId);
    } catch (error) {
      console.warn('[OpenCLI] Could not stop project adapters:', error);
    }
    setSessionsState([]);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    if (activeProject) await stopProjectSessions(activeProject.id);
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setToken(null);
    setActiveProject(null);
    setActiveWorkflow(null);
    setWorkflows([]);
    setTasks([]);
    setLogs([]);
    setScreen('auth');
  }, [activeProject, stopProjectSessions]);

  const goToProjects = useCallback(async (): Promise<void> => {
    if (activeProject) await stopProjectSessions(activeProject.id);
    setActiveProject(null);
    setActiveWorkflow(null);
    setWorkflows([]);
    setTasks([]);
    setLogs([]);
    setPage('workflow');
    setScreen('projects');
  }, [activeProject, stopProjectSessions]);

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
    try {
      const events = await api.listEvents(activeProject.id, 200, workflow.id);
      setLogs(events.reverse().map((event) => ({
        time: new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions),
        type: event.type,
        message: event.payload,
        agentId: event.agentId,
        taskId: event.taskId,
      })));
    } catch {
      setLogs([]);
    }
  }, [activeProject?.id]);

  const createWorkflow = useCallback(async (name: string, description?: string): Promise<boolean> => {
    if (!activeProject) return false;

    try {
      const workflow = await api.createWorkflow(activeProject.id, name, description);
      setWorkflows((prev) => [workflow, ...prev]);
      setActiveWorkflow(workflow);
      setTasks([]);
      setLogs([]);
      setModal(null);
      const createdTasks = await api.getWorkflowTasks(workflow.id);
      setTasks(createdTasks.map(mapBackendTask));
      const createdEvents = await api.listEvents(activeProject.id, 200, workflow.id);
      setLogs(createdEvents.reverse().map((event) => ({
        time: new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions),
        type: event.type,
        message: event.payload,
        agentId: event.agentId,
        taskId: event.taskId,
      })));

      addLog('workflow.created', `Workflow created: ${workflow.name}`, 'system');
      return true;
    } catch {
      return false;
    }
  }, [activeProject?.id, addLog]);

  const loadTasks = useCallback(async (projectId: string): Promise<void> => {
    try {
      const workflowId = activeWorkflow?.projectId === projectId ? activeWorkflow.id : undefined;
      const list = workflowId
        ? await api.getWorkflowTasks(workflowId)
        : await api.listTasks(projectId);
      setTasks(list.map(mapBackendTask));
    } catch {
      setTasks([]);
    }
  }, [activeWorkflow?.id, activeWorkflow?.projectId]);

  const loadEvents = useCallback(async (projectId: string): Promise<void> => {
    try {
      const events = await api.listEvents(projectId, 200, activeWorkflow?.id);
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
  }, [activeWorkflow?.id]);

  const createProject = useCallback(
    async (name: string, path: string): Promise<boolean> => {
      try {
        const project = await api.createProject(name, path);
        await loadProjects();
        setActiveProject(project);
        setScreen('app');
        setPage('workflow');
        await loadWorkflows(project.id);
        setAdapters(await api.listAdapters());
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

  const openProject = useCallback(async (project: ProjectRecord) => {
    if (activeProject && activeProject.id !== project.id) {
      await stopProjectSessions(activeProject.id);
    }
    setActiveProject(project);
    setScreen('app');
    setPage('workflow');
    setTasks([]);
    setLogs([]);
    await loadWorkflows(project.id);
    await loadAdapters();
    await Promise.all([loadTasks(project.id), loadEvents(project.id), loadSessions(project.id)]);
  }, [activeProject, stopProjectSessions, loadAdapters, loadSessions, loadTasks, loadWorkflows, loadEvents]);

  useEffect(() => {
    if (screen !== 'app' || !activeProject || !getToken()) return;

    const params = new URLSearchParams({ projectId: activeProject.id });
    if (activeWorkflow?.id) params.set('workflowId', activeWorkflow.id);
    const stream = new EventSource(`/api/events/stream?${params.toString()}`);
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

        const eventTimestamp = event.timestamp;
        if (eventTimestamp) {
          setLogs((prev) => [
            ...prev,
            {
              time: new Date(eventTimestamp).toLocaleTimeString('en-US', {
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

        if (event.taskId) {
          const text = typeof event.payload?.text === 'string' ? event.payload.text : '';
          if (event.type === 'agent.output' && text) {
            setTasks((prev) => prev.map((task) =>
              task.id === event.taskId
                ? { ...task, liveOutput: `${task.liveOutput ?? ''}${task.liveOutput ? '\\n' : ''}${text}`.slice(-8000) }
                : task,
            ));
          } else if (event.type === 'agent.question' && text) {
            setTasks((prev) => prev.map((task) =>
              task.id === event.taskId
                ? {
                    ...task,
                    status: 'ASK',
                    liveRequest: { type: 'question', message: text },
                    agentRequest: { type: 'question', message: text },
                  }
                : task,
            ));
          } else if (event.type === 'agent.confirmation_requested' && text) {
            setTasks((prev) => prev.map((task) =>
              task.id === event.taskId
                ? {
                    ...task,
                    status: 'ASK',
                    liveRequest: { type: 'permission', message: text, command: text },
                    agentRequest: { type: 'permission', message: text, command: text },
                  }
                : task,
            ));
          }
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
  }, [screen, activeProject?.id, activeWorkflow?.id, loadWorkflows, loadTasks, loadSessions]);

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

  const saveAdapterConfig = (agentId: string, modes: AdapterConfigs[string]['modes']) => {
    setAdapterConfigs((prev) => ({ ...prev, [agentId]: { modes } }));
  };

  const updateAgentRoute = (
    agentId: string,
    mode: string,
    field: 'provider' | 'model',
    value: string,
  ) => {
    setAdapterConfigs((prev) => {
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
    const cfg = adapterConfigs[agentId]?.modes[mode];
    if (field === 'provider') {
      showToast('Routing Updated', `${agentId} [${mode}] now uses ${value} (${providerRegistry[value][0]})`, 'info');
      addLog('config.updated', `Changed ${agentId} mode '${mode}' to provider ${value}`, 'system');
    } else {
      showToast('Model Updated', `${agentId} [${mode}] now uses ${value}`, 'success');
      addLog('config.updated', `Changed ${agentId} mode '${mode}' to model ${value}`, 'system');
    }
  };

  const closeModal = () => setModal(null);

  const submitNewTask = async (opts: { title: string; desc: string; agentId: string; mode: string; dependencies?: string[]; fileScopes?: string[] }): Promise<boolean> => {
    if (!activeProject) {
      showToast('No Project', 'Open a project before creating a workflow task.', 'warning');
      return false;
    }
    try {
      const created = await api.createTask(activeProject.id, {
        title: opts.title,
        description: opts.desc,
        workflowId: activeWorkflow?.id,
        agentId: opts.agentId || undefined,
        modeId: opts.mode || undefined,
        dependencies: opts.dependencies ?? [],
        fileScopes: opts.fileScopes ?? [],
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
    createWorkflow,
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
    adapterConfigs,
    saveAdapterConfig,
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

export { ADAPTERS, COLOR_CLASSES, TOAST_STYLE, logTypeColor, providerRegistry, STATUS };