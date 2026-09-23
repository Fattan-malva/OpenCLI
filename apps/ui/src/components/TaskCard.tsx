import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AGENTS, STATUS, useStore } from '../store';
import { Icon } from '../lib/icons';
import type { Task } from '../lib/types';

export function TaskCard({ task }: { task: Task }) {
  const { setTasks, addLog, showToast, updateGlobalStatus } = useStore();
  const [reply, setReply] = useState('');
  const statusInfo = STATUS[task.status];
  const agentInfo = AGENTS[task.agentId] || AGENTS.system;

  const updateTask = (fn: (t: Task) => Task) =>
    setTasks((prev) => prev.map((t) => (t.id === task.id ? fn(t) : t)));

  const handlePermission = (approved: boolean) => {
    const req = task.agentRequest;
    if (!req) return;
    if (approved) {
      addLog('user.action', `Approved command execution for task ${task.id}`);
      addLog('system.exec', `Running command: ${req.command}`, 'system', task.id);
      showToast('Permission Granted', 'Agent will execute the command and resume.', 'success');
    } else {
      addLog('user.action', `Denied command execution for task ${task.id}`);
      addLog('agent.input', `User denied permission to run: ${req.command}`, task.agentId, task.id);
      showToast('Permission Denied', 'Agent notified of denial and will seek alternative.', 'info');
    }
    updateTask((t) => ({ ...t, status: 'RUNNING', agentRequest: undefined }));
    updateGlobalStatus('Orchestrating (2 Agents Active)', 'indigo', 'loader-2', true);
  };

  const handleChoice = (choiceText: string) => {
    addLog('user.action', `Selected option for task ${task.id}: "${choiceText}"`);
    addLog('agent.input', `User decision provided: ${choiceText}`, task.agentId, task.id);
    showToast('Decision Recorded', 'Agent is proceeding with your recommendation.', 'success');
    updateTask((t) => ({ ...t, status: 'RUNNING', agentRequest: undefined }));
  };

  const replyTask = (e: FormEvent) => {
    e.preventDefault();
    if (!reply) return;
    addLog('user.input', `Answered ${task.id}: "${reply}"`);
    showToast('Reply Sent', 'Agent has resumed execution.', 'success');
    updateTask((t) => ({ ...t, status: 'RUNNING', agentQuestion: undefined }));
    addLog('task.resumed', `Task ${task.id} resumed after user input.`, 'system', task.id);
    updateGlobalStatus('Orchestrating (2 Agents Active)', 'indigo', 'loader-2', true);
  };

  const rejectTask = () => {
    addLog('user.action', `Rejected changes for task ${task.id}`);
    updateTask((t) => ({ ...t, status: 'RUNNING', agentRequest: undefined }));
    addLog('task.resumed', `Task ${task.id} resumed after user input.`, 'system', task.id);
    updateGlobalStatus('Orchestrating (Active)', 'indigo', 'loader-2', true);
  };

  const approveTask = () => {
    addLog('user.action', `Approved changes for task ${task.id}`);
    addLog('git.commit_created', `feat: API implementations for ${task.id}`, 'system', task.id);
    addLog('workspace.released', `Removed worktree for ${task.id}`, 'system');
    addLog('task.completed', `Task ${task.id} finished successfully.`, 'system', task.id);
    updateTask((t) => ({ ...t, status: 'COMPLETED', agentRequest: undefined, agentDiff: undefined }));
    setTasks((prev) => {
      const dep = prev.find((t) => t.dependencies.includes(task.id) && t.status === 'PENDING');
      if (dep) {
        addLog('task.started', 'Dependencies met, starting task.', 'system', dep.id);
        return prev.map((t) => (t.id === dep.id ? { ...t, status: 'RUNNING' } : t));
      }
      return prev;
    });
    updateGlobalStatus('Orchestrating (1 Agent Active)', 'indigo', 'loader-2', true);
  };

  const req = task.agentRequest;
  let interactive: ReactNode = null;

  if (task.status === 'ASK' && req) {
    if (req.type === 'question') {
      interactive = (
        <div className="mt-3 p-3 bg-sky-950/20 border border-sky-500/20 rounded-lg flex flex-col gap-3">
          <div className="flex items-start gap-2 text-sky-300 text-sm">
            <Icon name="bot" className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong className="text-sky-200 block mb-1">Agent Request:</strong> {req.message}
            </span>
          </div>
          <form onSubmit={replyTask} className="flex gap-2">
            <input
              type="text"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              autoComplete="off"
              placeholder="Type your instruction or answer..."
              className="flex-1 bg-[#09090b] border border-app-border rounded px-3 py-1.5 text-sm text-app-textStrong focus:outline-none focus:border-sky-500 transition-colors shadow-inner"
            />
            <button
              type="submit"
              className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-sm font-medium transition-colors shadow-sm flex items-center shrink-0"
            >
              <Icon name="send" className="w-3.5 h-3.5 mr-1.5" /> Reply
            </button>
          </form>
        </div>
      );
    } else if (req.type === 'permission') {
      interactive = (
        <div className="mt-3 p-3 bg-amber-950/20 border border-amber-500/30 rounded-lg flex flex-col gap-3">
          <div className="flex items-start gap-2 text-amber-300 text-sm">
            <Icon name="shield-alert" className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <strong className="text-amber-200 block mb-1">Permission Required</strong>
              <span className="opacity-90">{req.message}</span>
            </div>
          </div>
          <div className="font-mono text-xs text-app-text bg-[#09090b] p-2 rounded border border-app-border">
            <span className="text-indigo-400">$</span> {req.command}
          </div>
          <div className="flex gap-2 justify-end mt-1">
            <button
              onClick={() => handlePermission(false)}
              className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded text-sm font-medium transition-colors flex items-center"
            >
              <Icon name="x" className="w-3.5 h-3.5 mr-1.5" /> Deny
            </button>
            <button
              onClick={() => handlePermission(true)}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition-colors shadow-sm flex items-center"
            >
              <Icon name="check" className="w-3.5 h-3.5 mr-1.5" /> Approve Command
            </button>
          </div>
        </div>
      );
    } else if (req.type === 'choice') {
      interactive = (
        <div className="mt-3 p-3 bg-sky-950/20 border border-sky-500/20 rounded-lg flex flex-col gap-3">
          <div className="flex items-start gap-2 text-sky-300 text-sm">
            <Icon name="help-circle" className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <strong className="text-sky-200 block mb-1">Recommendation Needed</strong>
              <span className="opacity-90">{req.message}</span>
            </div>
          </div>
          <div className="flex gap-2 w-full mt-1">
            {req.options?.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleChoice(opt)}
                className="flex-1 px-3 py-2 bg-[#09090b] hover:bg-app-hover border border-app-border hover:border-sky-500/50 rounded text-sm text-app-textStrong transition-colors text-left flex flex-col gap-1 group"
              >
                <span className="font-semibold text-sky-400 group-hover:text-sky-300">Option {i + 1}</span>
                <span className="text-xs text-app-text">{opt}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }
  } else if (task.status === 'REVIEW') {
    const diffFiles = task.agentDiff || ['src/api/routes.ts', 'src/api/controllers/product.ts'];
    interactive = (
      <div className="mt-3 p-4 bg-amber-950/20 border border-amber-500/20 rounded-lg flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2 text-amber-300 text-sm">
            <Icon name="git-pull-request" className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <strong className="text-amber-200 block mb-0.5">Approval Required</strong>
              <span className="opacity-90">Review the generated changes in worktree before merging.</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col text-xs font-mono text-app-text bg-[#09090b] p-2 rounded border border-app-border">
          {diffFiles.map((f, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span className="text-emerald-400 font-bold w-3 text-center">+</span> {f}
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end mt-1 border-t border-amber-500/10 pt-3">
          <button
            onClick={rejectTask}
            className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded text-sm font-medium transition-colors flex items-center"
          >
            <Icon name="x" className="w-3.5 h-3.5 mr-1.5" /> Reject & Retry
          </button>
          <button
            onClick={approveTask}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition-colors shadow-sm flex items-center"
          >
            <Icon name="check" className="w-3.5 h-3.5 mr-1.5" /> Approve & Merge
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${task.dependencies.length > 0 ? 'ml-8' : ''}`}>
      {task.dependencies.length > 0 && (
        <div className="absolute -left-6 top-6 w-4 border-b-2 border-app-border rounded-bl-lg border-l-2 h-12 -mt-12"></div>
      )}
      <div
        className={`task-card bg-app-surface border border-app-border rounded-lg p-4 flex flex-col gap-3 shadow-sm ${
          task.status === 'RUNNING' ? 'ring-1 ring-indigo-500/30' : ''
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="font-mono text-xs text-app-text bg-app-bg px-1.5 py-0.5 rounded border border-app-border">
              {task.id}
            </div>
            <h3 className="font-medium text-app-textStrong text-base">{task.title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusInfo.classes}`}>
              <Icon
                name={statusInfo.icon}
                className={`w-3.5 h-3.5 ${task.status === 'RUNNING' ? 'animate-spin' : ''}`}
              />
              <span>{statusInfo.label}</span>
            </div>
            <button
              onClick={() => showToast('Task Action', `Opened context menu for ${task.id}`, 'info')}
              className="p-1 text-app-text hover:text-app-textStrong rounded hover:bg-app-hover"
            >
              <Icon name="more-vertical" className="w-4 h-4" />
            </button>
          </div>
        </div>

        <p className="text-app-text text-sm">{task.description}</p>

        {interactive}

        <div className="flex flex-wrap items-center gap-4 text-xs mt-1 pt-3 border-t border-app-border/50">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${agentInfo.bg} ${agentInfo.border} ${agentInfo.color}`}>
            <Icon name={agentInfo.icon} className="w-3.5 h-3.5" />
            <span className="font-medium">{agentInfo.name}</span>
          </div>
          <div className="flex items-center gap-1.5 text-app-text">
            <Icon name="sliders-horizontal" className="w-3.5 h-3.5" />
            <span>
              Mode: <span className="text-app-textStrong">{task.mode}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-app-text">
            <Icon name="folder-git-2" className="w-3.5 h-3.5" />
            <span className="font-mono bg-app-bg px-1 py-0.5 rounded border border-app-border">{task.workspace}</span>
          </div>
          {task.dependencies.length > 0 && (
            <div className="flex items-center gap-1.5 text-app-text ml-auto">
              <Icon name="link" className="w-3.5 h-3.5" />
              <span>
                Depends on: <span className="font-mono text-app-textStrong">{task.dependencies.join(', ')}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TaskList() {
  const { tasks } = useStore();
  return (
    <>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </>
  );
}