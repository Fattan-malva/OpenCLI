import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  AdapterRequest,
  AdapterSession,
  AdapterConfigs,
  ChatMessage,
  ConfirmationPolicy,
  ChatThread,
  GlobalStatus,
  InteractionMode,
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
  chatThreads: ChatThread[];
  activeThread: ChatThread | null;
  chatMessages: ChatMessage[];
  chatRequests: Record<string, AdapterRequest>;
  loadChatThreads: (projectId: string) => Promise<void>;
  createChat: (input?: { text?: string; title?: string; adapterId?: string; mode?: string }) => Promise<void>;
  selectChatThread: (threadId: string) => Promise<void>;
  sendChat: (text: string, adapterId?: string, mode?: string, interactionMode?: InteractionMode, confirmationPolicy?: ConfirmationPolicy) => Promise<void>;
  stopChat: () => Promise<void>;
  deleteChatThread: (threadId: string) => Promise<void>;
  executeChatPlan: () => Promise<void>;
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
  const [page, setPage] = useState<PageId>('workspace');
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
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatRequests, setChatRequests] = useState<Record<string, AdapterRequest>>({});
  const loadedThreadRef = useRef<string | null>(null);

  const showPage = (p: PageId) => setPage(p);
  const switchRightTab = (t: RightTab) => setRightTab(t);

  const addLog = (type: string, message: string | Record<string, unknown>, agentId?: string, taskId?: string) => {
    setLogs((prev) => [...prev, { time: formatLogTime(), type, message, agentId, taskId }]);
  };

  const dismissToast = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const showToast = (title: string, message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, title, message, type }]);
    window.setTimeout(() => dismissToast(id), 4000);
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
    setChatThreads([]);
    setChatMessages([]);
    setActiveThreadId(null);
    setScreen('auth');
  }, [activeProject, stopProjectSessions]);

  const goToProjects = useCallback(async (): Promise<void> => {
    if (activeProject) await stopProjectSessions(activeProject.id);
    setActiveProject(null);
    setActiveWorkflow(null);
    setWorkflows([]);
    setTasks([]);
    setLogs([]);
    setChatThreads([]);
    setChatMessages([]);
    setActiveThreadId(null);
    setPage('workspace');
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
        setPage('workspace');
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

  const activeThread = useMemo(
    () => chatThreads.find((thread) => thread.id === activeThreadId) ?? null,
    [chatThreads, activeThreadId],
  );

  const loadChatThreads = useCallback(async (projectId: string): Promise<void> => {
    try {
      const list = await api.listChatThreads(projectId);
      setChatThreads(list);
      setActiveThreadId((current) => {
        if (current && list.some((thread) => thread.id === current)) return current;
        return list[0]?.id ?? null;
      });
    } catch {
      setChatThreads([]);
    }
  }, []);

  const selectChatThread = useCallback(async (threadId: string): Promise<void> => {
    loadedThreadRef.current = null;
    setActiveThreadId(threadId);
  }, []);

  const createChat = useCallback(async (input?: { text?: string; title?: string; adapterId?: string; mode?: string }): Promise<void> => {
    if (!activeProject) {
      showToast('No Project', 'Open a project before starting a conversation.', 'warning');
      return;
    }
    try {
      const result = await api.createChatThread(activeProject.id, input ?? {});
      setChatThreads((prev) => [result.thread, ...prev.filter((thread) => thread.id !== result.thread.id)]);
      loadedThreadRef.current = result.thread.id;
      setActiveThreadId(result.thread.id);
      setChatMessages(result.messages);
      setChatRequests({});
    } catch (error: any) {
      showToast('Chat Failed', error?.message ?? 'Unable to start the conversation.', 'error');
    }
  }, [activeProject?.id, showToast]);

  const sendChat = useCallback(async (text: string, adapterId?: string, mode?: string, interactionMode?: InteractionMode, confirmationPolicy?: ConfirmationPolicy): Promise<void> => {
    if (!activeProject) {
      showToast('No Project', 'Open a project before sending a message.', 'warning');
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      if (!activeThreadId) {
        const created = await api.createChatThread(activeProject.id, { text: trimmed, adapterId, mode, interactionMode, confirmationPolicy });
        setChatThreads((prev) => [created.thread, ...prev.filter((thread) => thread.id !== created.thread.id)]);
        loadedThreadRef.current = created.thread.id;
        setActiveThreadId(created.thread.id);
        setChatMessages(created.messages);
        return;
      }
      const result = await api.sendChatMessage(activeProject.id, activeThreadId, { text: trimmed, adapterId, mode, interactionMode, confirmationPolicy });
      setChatThreads((prev) => prev.map((thread) => (thread.id === result.thread.id ? result.thread : thread)));
      setChatMessages(result.messages);
    } catch (error: any) {
      showToast('Message Failed', error?.message ?? 'Unable to send the message.', 'error');
    }
  }, [activeProject?.id, activeThreadId, showToast]);

  const stopChat = useCallback(async (): Promise<void> => {
    if (!activeProject || !activeThreadId) return;
    try {
      await api.stopChatThread(activeProject.id, activeThreadId);
      await Promise.all([loadChatThreads(activeProject.id), loadWorkflows(activeProject.id), loadTasks(activeProject.id)]);
      showToast('Stopped', 'Pending agent steps were cancelled.', 'info');
    } catch (error: any) {
      showToast('Stop Failed', error?.message ?? 'Unable to stop this conversation.', 'error');
    }
  }, [activeProject?.id, activeThreadId, loadChatThreads, loadWorkflows, loadTasks, showToast]);

  const deleteChatThread = useCallback(async (threadId: string): Promise<void> => {
    if (!activeProject) return;
    try {
      await api.deleteChatThread(activeProject.id, threadId);
      const remaining = chatThreads.filter((thread) => thread.id !== threadId);
      setChatThreads(remaining);
      if (activeThreadId === threadId) {
        loadedThreadRef.current = null;
        setActiveThreadId(remaining[0]?.id ?? null);
        setChatMessages([]);
        setChatRequests({});
      }
    } catch (error: any) {
      showToast('Delete Failed', error?.message ?? 'Unable to delete this conversation.', 'error');
    }
  }, [activeProject?.id, activeThreadId, chatThreads, showToast]);

  const executeChatPlan = useCallback(async (): Promise<void> => {
    if (!activeProject || !activeThreadId) return;
    try {
      const result = await api.executeChatPlan(activeProject.id, activeThreadId);
      await Promise.all([loadChatThreads(activeProject.id), loadWorkflows(activeProject.id), loadTasks(activeProject.id)]);
      if (result.started) {
        showToast('Executed', 'The plan is now running.', 'success');
      } else {
        showToast('Nothing to Execute', result.errors?.join(' ') ?? 'The plan could not be started.', 'warning');
      }
    } catch (error: any) {
      showToast('Execute Failed', error?.message ?? 'Unable to execute the plan.', 'error');
    }
  }, [activeProject?.id, activeThreadId, loadChatThreads, loadWorkflows, loadTasks, showToast]);

  const openProject = useCallback(async (project: ProjectRecord) => {
    if (activeProject && activeProject.id !== project.id) {
      await stopProjectSessions(activeProject.id);
    }
    setActiveProject(project);
    setScreen('app');
    setPage('workspace');
    setTasks([]);
    setLogs([]);
    setChatThreads([]);
    setChatMessages([]);
    setChatRequests({});
    loadedThreadRef.current = null;
    setActiveThreadId(null);
    await loadWorkflows(project.id);
    await loadAdapters();
    await Promise.all([loadTasks(project.id), loadEvents(project.id), loadSessions(project.id), loadChatThreads(project.id)]);
  }, [activeProject, stopProjectSessions, loadAdapters, loadSessions, loadTasks, loadWorkflows, loadEvents, loadChatThreads]);

  useEffect(() => {
    if (screen !== 'app' || !activeProject || !getToken()) return;

    const params = new URLSearchParams({ projectId: activeProject.id });
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
      'chat.thread_created',
      'chat.plan_ready',
    ]);

    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void Promise.all([
          loadWorkflows(activeProject.id),
          loadTasks(activeProject.id),
          loadSessions(activeProject.id),
          loadChatThreads(activeProject.id),
        ]);
      }, 120);
    };

    const upsertChatMessage = (
      threadId: string,
      message: {
        id: string;
        role: ChatMessage['role'];
        agentId?: string;
        taskId?: string;
        text?: string;
        status: ChatMessage['status'];
      },
      patch?: Partial<ChatMessage>,
    ) => {
      setChatMessages((prev) => {
        const index = prev.findIndex((item) => item.id === message.id);
        if (index === -1) {
          const now = new Date().toISOString();
          return [
            ...prev,
            {
              ...patch,
              id: message.id,
              threadId,
              role: message.role,
              agentId: message.agentId,
              taskId: message.taskId,
              text: message.text ?? '',
              status: message.status,
              createdAt: now,
              updatedAt: now,
            },
          ];
        }
        return prev.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item,
        );
      });
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

        const chatThreadId = typeof event.payload?.threadId === 'string' ? event.payload.threadId : undefined;
        const chatMessageId = typeof event.payload?.messageId === 'string' ? event.payload.messageId : undefined;
        const chatRole = (event.payload?.role === 'planner' || event.payload?.role === 'system'
          ? event.payload.role
          : 'agent') as ChatMessage['role'];

        if (chatThreadId && chatThreadId === activeThreadId) {
          if (event.type === 'chat.user_message') {
            const text = typeof event.payload?.text === 'string' ? event.payload.text : '';
            upsertChatMessage(
              chatThreadId,
              { id: chatMessageId!, role: chatRole, text, status: 'complete' },
            );
          } else if (!chatMessageId) {
            // no message to update
          } else if (event.type === 'chat.assistant_started') {
            const meta = event.payload?.meta as ChatMessage['meta'] | undefined;
            upsertChatMessage(
              chatThreadId,
              {
                id: chatMessageId,
                role: chatRole,
                agentId: event.agentId,
                taskId: event.taskId,
                status: 'pending',
              },
              meta ? { meta } : undefined,
            );
          } else if (event.type === 'chat.assistant_output') {
            const chunk = typeof event.payload?.text === 'string' ? event.payload.text : '';
            const request = event.payload?.request as AdapterRequest | undefined;
            const meta = event.payload?.meta as ChatMessage['meta'] | undefined;
            setChatMessages((prev) =>
              prev.map((item) =>
                item.id === chatMessageId
                  ? {
                      ...item,
                      status: 'streaming',
                      text: chunk ? `${item.text}${chunk}`.slice(-200_000) : item.text,
                      meta: meta ? { ...item.meta, ...meta } : item.meta,
                    }
                  : item,
              ),
            );
            if (request) {
              setChatRequests((prev) => ({ ...prev, [chatMessageId]: request }));
            }
            if (event.taskId && chunk) {
              setTasks((prev) => prev.map((task) =>
                task.id === event.taskId
                  ? { ...task, liveOutput: `${task.liveOutput ?? ''}${task.liveOutput ? '\n' : ''}${chunk}`.slice(-20_000) }
                  : task,
              ));
            }
          } else if (event.type === 'chat.assistant_completed') {
            setChatMessages((prev) =>
              prev.map((item) => (item.id === chatMessageId ? { ...item, status: 'complete' } : item)),
            );
          } else if (event.type === 'chat.assistant_failed') {
            setChatMessages((prev) =>
              prev.map((item) => (item.id === chatMessageId ? { ...item, status: 'error' } : item)),
            );
          } else if (event.type === 'chat.turn_interrupted') {
            setChatMessages((prev) =>
              prev.map((item) => (item.id === chatMessageId ? { ...item, status: 'interrupted' } : item)),
            );
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
  }, [screen, activeProject?.id, activeThreadId, loadWorkflows, loadTasks, loadSessions, loadChatThreads]);

  useEffect(() => {
    if (screen !== 'app' || !activeProject || !activeThreadId) return;
    if (loadedThreadRef.current === activeThreadId) return;
    loadedThreadRef.current = activeThreadId;
    void (async () => {
      try {
        setChatMessages(await api.listChatMessages(activeProject.id, activeThreadId));
        setChatRequests({});
      } catch {
        setChatMessages([]);
        setChatRequests({});
      }
    })();
  }, [activeThreadId, activeProject?.id, screen]);

  useEffect(() => {
    if (screen !== 'app' || !activeProject || !activeWorkflow?.id) return;
    void loadTasks(activeProject.id);
  }, [activeWorkflow?.id, screen, activeProject?.id, loadTasks]);

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
    chatThreads,
    activeThread,
    chatMessages,
    chatRequests,
    loadChatThreads,
    createChat,
    selectChatThread,
    sendChat,
    stopChat,
    deleteChatThread,
    executeChatPlan,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { ADAPTERS, COLOR_CLASSES, TOAST_STYLE, logTypeColor, providerRegistry, STATUS };