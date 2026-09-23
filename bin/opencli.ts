#!/usr/bin/env node
// OpenCLI entry point — starts server + serves UI
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const ROOT = join(__dirname, '..');
const DATA_DIR = process.env.OPENCLI_DATA ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.opencli');

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

const banner = `
  ╔══════════════════════════════════════════╗
  ║           🚀  OpenCLI  v0.1.0            ║
  ║     Universal AI Agent Orchestration     ║
  ╚══════════════════════════════════════════╝
`;

console.log(banner);

// Check if UI is built
const uiDist = join(ROOT, 'apps', 'ui', 'dist');
const uiReady = existsSync(join(uiDist, 'index.html'));

if (!uiReady) {
  console.log('  ⚠  UI not built yet. Building...');
  const buildUi = spawn('npm', ['run', 'build', '-w', '@opencli/ui'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  buildUi.on('exit', (code) => {
    if (code === 0) {
      console.log('  ✓  UI built successfully.\n');
      startServer();
    } else {
      console.error('  ✗  UI build failed. Starting server only...');
      startServer();
    }
  });
} else {
  startServer();
}

function startServer() {
  const port = process.env.PORT ?? '3000';
  console.log(`  → Starting server on http://localhost:${port} ...\n`);

  const server = spawn('npx', ['tsx', 'apps/server/src/index.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PORT: port },
  });

  server.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n  Shutting down...');
    server.kill('SIGTERM');
    process.exit(0);
  });
}
