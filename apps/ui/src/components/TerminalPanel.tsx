// Native terminal panel.
//
// Hosts a CLI's own TUI on a PTY and renders it in xterm.js. Nothing here
// interprets the CLI's output: every byte the process writes is handed to the
// emulator untouched, and every keystroke is sent back untouched. That is what
// lets a CLI draw its full interface, and it is why the panel shows all output
// rather than a filtered summary.
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Icon } from '../lib/icons';
import { useStore } from '../store';
import type { AdapterCapabilities } from '../lib/types';

type ServerMessage =
  | { type: 'ready'; sessionId: string; scrollback?: string; cols: number; rows: number; info: { command: string; status: string } }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number | null; signal?: number }
  | { type: 'error'; message: string };

export function TerminalPanel({
  projectId,
  adapterId,
  capabilities,
}: {
  projectId: string;
  adapterId: string;
  capabilities?: AdapterCapabilities;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'exited'>('idle');
  const [message, setMessage] = useState<string>('');

  // Filled in by the socket callback; kept in a ref so the input handler does
  // not need to be rebuilt on every render.
  const sendRef = useRef<(payload: unknown) => void>(() => {});

  const start = () => {
    const host = hostRef.current;
    if (!host) return;

    setStatus('starting');
    setMessage('');

    // Clear any previous emulator so a restart starts from a clean screen.
    host.replaceChildren();
    termRef.current?.dispose();

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 12,
      scrollback: 20000,
      theme: { background: '#0b0b0d', foreground: '#e4e4e7', cursor: '#e4e4e7' },
allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/terminal`);
    socketRef.current = socket;

    sendRef.current = (payload) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    socket.onopen = () => {
      const primary = capabilities?.modes[0]?.id;
      const routed = capabilities?.modeModels?.[primary ?? ''];
      socket.send(
        JSON.stringify({
          type: 'start',
          projectId,
          adapterId,
          ...(primary ? { mode: primary } : {}),
          ...(routed ? { model: routed } : {}),
        }),
      );
    };

    socket.onmessage = (event) => {
      let payload: ServerMessage;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (payload.type) {
        case 'ready':
          setStatus('running');
          // Replay retained output so a late client still sees the screen.
          if (payload.scrollback) term.write(payload.scrollback);
          term.focus();
          return;
        case 'data':
          term.write(payload.data);
          return;
        case 'exit':
          setStatus('exited');
          setMessage(`Process exited (code ${payload.exitCode ?? 'null'})`);
          return;
        case 'error':
          setStatus('exited');
          setMessage(payload.message);
          return;
      }
    };

    socket.onerror = () => {
      setMessage('Terminal connection failed');
      setStatus('exited');
    };

    term.onData((data) => sendRef.current({ type: 'input', data }));
    term.onResize(({ cols, rows }) => sendRef.current({ type: 'resize', cols, rows }));

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* element not laid out yet */
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  };

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, []);

  const live = status === 'running';

  return (
    <div className="flex flex-col h-full bg-[#0b0b0d]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border bg-app-surface">
        <div className="flex items-center gap-2 text-xs text-app-text">
          <Icon name="terminal" className="w-4 h-4" />
          <span className="text-app-textStrong">{adapterId}</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${
              live ? 'bg-app-success/15 text-app-success' : 'bg-app-border text-app-text'
            }`}
          >
            {status}
          </span>
          {capabilities && !capabilities.supportsInteractive && (
            <span className="text-[10px] text-amber-400">no native TUI reported</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {message && <span className="text-[11px] text-app-text truncate max-w-xs">{message}</span>}
          {live && (
            <button
              onClick={() => sendRef.current({ type: 'kill' })}
              className="text-[11px] px-2 py-1 rounded border border-app-border text-app-text hover:border-rose-500/50 hover:text-rose-400"
            >
              Stop
            </button>
          )}
          <button
            onClick={start}
            className="text-[11px] px-2 py-1 rounded border border-app-border text-app-text hover:border-app-primary hover:text-app-textStrong"
          >
            {live ? 'Restart' : 'Start'}
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={hostRef} className="absolute inset-0 p-2" />
        {status !== 'running' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-xs text-app-text/60">
              {status === 'exited' && message ? message : 'Press Start to launch the CLI in this terminal'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
