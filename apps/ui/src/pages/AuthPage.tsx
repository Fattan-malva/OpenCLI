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
      {/* A single soft light source above the card, so the composition has one
          clear centre of gravity instead of competing glows. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(99,102,241,0.10),transparent_70%)]" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[radial-gradient(ellipse_70%_60%_at_50%_100%,rgba(99,102,241,0.05),transparent_70%)]" />

      <div className="relative w-full max-w-[380px] px-6">
        <div className="bg-app-surface/80 backdrop-blur-sm border border-app-border rounded-2xl shadow-2xl shadow-black/40">
          {/* Header and form share one horizontal measure and one rhythm, so the
              card reads as a single symmetrical column. */}
          <div className="px-8 pt-9 pb-7 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-app-primary/10 border border-app-primary/25 flex items-center justify-center">
              <Icon name="terminal-square" className="w-6 h-6 text-app-primary" />
            </div>
            <h1 className="text-lg font-semibold text-app-textStrong mt-4 tracking-tight">OpenCLI</h1>
            <p className="text-xs text-app-text mt-1.5 leading-relaxed">
              Masukkan PIN untuk membuka dashboard
            </p>
          </div>

          <form onSubmit={submit} className="px-8 pb-8 space-y-5">
            <div>
              <label
                htmlFor="pin"
                className="block text-[11px] font-medium text-app-text text-center uppercase tracking-wider mb-2.5"
              >
                PIN
              </label>

              {/* The field is the only centred element, so it carries no icon:
                  an icon pinned to one side pulls the eye off the axis and makes
                  a centred row look lopsided. The label above names it instead. */}
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError('');
                }}
                placeholder="••••"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'pin-error' : undefined}
                className={`w-full bg-app-bg border rounded-xl py-3.5 text-app-textStrong text-center font-mono text-xl
                  focus:outline-none focus:ring-2 transition-all duration-150
                  ${
                    error
                      ? 'border-app-danger/60 focus:border-app-danger focus:ring-app-danger/20'
                      : 'border-app-border focus:border-app-primary focus:ring-app-primary/20'
                  }
                  disabled:opacity-60`}
                // Letter-spacing puts a gap after the final character too, which
                // drags centred text half a step to the left. The indent puts it
                // back, so the dots sit on the axis at any length.
                style={{ letterSpacing: '0.42em', textIndent: '0.42em' }}
                disabled={busy}
                autoFocus
              />

              {/* The row is reserved whether or not there is an error, so a wrong
                  PIN does not shove the button down under the cursor. */}
              <div className="h-8 pt-2 flex items-start justify-center">
                {error ? (
                  <p id="pin-error" role="alert" className="text-[11px] text-app-danger text-center leading-tight">
                    {error}
                  </p>
                ) : (
                  <p className="text-[11px] text-app-text/60 text-center leading-tight">
                    4–12 karakter
                  </p>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={busy || !pin.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-app-primary hover:bg-indigo-500
                disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-all duration-150
                active:scale-[0.99] shadow-lg shadow-app-primary/20"
            >
              {busy ? (
                <Icon name="loader-2" className="w-4 h-4 animate-spin" />
              ) : (
                <Icon name="log-in" className="w-4 h-4" />
              )}
              {busy ? 'Memeriksa…' : 'Masuk'}
            </button>
          </form>
        </div>

        {/* Kept outside the card and quiet, so the card stays the subject. */}
        <p className="text-center text-[11px] text-app-text/60 mt-5 leading-relaxed">
          PIN default <span className="font-mono text-app-text">123456</span> — ubah di Settings
        </p>
      </div>
    </div>
  );
}
