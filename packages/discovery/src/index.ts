// OS detection, PATH scanning, agent registry (10-installation-discovery.md)
import { execSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Agent, DetectionResult } from '@opencli/domain';

export type Platform = 'win32' | 'darwin' | 'linux';

export interface OSInfo {
  platform: Platform;
  arch: string;
  homeDir: string;
  pathSeparator: string;
}

export function detectOS(): OSInfo {
  return {
    platform: process.platform as Platform,
    arch: process.arch,
    homeDir: homedir(),
    pathSeparator: process.platform === 'win32' ? ';' : ':',
  };
}

export function getPathDirs(): string[] {
  const pathEnv = process.env.PATH ?? '';
  return pathEnv.split(detectOS().pathSeparator).filter(Boolean);
}

export function findExecutable(name: string): string | undefined {
  const os = detectOS();
  const extensions = os.platform === 'win32' ? ['.exe', '.cmd', '.ps1', ''] : [''];
  const dirs = getPathDirs();

  for (const dir of dirs) {
    for (const ext of extensions) {
      const fullPath = join(dir, `${name}${ext}`);
      try {
        if (existsSync(fullPath) && statSync(fullPath).isFile()) {
          return fullPath;
        }
      } catch {
        // Skip inaccessible files
      }
    }
  }
  return undefined;
}

/** Full path to cmd.exe — bare `cmd.exe` is not always on PATH for Node child processes. */
export function windowsCmdPath(): string {
  const root = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  return join(root, 'System32', 'cmd.exe');
}

export interface ResolvedSpawn {
  command: string;
  args: string[];
  shell: boolean;
}

/** CLI command name per adapter — resolved via PATH, like typing in a terminal. */
export const ADAPTER_COMMANDS: Record<string, string> = {
  opencode: 'opencode',
  kilocode: 'kilo',
  claude: 'claude',
};

export function adapterCommand(adapterId: string): string | undefined {
  return ADAPTER_COMMANDS[adapterId];
}

/** Resolve executable + args for cross-platform child_process.spawn. */
export function resolveSpawnCommand(exe: string, args: string[]): ResolvedSpawn {
  // Always use shell so bare command names (opencode, kilo, claude) resolve via PATH.
  return { command: exe, args, shell: true };
}

export function runExecutable(
  exe: string,
  args: string[] = [],
  options?: { timeout?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeoutMs = options?.timeout ?? 10_000;
  const { command, args: spawnArgs, shell } = resolveSpawnCommand(exe, args);

  return new Promise((resolve) => {
    const child = spawn(command, spawnArgs, {
      cwd: options?.cwd,
      windowsHide: true,
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode });
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(1);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err: Error) => {
      stderr = stderr || err.message;
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

export function runCommand(
  command: string,
  options?: { timeout?: number; cwd?: string },
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      timeout: options?.timeout ?? 10000,
      cwd: options?.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString()?.trim() ?? '',
      stderr: err.stderr?.toString()?.trim() ?? err.message,
      exitCode: err.status ?? 1,
    };
  }
}

export function getVersion(executable: string, args: string[] = ['--version']): string | undefined {
  const result = runCommand(`"${executable}" ${args.join(' ')}`, { timeout: 10000 });
  if (result.exitCode === 0 && result.stdout) {
    // Extract version number from output
    const versionMatch = result.stdout.match(/(\d+\.\d+[\.\d]*)/);
    return versionMatch?.[1] ?? result.stdout.split('\n')[0];
  }
  return undefined;
}

export function checkHealth(executable: string): { healthy: boolean; message?: string } {
  const result = runCommand(`"${executable}" --version`, { timeout: 10000 });
  return {
    healthy: result.exitCode === 0,
    message: result.exitCode === 0 ? result.stdout : result.stderr,
  };
}

export interface AgentDefinition {
  id: string;
  name: string;
  executables: string[];
  adapterId: string;
  icon?: string;
  homepage?: string;
  installCommands?: Partial<Record<Platform, string[]>>;
  capabilities?: string[];
}

export const SUPPORTED_AGENTS: AgentDefinition[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    executables: ['opencode'],
    adapterId: 'opencode',
    icon: 'opencode',
    homepage: 'https://opencode.ai',
    installCommands: {
      win32: ['npm install -g opencode-ai@latest'],
      darwin: ['brew install anomalyco/tap/opencode'],
      linux: ['curl -fsSL https://opencode.ai/install | bash'],
    },
    capabilities: ['Code generation', 'Terminal access', 'File editing', 'Web browsing'],
  },
  {
    id: 'kilocode',
    name: 'Kilo Code',
    executables: ['kilocode', 'kilo'],
    adapterId: 'kilocode',
    icon: 'kilocode',
    homepage: 'https://kilo.ai',
    installCommands: {
      win32: ['npm install -g @kilocode/cli'],
      darwin: ['brew install Kilo-Org/tap/kilo'],
      linux: ['curl -fsSL https://kilo.ai/cli/install | bash'],
    },
    capabilities: ['Code generation', 'Terminal access', 'File editing', 'MCP tools'],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    executables: ['claude'],
    adapterId: 'claude',
    icon: 'claude',
    homepage: 'https://claude.com/claude-code',
    installCommands: {
      win32: ['npm install -g @anthropic-ai/claude-code'],
      darwin: ['npm install -g @anthropic-ai/claude-code'],
      linux: ['curl -fsSL https://claude.ai/install.sh | bash'],
    },
    capabilities: ['Code generation', 'Terminal access', 'File editing', 'Advanced reasoning'],
  },
];

export function discoverAgent(def: AgentDefinition): DetectionResult {
  for (const exec of def.executables) {
    const path = findExecutable(exec);
    if (path) {
      const version = getVersion(path);
      return {
        detected: true,
        executable: exec,
        path,
        version,
      };
    }
  }
  return { detected: false };
}

export function discoverAllAgents(): Array<{
  definition: AgentDefinition;
  result: DetectionResult;
}> {
  return SUPPORTED_AGENTS.map((def) => ({
    definition: def,
    result: discoverAgent(def),
  }));
}

export function agentFromDetection(
  def: AgentDefinition,
  detection: DetectionResult,
): Agent | undefined {
  if (!detection.detected || !detection.path) return undefined;
  const health = checkHealth(detection.path);
  return {
    id: def.id,
    name: def.name,
    executable: detection.executable ?? def.executables[0],
    path: detection.path,
    version: detection.version,
    status: health.healthy ? 'ready' : 'error',
    capabilities: [],
    modes: [],
    adapterId: def.adapterId,
    installed: true,
  };
}
