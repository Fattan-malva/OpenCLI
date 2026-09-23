import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AGENTS, providerRegistry, useStore } from '../store';
import { api } from '../lib/api';
import type { AdapterInfo, AdapterMode } from '../lib/types';
import { Icon } from '../lib/icons';
import type { AgentConfigs } from '../lib/types';

export function Modal() {
  const { modal, closeModal, agentConfigs, saveAgentConfig, submitNewTask, createWorkflow, showToast, addLog, adapters, activeProject } = useStore();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [agentId, setAgentId] = useState('');
  const [mode, setMode] = useState('');
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDesc, setWorkflowDesc] = useState('');
  const [availableModes, setAvailableModes] = useState<AdapterMode[]>([]);
  const [draft, setDraft] = useState<AgentConfigs[string] | null>(null);

  useEffect(() => {
    if (modal?.kind === 'agentConfig' && modal.agentId) {
      const cfg = agentConfigs[modal.agentId];
      setDraft(cfg ? JSON.parse(JSON.stringify(cfg)) : { modes: {} });
    }
    if (modal?.kind === 'addTask') {
      setTitle('');
      setDesc('');
      const firstAdapter = adapters.find((adapter) => adapter.installed && adapter.active);
      setAgentId(firstAdapter?.id ?? '');
      setAvailableModes([]);
      setMode('');
    }
    if (modal?.kind === 'newWorkflow') {
      setWorkflowName('');
      setWorkflowDesc('');
    }
  }, [modal, agentConfigs, adapters]);

  useEffect(() => {
    if (modal?.kind !== 'addTask' || !activeProject || !agentId) return;

    let cancelled = false;
    api.getProjectAdapterCapabilities(activeProject.id, agentId)
      .then((capabilities) => {
        if (cancelled) return;
        setAvailableModes(capabilities.modes);
        setMode((current) => capabilities.modes.some((item) => item.id === current)
          ? current
          : capabilities.current.mode || capabilities.modes[0]?.id || '');
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableModes([]);
          setMode('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [modal?.kind, activeProject?.id, agentId]);

  if (!modal) return null;

  const setField = (draftMode: string, field: 'provider' | 'model', value: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const modes = { ...prev.modes, [draftMode]: { ...prev.modes[draftMode], [field]: value } };
      if (field === 'provider') modes[draftMode].model = providerRegistry[value][0];
      return { ...prev, modes };
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 modal-overlay" onClick={closeModal}></div>
      <div className="relative bg-app-surface border border-app-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-surface">
          <h2 className="text-base font-semibold text-app-textStrong">{modal.title}</h2>
          <button onClick={closeModal} className="text-app-text hover:text-white transition-colors">
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {modal.kind === 'settings' && <SettingsBody />}
          {modal.kind === 'newWorkflow' && (
            <NewWorkflowBody
              name={workflowName}
              setName={setWorkflowName}
              description={workflowDesc}
              setDescription={setWorkflowDesc}
            />
          )}
          {modal.kind === 'addTask' && (
            <AddTaskBody
              title={title}
              setTitle={setTitle}
              desc={desc}
              setDesc={setDesc}
              agentId={agentId}
              setAgentId={setAgentId}
              mode={mode}
              setMode={setMode}
              adapters={adapters.filter((adapter) => adapter.installed && adapter.active)}
              modes={availableModes}
            />
          )}
          {modal.kind === 'agentConfig' && modal.agentId && draft && (
            <AgentConfigBody agentId={modal.agentId} draft={draft} setField={setField} />
          )}
        </div>

        <div className="px-6 py-4 border-t border-app-border bg-app-bg flex justify-end space-x-3">
          {modal.kind === 'settings' && <SettingsFooter />}
          {modal.kind === 'newWorkflow' && (
            <NewWorkflowFooter
              name={workflowName}
              description={workflowDesc}
              createWorkflow={createWorkflow}
              closeModal={closeModal}
            />
          )}
          {modal.kind === 'addTask' && <AddTaskFooter />}
          {modal.kind === 'agentConfig' && modal.agentId && draft && (
            <AgentConfigFooter
              agentId={modal.agentId}
              onSave={() => {
                saveAgentConfig(modal.agentId!, draft.modes);
                closeModal();
                showToast('Configuration Saved', `Updated capabilities for ${AGENTS[modal.agentId!].name}`, 'success');
                addLog('config.updated', `Updated capabilities config for agent ${modal.agentId}`, 'system');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function NewWorkflowBody({
  name,
  setName,
  description,
  setDescription,
}: {
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
}) {
  return (
    <form id="new-workflow-form" className="space-y-4 text-sm">
      <div>
        <label className="block text-app-text mb-1 font-medium">Workflow Name</label>
        <input
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Build Purchase Request"
          className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary"
        />
      </div>
      <div>
        <label className="block text-app-text mb-1 font-medium">Description</label>
        <textarea
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What should this workflow accomplish?"
          className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary placeholder-app-text/50"
        />
      </div>
    </form>
  );
}

function NewWorkflowFooter({
  name,
  description,
  createWorkflow,
  closeModal,
}: {
  name: string;
  description: string;
  createWorkflow: (name: string, description?: string) => Promise<boolean>;
  closeModal: () => void;
}) {
  return (
    <>
      <button type="button" onClick={closeModal} className="px-4 py-2 rounded text-app-text hover:text-white transition-colors">
        Cancel
      </button>
      <button
        form="new-workflow-form"
        type="submit"
        onClick={(event) => {
          event.preventDefault();
          void createWorkflow(name, description);
        }}
        className="px-4 py-2 rounded bg-app-primary hover:bg-indigo-600 text-white transition-colors"
      >
        Create Workflow
      </button>
    </>
  );
}

function SettingsBody() {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <label className="block text-app-text mb-1.5 font-medium">Global Concurrency Limit</label>
        <input type="range" min="1" max="8" defaultValue={4} className="w-full accent-app-primary" />
        <div className="flex justify-between text-xs text-app-text mt-1">
          <span>1 Agent</span>
          <span>8 Agents</span>
        </div>
      </div>
      <div>
        <label className="block text-app-text mb-1.5 font-medium">Default Mode Policy</label>
        <select
          defaultValue="Require Approval on Commit (Safe)"
          className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary"
        >
          <option>Auto-Approve (Fast)</option>
          <option>Require Approval on Commit (Safe)</option>
          <option>Strict Isolation (Paranoid)</option>
        </select>
      </div>
      <div className="flex items-center justify-between p-3 border border-app-border rounded bg-app-bg">
        <div>
          <div className="font-medium text-app-textStrong">Telemetry & Error Reporting</div>
          <div className="text-xs text-app-text">Help improve OpenCLI anonymously.</div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" defaultChecked className="sr-only peer" />
          <div className="w-9 h-5 bg-app-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-app-primary"></div>
        </label>
      </div>
    </div>
  );
}

function SettingsFooter() {
  const { closeModal, showToast } = useStore();
  return (
    <>
      <button onClick={closeModal} className="px-4 py-2 rounded text-app-text hover:text-white transition-colors">
        Cancel
      </button>
      <button
        onClick={() => {
          closeModal();
          showToast('Settings Saved', 'Configuration applied globally.', 'success');
        }}
        className="px-4 py-2 rounded bg-app-primary hover:bg-indigo-600 text-white transition-colors shadow-sm"
      >
        Save Changes
      </button>
    </>
  );
}

function AddTaskBody({
  title,
  setTitle,
  desc,
  setDesc,
  agentId,
  setAgentId,
  mode,
  setMode,
  adapters,
  modes,
}: {
  title: string;
  setTitle: (v: string) => void;
  desc: string;
  setDesc: (v: string) => void;
  agentId: string;
  setAgentId: (v: string) => void;
  mode: string;
  setMode: (v: string) => void;
  adapters: AdapterInfo[];
  modes: AdapterMode[];
}) {
  const { submitNewTask } = useStore();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    submitNewTask({ title, desc, agentId, mode });
  };

  return (
    <form id="add-task-form" onSubmit={submit} className="space-y-4 text-sm">
      <div>
        <label className="block text-app-text mb-1 font-medium">Task Title</label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Implement WebSockets"
          className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary"
        />
      </div>
      <div>
        <label className="block text-app-text mb-1 font-medium">Description / Prompt</label>
        <textarea
          required
          rows={3}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Describe the task..."
          className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary placeholder-app-text/50"
        ></textarea>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-app-text mb-1 font-medium">Runtime Adapter</label>
          <select
            required
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
              setMode('');
            }}
            className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary"
          >
            {adapters.length === 0 && <option value="">No active adapter</option>}
            {adapters.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>
                {adapter.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-app-text mb-1 font-medium">Execution Mode</label>
          <select
            required
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary"
            disabled={!modes.length}
          >
            {!modes.length && <option value="">Loading modes...</option>}
            {modes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </form>
  );
}

function AddTaskFooter() {
  const { closeModal } = useStore();
  return (
    <>
      <button onClick={closeModal} className="px-4 py-2 rounded text-app-text hover:text-white transition-colors">
        Cancel
      </button>
      <button
        form="add-task-form"
        type="submit"
        className="px-4 py-2 rounded bg-app-primary hover:bg-indigo-600 text-white transition-colors shadow-sm flex items-center"
      >
        <Icon name="play" className="w-4 h-4 mr-2" /> Queue Task
      </button>
    </>
  );
}

function AgentConfigBody({
  agentId,
  draft,
  setField,
}: {
  agentId: string;
  draft: AgentConfigs[string];
  setField: (mode: string, field: 'provider' | 'model', value: string) => void;
}) {
  const agent = AGENTS[agentId];
  if (!agent) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded ${agent.bg} ${agent.border} ${agent.color} flex items-center justify-center border`}>
          <Icon name={agent.icon} className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-medium text-app-textStrong">{agent.name} Capabilities</h3>
          <p className="text-xs text-app-text">Configure provider and model automatically per capability.</p>
        </div>
      </div>

      {Object.keys(draft.modes).length === 0 && (
        <div className="text-sm text-app-text italic">No configurable capabilities for this agent.</div>
      )}

      {Object.entries(draft.modes).map(([draftMode, route]) => (
        <div key={draftMode} className="p-3 border border-app-border rounded-lg bg-app-bg">
          <div className="flex items-center justify-between mb-3">
            <span className="px-2.5 py-1 rounded bg-app-surface border border-app-border text-xs font-semibold uppercase tracking-wider text-app-textStrong flex items-center gap-2">
              <Icon name="zap" className="w-3 h-3 text-app-primary" />
              Capability: {draftMode}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-app-text mb-1.5 font-semibold">Provider</label>
              <select
                value={route.provider}
                onChange={(e) => setField(draftMode, 'provider', e.target.value)}
                className="w-full bg-app-surface border border-app-border rounded px-3 py-2 text-xs text-app-textStrong focus:outline-none focus:border-app-primary transition-colors"
              >
                {Object.keys(providerRegistry).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-app-text mb-1.5 font-semibold">Model</label>
              <select
                value={route.model}
                onChange={(e) => setField(draftMode, 'model', e.target.value)}
                className="w-full bg-app-surface border border-app-border rounded px-3 py-2 text-xs text-app-textStrong focus:outline-none focus:border-app-primary transition-colors"
              >
                {(providerRegistry[route.provider] || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentConfigFooter({ onSave }: { agentId: string; onSave: () => void }) {
  const { closeModal } = useStore();
  return (
    <>
      <button onClick={closeModal} className="px-4 py-2 rounded text-app-text hover:text-white transition-colors text-sm">
        Cancel
      </button>
      <button
        onClick={onSave}
        className="px-4 py-2 rounded bg-app-primary hover:bg-indigo-600 text-white transition-colors shadow-sm text-sm"
      >
        Save Configuration
      </button>
    </>
  );
}