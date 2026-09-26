import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLineBuffer,
  extractResponseText,
  parseOpencodeEvent,
  parseSessionLine,
} from '../apps/server/src/sessionProtocol.js';
import { formatActivity } from '../apps/server/src/chatRuntime.js';
import { assignDefaultAgents, buildPlannerPrompt, heuristicPlannerDecision, parseExecutionPlan, parsePlannerDecision } from '../apps/server/src/planner.js';
import { createWorkflowForPlan, parseMention, type ChatDeps } from '../apps/server/src/chat.js';
import type { PlanStep } from '@opencli/domain';
import { shouldAutoApprove } from '../apps/server/src/settings.js';
import { buildDependencyContext, type WorkflowRuntime } from '../apps/server/src/workflow.js';
import { OpenCLIRepository } from '../packages/db/src/index.js';
import { migrations } from '../packages/db/src/migrations/index.js';

const tempDirs: string[] = [];
const repos: OpenCLIRepository[] = [];

function makeRepo(): OpenCLIRepository {
  const dir = mkdtempSync(join(tmpdir(), 'opencli-chat-'));
  tempDirs.push(dir);
  const repo = new OpenCLIRepository({ path: join(dir, 'test.db') });
  repo.migrate(migrations);
  repos.push(repo);
  return repo;
}

afterEach(() => {
  while (repos.length > 0) {
    const repo = repos.pop();
    if (repo) repo.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('session protocol parsing', () => {
  it('buffers partial lines across chunks', () => {
    const buffer = createLineBuffer();
    expect(buffer.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(buffer.push('2}\n')).toEqual(['{"b":2}']);
  });

  it('extracts assistant text from claude stream-json', () => {
    const chunk = parseSessionLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello there' }] } }),
      'claude',
    );
    expect(chunk?.text).toBe('hello there');
  });

  it('extracts incremental deltas and marks the result event as done', () => {
    const delta = parseSessionLine(
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'par' } } }),
      'claude',
    );
    expect(delta?.text).toBe('par');

    const result = parseSessionLine(JSON.stringify({ type: 'result', result: 'done' }), 'claude');
    expect(result?.done).toBe(true);
    expect(result?.text).toBe('done');
  });

  it('surfaces claude permission control requests', () => {
    const chunk = parseSessionLine(
      JSON.stringify({
        type: 'control_request',
        request: { subtype: 'can_use_tool', tool_name: { name: 'Bash' }, input: { command: 'rm -rf build' } },
      }),
      'claude',
    );
    expect(chunk?.request?.type).toBe('permission');
    expect(chunk?.request?.command).toBe('rm -rf build');
  });

  it('parses plain text lines for serve adapters', () => {
    expect(parseSessionLine('opencode is booting', 'opencode')?.text).toBe('opencode is booting');
  });

  it('falls back to raw text for non-JSON output', () => {
    expect(parseSessionLine('plain log line', 'opencode')?.text).toBe('plain log line');
  });

  it('extracts text from a non-streaming JSON response', () => {
    expect(
      extractResponseText({ message: { content: [{ type: 'text', text: 'from message' }] } }),
    ).toBe('from message');
    expect(extractResponseText({ parts: [{ text: 'a' }, { text: 'b' }] })).toBe('ab');
    expect(extractResponseText({ info: { unrelated: true } })).toBe('');
  });
});

describe('opencode event stream (real payloads)', () => {
  it('reports the agent, mode and model of an assistant message', () => {
    const signals = parseOpencodeEvent({
      type: 'message.updated',
      properties: {
        sessionID: 'ses_1',
        info: {
          id: 'msg_1',
          role: 'assistant',
          agent: 'build',
          mode: 'build',
          providerID: 'opencode',
          modelID: 'big-pickle',
          time: { created: 1, completed: 2 },
        },
      },
    });
    expect(signals).toEqual([
      { type: 'assistant-message', messageId: 'msg_1', agent: 'build', mode: 'build', provider: 'opencode', model: 'big-pickle', completed: true, error: undefined },
    ]);
  });

  it('surfaces the provider error instead of hanging', () => {
    const signals = parseOpencodeEvent({
      type: 'session.error',
      properties: {
        sessionID: 'ses_1',
        error: { name: 'APIError', data: { message: 'Cannot connect to API: Unable to connect.' } },
      },
    });
    expect(signals).toEqual([{ type: 'error', message: 'Cannot connect to API: Unable to connect.' }]);
  });

  it('surfaces the retry notice as status', () => {
    const signals = parseOpencodeEvent({
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: { type: 'retry', attempt: 4, message: 'Cannot connect to API' } },
    });
    expect(signals).toEqual([{ type: 'status', value: 'retry', detail: 'Cannot connect to API' }]);
  });

  it('marks the turn done on idle status and session.idle', () => {
    expect(
      parseOpencodeEvent({ type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'idle' } } }),
    ).toEqual([{ type: 'idle' }]);
    expect(parseOpencodeEvent({ type: 'session.idle', properties: { sessionID: 'ses_1' } })).toEqual([
      { type: 'idle' },
    ]);
  });

  it('reads cumulative text parts and incremental deltas', () => {
    const updated = parseOpencodeEvent({
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_1',
        part: { id: 'prt_1', messageID: 'msg_1', type: 'text', text: 'hello world' },
      },
    });
    expect(updated).toEqual([
      { type: 'part', partId: 'prt_1', messageId: 'msg_1', kind: 'text', text: 'hello world' },
    ]);

    const delta = parseOpencodeEvent({
      type: 'message.part.delta',
      properties: { sessionID: 'ses_1', partID: 'prt_1', messageID: 'msg_1', delta: { text: 'more' } },
    });
    expect(delta).toEqual([
      { type: 'part', partId: 'prt_1', messageId: 'msg_1', kind: 'text', text: 'more', incremental: true },
    ]);
  });

  it('reads tool, reasoning, step and file parts', () => {
    const tool = parseOpencodeEvent({
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_1',
        part: { id: 'prt_t', messageID: 'msg_1', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'src/index.ts' } } },
      },
    });
    expect(tool[0]).toMatchObject({ kind: 'tool', label: 'read', status: 'completed' });

    const step = parseOpencodeEvent({
      type: 'message.part.updated',
      properties: { sessionID: 'ses_1', part: { id: 'prt_s', messageID: 'msg_1', type: 'step-start' } },
    });
    expect(step[0]).toMatchObject({ kind: 'step', label: 'working', status: 'busy' });

    const diff = parseOpencodeEvent({
      type: 'session.diff',
      properties: { sessionID: 'ses_1', files: [{ file: 'apps/server/src/index.ts' }] },
    });
    expect(diff[0]).toMatchObject({ kind: 'file', label: 'apps/server/src/index.ts', status: 'changed' });
  });

  it('reads permission and question requests', () => {
    const permission = parseOpencodeEvent({
      type: 'permission.updated',
      properties: { sessionID: 'ses_1', command: 'rm -rf build' },
    });
    expect(permission[0]).toMatchObject({ type: 'request', request: { type: 'permission', command: 'rm -rf build' } });

    const question = parseOpencodeEvent({
      type: 'question.asked',
      properties: { sessionID: 'ses_1', message: 'Which database should I use?' },
    });
    expect(question[0]).toMatchObject({ type: 'request', request: { type: 'question' } });
  });
});

describe('cli output formatting', () => {
  it('renders tool, thinking, file, retry and error lines', () => {
    expect(formatActivity({ kind: 'tool', label: 'read', detail: 'src/index.ts', status: 'started' })).toBe('⏺ read(src/index.ts)\n');
    expect(formatActivity({ kind: 'reasoning', label: 'thinking', detail: 'checking tests' })).toBe('✳ thinking checking tests\n');
    expect(formatActivity({ kind: 'file', label: 'src/index.ts', status: 'changed' })).toBe('✎ modified src/index.ts\n');
    expect(formatActivity({ kind: 'status', label: 'retry', detail: 'Cannot connect to API', status: 'retry' })).toBe('↻ retry: Cannot connect to API\n');
    expect(formatActivity({ kind: 'info', label: 'error', detail: 'boom', status: 'error' })).toBe('! error boom\n');
  });

  it('stays silent for busy and idle status to avoid duplicate lines', () => {
    expect(formatActivity({ kind: 'status', label: 'busy', status: 'busy' })).toBe('');
    expect(formatActivity({ kind: 'status', label: 'idle', status: 'idle' })).toBe('');
  });

  it('adds a line range from the first diff hunk on file activity', () => {
    const patch = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -12,4 +12,4 @@ export const a';
    expect(
      formatActivity({ kind: 'file', label: 'src/a.ts', detail: patch, status: 'changed' }),
    ).toBe('✎ modified src/a.ts (lines 12-15)\n');
    expect(
      formatActivity({ kind: 'file', label: 'src/b.ts', detail: '@@ -1 +1,3 @@', status: 'changed' }),
    ).toBe('✎ modified src/b.ts (lines 1-3)\n');
    expect(formatActivity({ kind: 'file', label: 'src/c.ts', detail: 'no hunks here', status: 'changed' })).toBe(
      '✎ modified src/c.ts\n',
    );
  });
});

describe('planner', () => {
  const context = {
    projectName: 'Demo',
    projectPath: 'C:/demo',
    agents: [{ id: 'opencode', name: 'OpenCode', modes: ['build', 'plan'] }],
  };

  it('includes the roster and the task in the prompt', () => {
    const prompt = buildPlannerPrompt('add login page', context);
    expect(prompt).toContain('opencode');
    expect(prompt).toContain('add login page');
  });

  it('parses a fenced json plan and drops unknown agents', () => {
    const text = [
      'Here is the plan:',
      '```json',
      JSON.stringify({
        steps: [
          { title: 'Design schema', description: 'write schema', agentId: 'ghost', fileScopes: ['db/**'], dependsOn: [] },
          { title: 'Implement API', agentId: 'opencode', fileScopes: ['src/api/**'], dependsOn: [0] },
        ],
      }),
      '```',
    ].join('\n');

    const plan = parseExecutionPlan(text, ['opencode']);
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps[0].agentId).toBeUndefined();
    expect(plan?.steps[1].agentId).toBe('opencode');
    expect(plan?.steps[1].dependsOn).toEqual([0]);
  });

  it('parses a bare json plan and removes forward dependencies', () => {
    const plan = parseExecutionPlan(
      '{"steps":[{"title":"A","dependsOn":[1]},{"title":"B"}]}',
      ['opencode'],
    );
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps[0].dependsOn).toEqual([]);
  });

  it('returns undefined when no plan can be found', () => {
    expect(parseExecutionPlan('I cannot help with that', ['opencode'])).toBeUndefined();
  });

  it('fills missing agent assignments round-robin', () => {
    const steps = assignDefaultAgents([{ title: 'A' }, { title: 'B' }, { title: 'C' }], ['opencode', 'claude']);
    expect(steps.map((step) => step.agentId)).toEqual(['opencode', 'claude', 'opencode']);
  });
});

describe('planner decision (v3)', () => {
  it('treats a legacy broadcast decision as a plan with no steps', () => {
    const decision = parsePlannerDecision('{"decision":"broadcast","reason":"read-only comparison"}', ['opencode', 'claude']);
    expect(decision.steps).toEqual([]);
    expect(decision.reason).toBe('read-only comparison');
  });

  it('normalizes a step list while dropping unknown agents and forward deps', () => {
    const decision = parsePlannerDecision(
      JSON.stringify({
        steps: [
          { title: 'A', agentId: 'ghost', fileScopes: ['db/**'], dependsOn: [] },
          { title: 'B', agentId: 'opencode', dependsOn: [0] },
        ],
      }),
      ['opencode'],
    );
    expect(decision.steps).toHaveLength(2);
    expect(decision.steps[0].agentId).toBeUndefined();
    expect(decision.steps[1].agentId).toBe('opencode');
    expect(decision.steps[0].fileScopes).toEqual(['db/**']);
  });

  it('accepts a bare steps-only plan', () => {
    const decision = parsePlannerDecision('{"steps":[{"title":"A"}]}', ['opencode']);
    expect(decision.steps[0].title).toBe('A');
  });

  it('falls back to a single delegated todo when no JSON is usable', () => {
    const decision = parsePlannerDecision('Fix the broken build', ['opencode']);
    expect(decision.steps).toHaveLength(1);
    expect(decision.steps[0].title).toBe('Run the task');
    expect(decision.steps[0].description).toContain('Fix the broken build');
  });

  it('heuristic always returns a todo list regardless of the ask', () => {
    expect(heuristicPlannerDecision('What is the deadlock?').steps).toHaveLength(1);
    expect(heuristicPlannerDecision('Implement a login page and fix the logout test').steps).toHaveLength(1);
  });
});

describe('confirmation policy', () => {
  it('auto-approves only permission requests on default and allow-all policies', () => {
    expect(shouldAutoApprove('default', { type: 'permission' })).toBe(false);
    expect(shouldAutoApprove('allowAll', { type: 'permission' })).toBe(true);
    expect(shouldAutoApprove('allowAll', { type: 'question' })).toBe(false);
    expect(shouldAutoApprove('allowAll', { type: 'choice' })).toBe(false);
  });

  it('auto-pilot auto-approves permissions but still surfaces questions and choices', () => {
    expect(shouldAutoApprove('autoPilot', { type: 'permission' })).toBe(true);
    expect(shouldAutoApprove('autoPilot', { type: 'question' })).toBe(false);
    expect(shouldAutoApprove('autoPilot', { type: 'choice' })).toBe(false);
  });
});

describe('dependency context handoff', () => {
  function makeCoopRepo(): { repo: OpenCLIRepository; main: ReturnType<OpenCLIRepository['createTask']>; dep: ReturnType<OpenCLIRepository['createTask']> } {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Demo', path: 'C:/demo', status: 'active' });
    const thread = repo.createChatThread({ projectId: project.id, title: 'Coop' });

    const dep = repo.createTask({
      projectId: project.id,
      workflowId: undefined,
      title: 'Build base API',
      status: 'pending',
      priority: 0,
      dependencies: [],
      fileScopes: ['src/api/**'],
      kind: 'chat',
      retryCount: 0,
      maxRetries: 1,
    });
    const message = repo.createChatMessage({ threadId: thread.id, role: 'agent', agentId: 'opencode', text: 'base API implemented and tested', status: 'streaming' });
    repo.updateChatMessage(message.id, { status: 'complete', taskId: dep.id });
    repo.updateTask(dep.id, { status: 'completed' });

    const main = repo.createTask({
      projectId: project.id,
      workflowId: undefined,
      title: 'Consume base API',
      status: 'pending',
      priority: 1,
      dependencies: [dep.id],
      fileScopes: ['src/app/**'],
      kind: 'chat',
      retryCount: 0,
      maxRetries: 1,
    });

    return { repo, main, dep };
  }

  it('appends completed dependency output to the dependents prompt', () => {
    const { repo, main, dep } = makeCoopRepo();
    const context = buildDependencyContext({ db: repo } as unknown as WorkflowRuntime, main);
    expect(context).toContain('base API implemented and tested');
    expect(context).toContain(`<from opencode — ${dep.title}>`);
    expect(context).toContain('do not redo it');
  });

  it('returns empty when the dependency is not completed', () => {
    const { repo, main } = makeCoopRepo();
    repo.updateTask(main.dependencies[0], { status: 'pending' });
    expect(buildDependencyContext({ db: repo } as unknown as WorkflowRuntime, main)).toBe('');
  });

  it('returns empty for a task without dependencies', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Demo', path: 'C:/demo', status: 'active' });
    const task = repo.createTask({
      projectId: project.id,
      workflowId: undefined,
      title: 'Solo task',
      status: 'pending',
      priority: 0,
      dependencies: [],
      fileScopes: [],
      kind: 'chat',
      retryCount: 0,
      maxRetries: 1,
    });
    expect(buildDependencyContext({ db: repo } as unknown as WorkflowRuntime, task)).toBe('');
  });
});

describe('chat mentions', () => {
  it('extracts a known adapter mention and strips it from the prompt', () => {
    expect(parseMention('@opencode fix the build', ['opencode', 'claude'])).toEqual({
      targetAdapterId: 'opencode',
      text: 'fix the build',
    });
  });

  it('keeps the text untouched when the mention is unknown', () => {
    const result = parseMention('@someone fix the build', ['opencode']);
    expect(result.targetAdapterId).toBeUndefined();
    expect(result.text).toBe('@someone fix the build');
  });

  it('parses a mention with a mode tag as adapter/mode', () => {
    const result = parseMention('@opencode/plan fix the build', ['opencode', 'claude']);
    expect(result.targetAdapterId).toBe('opencode');
    expect(result.mode).toBe('plan');
    expect(result.text).toBe('fix the build');
  });
});

describe('chat repository', () => {
  it('stores threads, appends streamed output and links messages to tasks', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Demo', path: 'C:/demo', status: 'active' });
    const thread = repo.createChatThread({ projectId: project.id, title: 'Fix login' });

    expect(repo.listChatThreads(project.id)).toHaveLength(1);
    expect(repo.getChatThread(thread.id)?.title).toBe('Fix login');

    const user = repo.createChatMessage({ threadId: thread.id, role: 'user', text: 'fix it', status: 'complete' });
    const agent = repo.createChatMessage({
      threadId: thread.id,
      role: 'agent',
      agentId: 'opencode',
      text: '',
      status: 'pending',
    });

    repo.appendChatMessageText(agent.id, 'working');
    repo.appendChatMessageText(agent.id, ' on it');

    const stored = repo.getChatMessage(agent.id);
    expect(stored?.text).toBe('working on it');
    expect(stored?.status).toBe('streaming');

    repo.updateChatMessage(agent.id, { status: 'complete' });
    expect(repo.getChatMessage(agent.id)?.status).toBe('complete');
    expect(repo.listChatMessages(thread.id).map((message) => message.id)).toEqual([user.id, agent.id]);

    const task = repo.createTask({
      projectId: project.id,
      workflowId: undefined,
      title: 'Step 1',
      status: 'pending',
      priority: 0,
      dependencies: [],
      fileScopes: [],
      kind: 'chat',
      retryCount: 0,
      maxRetries: 1,
    });
    repo.updateChatMessage(agent.id, { taskId: task.id });
    expect(repo.getChatMessageByTaskId(task.id)?.id).toBe(agent.id);
    expect(repo.getTask(task.id)?.kind).toBe('chat');
  });

  it('removes a thread and its messages together', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Demo', path: 'C:/demo', status: 'active' });
    const thread = repo.createChatThread({ projectId: project.id, title: 'Temp' });
    repo.createChatMessage({ threadId: thread.id, role: 'user', text: 'hi', status: 'complete' });

    expect(repo.deleteChatThread(thread.id)).toBe(true);
    expect(repo.getChatThread(thread.id)).toBeUndefined();
    expect(repo.listChatMessages(thread.id)).toHaveLength(0);
  });

  it('persists a pending permission request and clears it once answered', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Demo', path: 'C:/demo', status: 'active' });
    const thread = repo.createChatThread({ projectId: project.id, title: 'Perms' });
    const agent = repo.createChatMessage({
      threadId: thread.id,
      role: 'agent',
      agentId: 'opencode',
      text: '',
      status: 'streaming',
      request: { type: 'permission', command: 'rm -rf build' },
    });

    expect(repo.getChatMessage(agent.id)?.request).toEqual({ type: 'permission', command: 'rm -rf build' });

    repo.updateChatMessage(agent.id, { status: 'complete', request: undefined });
    expect(repo.getChatMessage(agent.id)?.request).toBeUndefined();
  });
});
describe('chat targets exactly one adapter', () => {
  function makeChatDeps(): {
    repo: OpenCLIRepository;
    thread: ReturnType<OpenCLIRepository['createChatThread']>;
    deps: ChatDeps;
    emitted: string[];
  } {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Demo', path: 'C:/demo', status: 'active' });
    const thread = repo.createChatThread({ projectId: project.id, title: 'Chat' });
    const emitted: string[] = [];
    const deps = {
      db: repo,
      eventBus: {
        emit: async (event: { type: string }) => {
          emitted.push(event.type);
          return true;
        },
      },
      scheduler: {
        loadTasks: () => undefined,
        startWorkflow: async () => ({ started: false, taskIds: [], errors: [] }),
      },
      workflowRuntime: {},
    } as unknown as ChatDeps;
    return { repo, thread, deps, emitted };
  }

  const STEPS: PlanStep[] = [
    { title: 'Analyze auth', description: 'read the code', dependsOn: [] },
    { title: 'Design schema', description: 'write the design', dependsOn: [0] },
    { title: 'Implement backend', description: 'code it', dependsOn: [1] },
  ];

  it('keeps every plan step on the chat adapter in plan mode', () => {
    const { repo, thread, deps } = makeChatDeps();

    const { workflowId, taskIds } = createWorkflowForPlan(
      deps,
      thread,
      'Build an auth system',
      STEPS,
      ['opencode'],
      false,
      'plan',
    );

    expect(taskIds).toHaveLength(3);
    const tasks = taskIds.map((id) => repo.getTask(id)!);
    // Plan mode must not spread work to other adapters.
    expect(tasks.every((task) => task.agentId === 'opencode')).toBe(true);
    expect(tasks.map((task) => task.modeId)).toEqual(['plan', 'plan', 'plan']);
    expect(repo.getWorkflow(workflowId)?.status).toBe('draft');
    expect(tasks[0]!.dependencies).toEqual([]);
    expect(tasks[1]!.dependencies).toEqual([tasks[0]!.id]);
  });

  it('spreads agent-mode steps across the active adapters', () => {
    const { repo, thread, deps } = makeChatDeps();

    const { taskIds } = createWorkflowForPlan(
      deps,
      thread,
      'Build an auth system',
      STEPS,
      ['opencode', 'kilocode'],
      true,
      'build',
    );

    const agents = taskIds.map((id) => repo.getTask(id)!.agentId);
    expect(new Set(agents).size).toBe(2);
  });

  it('never leaves a task without an adapter when one is assignable', () => {
    const { repo, thread, deps } = makeChatDeps();

    const { taskIds } = createWorkflowForPlan(deps, thread, 'x', STEPS, ['claude'], false, undefined);

    expect(taskIds.every((id) => Boolean(repo.getTask(id)!.agentId))).toBe(true);
  });

  it('leaves mode unset rather than inventing one', () => {
    const { repo, thread, deps } = makeChatDeps();

    const { taskIds } = createWorkflowForPlan(deps, thread, 'x', STEPS, ['claude'], false, undefined);

    // A CLI that reports no modes must not receive a made-up mode name.
    expect(taskIds.every((id) => repo.getTask(id)!.modeId === undefined)).toBe(true);
  });

  it('honours the planner agentId when it is in the assignable pool', () => {
    const { repo, thread, deps } = makeChatDeps();

    const { taskIds } = createWorkflowForPlan(
      deps,
      thread,
      'x',
      [{ title: 'step', description: 'd', agentId: 'kilocode', dependsOn: [] }],
      ['opencode', 'kilocode'],
      true,
      'build',
    );

    expect(repo.getTask(taskIds[0]!)!.agentId).toBe('kilocode');
  });

  it('ignores a planner agentId outside the assignable pool', () => {
    const { repo, thread, deps } = makeChatDeps();

    const { taskIds } = createWorkflowForPlan(
      deps,
      thread,
      'x',
      [{ title: 'step', description: 'd', agentId: 'claude', dependsOn: [] }],
      ['opencode'],
      false,
      'plan',
    );

    expect(repo.getTask(taskIds[0]!)!.agentId).toBe('opencode');
  });

  it('remembers the chat adapter and adapter mode on the thread', () => {
    const { repo, thread } = makeChatDeps();

    repo.updateChatThread(thread.id, {
      chatAdapterId: 'kilocode',
      adapterMode: 'code',
      interactionMode: 'ask',
      planStatus: 'none',
    });

    const reloaded = repo.getChatThread(thread.id)!;
    expect(reloaded.chatAdapterId).toBe('kilocode');
    expect(reloaded.adapterMode).toBe('code');
    expect(reloaded.interactionMode).toBe('ask');
    expect(reloaded.planStatus).toBe('none');
  });
});
describe('model routing keeps the exact CLI spec', () => {
  function repo() {
    const r = makeRepo();
    const project = r.createProject({ name: 'Routing', path: 'C:/demo', status: 'active' });
    return { r, project };
  }

  it('stores and returns the spec so the CLI gets the original string', () => {
    const { r, project } = repo();
    r.setModelRouting(project.id, 'opencode', 'build', 'default', 'big-pickle', 'opencode/big-pickle');

    const routing = r.listModelRoutings(project.id);
    // provider/model alone would produce "default/big-pickle", which the CLI
    // rejects; the spec is what must be sent.
    expect(routing.opencode!.build!.spec).toBe('opencode/big-pickle');
    expect(routing.opencode!.build!.provider).toBe('default');
  });

  it('leaves spec undefined for rows written before the column existed', () => {
    const { r, project } = repo();
    r.setModelRouting(project.id, 'claude', 'plan', 'anthropic', 'claude-opus-latest');
    expect(r.listModelRoutings(project.id).claude!.plan!.spec).toBeUndefined();
  });

  it('replaces a stale spec when the routing changes', () => {
    const { r, project } = repo();
    r.setModelRouting(project.id, 'opencode', 'build', 'default', 'a', 'opencode/a');
    r.setModelRouting(project.id, 'opencode', 'build', 'google', 'b', 'google/b');

    const entry = r.listModelRoutings(project.id).opencode!.build!;
    expect(entry.spec).toBe('google/b');
    expect(entry.provider).toBe('google');
  });
});