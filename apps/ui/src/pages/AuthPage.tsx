import { useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from '../lib/icons';
import { useStore } from '../store';

export function AuthPage() {
  const { login } = useStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || busy) return;
    setBusy(true);
    setError('');
    const ok = await login(pin.trim());
    if (!ok) {
      setPin('');
      setError('PIN salah. Coba lagi.');
    }
    setBusy(false);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-app-bg relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.08),transparent_60%)]"></div>

      <div className="relative w-full max-w-sm">
        <div className="bg-app-surface border border-app-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 pt-8 pb-6 flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl bg-app-primary/10 border border-app-primary/30 flex items-center justify-center mb-4">
              <Icon name="terminal-square" className="w-7 h-7 text-app-primary" />
            </div>
            <h1 className="text-xl font-semibold text-app-textStrong">OpenCLI</h1>
            <p className="text-xs text-app-text mt-1">Masukkan PIN untuk membuka dashboard</p>
          </div>

          <form onSubmit={submit} className="px-8 pb-8 space-y-4">
            <div>
              <label className="block text-xs font-medium text-app-text mb-1.5">PIN</label>
              <div className="relative">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={12}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setError('');
                  }}
                  placeholder="••••••"
                  className={`w-full bg-app-bg border rounded-lg px-4 py-3 text-app-textStrong text-center tracking-[0.5em] font-mono text-lg focus:outline-none focus:border-app-primary transition-colors ${
                    error ? 'border-app-danger' : 'border-app-border'
                  }`}
                  disabled={busy}
                  autoFocus
                />
                <Icon
                  name="lock"
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-text"
                />
              </div>
              {error && <p className="text-xs text-app-danger mt-2">{error}</p>}
            </div>

            <button
              type="submit"
              disabled={busy || !pin.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-app-primary hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors shadow-sm"
            >
              {busy ? (
                <Icon name="loader-2" className="w-4 h-4 animate-spin" />
              ) : (
                <Icon name="log-in" className="w-4 h-4" />
              )}
              Login
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-app-text/70 mt-4">
          Default PIN: <span className="font-mono text-app-text">123456</span> —
          ubah melalui menu Settings.
        </p>
      </div>
    </div>
  );
}