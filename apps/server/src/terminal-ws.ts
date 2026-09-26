// WebSocket bridge between a browser xterm.js instance and a PTY session.
//
// The server never interprets terminal output. Bytes go straight from the PTY
// to the emulator and keystrokes straight back, so a CLI's own TUI renders
// exactly as it would in a normal terminal, including colours, cursor movement
// and full-screen redraws.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { PtyManager } from '@opencli/terminal';
import type { OpenCLIRepository } from '@opencli/db';
import { getAdapter } from './adapters.js';

const OPEN = 1;

interface ClientState {
  sessionId: string | undefined;
  /** Unsubscribers for the currently attached session. */
  disposers: Array<() => void>;
}

/** Client -> server messages. */
type ClientMessage =
  | { type: 'start'; projectId: string; adapterId: string; mode?: string; model?: { provider: string; model: string; spec?: string } }
  | { type: 'attach'; sessionId: string }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'detach' }
  | { type: 'kill' };

export function attachTerminalGateway(
  server: { on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown },
  pty: PtyManager,
  db: OpenCLIRepository,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/terminal') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const state: ClientState = { sessionId: undefined, disposers: [] };

    const send = (payload: unknown) => {
      if (ws.readyState === OPEN) ws.send(JSON.stringify(payload));
    };

    /** Detach listeners from the previous session before switching. */
    const unbind = () => {
      for (const dispose of state.disposers.splice(0)) dispose();
    };

    const onData = (chunk: string) => send({ type: 'data', data: chunk });
    const onExit = (exit: { exitCode: number | null; signal?: number | undefined }) =>
      send({ type: 'exit', exitCode: exit.exitCode, signal: exit.signal });
    const onError = (message: string) => send({ type: 'error', message });

    const bind = (sessionId: string) => {
      const session = pty.get(sessionId);
      if (!session) {
        send({ type: 'error', message: `No such terminal session: ${sessionId}` });
        return;
      }
      unbind();
      state.sessionId = sessionId;
      state.disposers.push(
        session.on('data', onData),
        session.on('exit', onExit),
        session.on('error', onError),
      );

      // Replay retained output so a late or reconnecting client sees the screen.
      const scrollback = session.getScrollback();
      const info = session.getInfo();
      send({
        type: 'ready',
        sessionId,
        info,
        scrollback: scrollback || undefined,
        cols: info.cols,
        rows: info.rows,
      });
    };

    ws.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw));
      } catch {
        send({ type: 'error', message: 'Malformed message' });
        return;
      }

      try {
        switch (message.type) {
          case 'start': {
            const project = db.getProject(message.projectId);
            if (!project) {
              send({ type: 'error', message: 'Project not found' });
              return;
            }
            const adapter = getAdapter(message.adapterId);
            if (!adapter) {
              send({ type: 'error', message: `Unknown adapter: ${message.adapterId}` });
              return;
            }

            // The adapter decides what "interactive" means for its own CLI, so
            // the gateway never needs to know adapter-specific launch arguments.
            const command = adapter.buildInteractiveCommand({
              projectPath: project.path,
              workspacePath: project.path,
              mode: message.mode,
              model: message.model,
              environment: {},
            });

            unbind();
            const session = pty.start({
              command,
              projectId: project.id,
              adapterId: message.adapterId,
              title: message.adapterId,
            });
            bind(session.id);
            return;
          }

          case 'attach': {
            unbind();
            bind(message.sessionId);
            return;
          }

          case 'input': {
            if (state.sessionId) pty.write(state.sessionId, message.data);
            return;
          }

          case 'resize': {
            if (state.sessionId) pty.resize(state.sessionId, { cols: message.cols, rows: message.rows });
            return;
          }

          case 'kill': {
            if (state.sessionId) {
              pty.kill(state.sessionId);
              state.sessionId = undefined;
            }
            return;
          }

          case 'detach': {
            unbind();
            state.sessionId = undefined;
            return;
          }
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });

    ws.on('close', () => {
      // The PTY keeps running; only the view goes away.
      unbind();
    });
  });
}
