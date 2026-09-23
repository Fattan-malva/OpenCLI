// OS detection, PATH scanning, agent registry (10-installation-discovery.md)
import { execSync } from 'node:child_process';
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
  installCommands?: Record<Platform, string>;
}

export const SUPPORTED_AGENTS: AgentDefinition[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    executables: ['opencode'],
    adapterId: 'opencode',
  },
  {
    id: 'kilocode',
    name: 'Kilo Code',
    executables: ['kilocode', 'kilo'],
    adapterId: 'kilocode',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    executables: ['claude'],
    adapterId: 'claude',
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
