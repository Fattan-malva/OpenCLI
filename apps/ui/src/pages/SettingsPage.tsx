import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from '../lib/icons';
import { useStore } from '../store';
import type { SystemSettings } from '../lib/types';

export function SettingsPage({ active }: { active: boolean }) {
  const { showToast, addLog } = useStore();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SystemSettings>({
    maxParallelAgents: 4,
    defaultModePolicy: 'Require Approval on Commit (Safe)',
    telemetry: true,
  });
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    api
      .getSettings()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [active]);

  const saveAll = async () => {
    setSaving(true);
    try {
      await api.saveSettings(settings);
      showToast('Settings Saved', 'System configuration applied.', 'success');
      addLog('config.updated', 'Updated system settings', 'system');
    } catch (e: any) {
      showToast('Save Failed', e?.message ?? 'Gagal menyimpan pengaturan.', 'error');
    }
    setSaving(false);
  };

  const changePin = async () => {
    if (!currentPin || !newPin) {
      showToast('PIN Required', 'Isi PIN lama dan PIN baru.', 'warning');
      return;
    }
    setPinBusy(true);
    try {
      await api.changePin(currentPin, newPin);
      setCurrentPin('');
      setNewPin('');
      showToast('PIN Changed', 'PIN berhasil diperbarui.', 'success');
      addLog('config.updated', 'System PIN changed by user', 'system');
    } catch (e: any) {
      showToast('PIN Change Failed', e?.message ?? 'Gagal mengganti PIN.', 'error');
    }
    setPinBusy(false);
  };

  if (loading) {
    return (
      <div className={`page-content ${active ? 'active' : ''} flex-col h-full w-full items-center justify-center text-app-text`}>
        <Icon name="loader-2" className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className={`page-content ${active ? 'active' : ''} flex-col h-full w-full overflow-y-auto`}>
      <div className="p-8 max-w-3xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-app-textStrong flex items-center gap-3">
            <Icon name="settings" className="w-6 h-6 text-app-primary" />
            System Settings
          </h1>
          <p className="text-sm text-app-text mt-1">Kelola pengaturan sistem OpenCLI.</p>
        </div>

        <div className="space-y-6">
          <section className="border border-app-border rounded-xl bg-app-surface p-6">
            <h2 className="text-sm font-semibold text-app-textStrong mb-4 flex items-center gap-2">
              <Icon name="sliders-horizontal" className="w-4 h-4 text-app-primary" />
              Orchestration
            </h2>
            <div className="space-y-5">
              <div>
                <label className="block text-app-text mb-1.5 font-medium">
                  Global Concurrency Limit — <span className="text-app-textStrong">{settings.maxParallelAgents}</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={settings.maxParallelAgents}
                  onChange={(e) => setSettings((s) => ({ ...s, maxParallelAgents: parseInt(e.target.value, 10) }))}
                  className="w-full accent-app-primary"
                />
                <div className="flex justify-between text-xs text-app-text mt-1">
                  <span>1 Agent</span>
                  <span>8 Agents</span>
                </div>
              </div>
              <div>
                <label className="block text-app-text mb-1.5 font-medium">Default Mode Policy</label>
                <select
                  value={settings.defaultModePolicy}
                  onChange={(e) => setSettings((s) => ({ ...s, defaultModePolicy: e.target.value }))}
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
                <input
                  type="checkbox"
                  checked={settings.telemetry}
                  onChange={(e) => setSettings((s) => ({ ...s, telemetry: e.target.checked }))}
                  className="peer sr-only"
                  id="telemetry-toggle"
                />
                <label
                  htmlFor="telemetry-toggle"
                  className="relative inline-flex items-center cursor-pointer"
                >
                  <div
                    className={`w-9 h-5 rounded-full transition-colors ${settings.telemetry ? 'bg-app-primary' : 'bg-app-border'}`}
                  ></div>
                  <div
                    className={`absolute h-4 w-4 rounded-full bg-white transition-transform ${settings.telemetry ? 'translate-x-4' : 'translate-x-0'} left-1`}
                  ></div>
                </label>
              </div>
            </div>
          </section>

          <section className="border border-app-border rounded-xl bg-app-surface p-6">
            <h2 className="text-sm font-semibold text-app-textStrong mb-4 flex items-center gap-2">
              <Icon name="key-round" className="w-4 h-4 text-app-primary" />
              Security
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-app-text mb-1.5 font-medium">Current PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  placeholder="PIN saat ini"
                  className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary font-mono"
                />
              </div>
              <div>
                <label className="block text-app-text mb-1.5 font-medium">New PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="PIN baru (4-12 karakter)"
                  className="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-app-textStrong focus:outline-none focus:border-app-primary font-mono"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={changePin}
                  disabled={pinBusy}
                  className="px-4 py-2 rounded bg-app-border hover:bg-app-hover text-app-textStrong text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {pinBusy ? <Icon name="loader-2" className="w-4 h-4 animate-spin" /> : <Icon name="key-round" className="w-4 h-4" />}
                  Change PIN
                </button>
              </div>
            </div>
          </section>

          <div className="flex justify-end">
            <button
              onClick={saveAll}
              disabled={saving}
              className="px-6 py-2.5 rounded-lg bg-app-primary hover:bg-indigo-600 text-white text-sm font-medium transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Icon name="loader-2" className="w-4 h-4 animate-spin" /> : <Icon name="check" className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}