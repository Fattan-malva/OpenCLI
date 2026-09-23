// Git service: worktree, commit policy, integration (09-git-workspace.md)
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EventBus } from '@opencli/events';

export interface GitInfo {
  isRepository: boolean;
  rootPath?: string;
  currentBranch?: string;
  hasUncommittedChanges?: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export class GitService {
  constructor(private eventBus?: EventBus) {}

  // Detect if a path is inside a git repository
  getInfo(projectPath: string): GitInfo {
    try {
      const root = execSync('git rev-parse --show-toplevel', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      const branch = execSync('git branch --show-current', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      let hasUncommitted = false;
      try {
        const status = execSync('git status --porcelain', {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();
        hasUncommitted = status.length > 0;
      } catch {
        // Ignore
      }

      return {
        isRepository: true,
        rootPath: root,
        currentBranch: branch,
        hasUncommittedChanges: hasUncommitted,
      };
    } catch {
      return { isRepository: false };
    }
  }

  // Create a git worktree for task isolation
  createWorktree(
    projectPath: string,
    taskId: string,
    branchName?: string,
  ): WorktreeInfo | undefined {
    const info = this.getInfo(projectPath);
    if (!info.isRepository || !info.rootPath) return undefined;

    const branch = branchName ?? `opencli/task-${taskId}`;
    const worktreePath = join(info.rootPath, '.opencli', 'workspaces', taskId);

    // Ensure parent directory exists
    const parentDir = join(info.rootPath, '.opencli', 'workspaces');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    try {
      // Create branch if it doesn't exist
      try {
        execSync(`git branch ${branch}`, {
          cwd: info.rootPath,
          stdio: 'ignore',
          timeout: 10000,
        });
      } catch {
        // Branch may already exist
      }

      // Create worktree
      execSync(`git worktree add "${worktreePath}" ${branch}`, {
        cwd: info.rootPath,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const head = execSync('git rev-parse HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      this.eventBus?.emit({
        type: 'workspace.created',
        payload: { taskId, path: worktreePath, branch },
      });

      return { path: worktreePath, branch, head };
    } catch (err: any) {
      // If worktree add fails, try removing stale worktree first
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: info.rootPath,
          stdio: 'ignore',
          timeout: 10000,
        });
        // Retry
        execSync(`git worktree add "${worktreePath}" ${branch}`, {
          cwd: info.rootPath,
          encoding: 'utf-8',
          timeout: 30000,
        });
        const head = execSync('git rev-parse HEAD', {
          cwd: worktreePath,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();
        return { path: worktreePath, branch, head };
      } catch {
        return undefined;
      }
    }
  }

  // Remove a worktree
  removeWorktree(projectPath: string, taskId: string): boolean {
    const info = this.getInfo(projectPath);
    if (!info.isRepository || !info.rootPath) return false;

    const worktreePath = join(info.rootPath, '.opencli', 'workspaces', taskId);
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: info.rootPath,
        timeout: 30000,
      });
      return true;
    } catch {
      return false;
    }
  }

  // List all OpenCLI worktrees
  listWorktrees(projectPath: string): WorktreeInfo[] {
    const info = this.getInfo(projectPath);
    if (!info.isRepository || !info.rootPath) return [];

    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: info.rootPath,
        encoding: 'utf-8',
        timeout: 10000,
      });

      const worktrees: WorktreeInfo[] = [];
      const blocks = output.split('\n\n');
      for (const block of blocks) {
        const lines = block.split('\n');
        const pathLine = lines.find((l) => l.startsWith('worktree '));
        const headLine = lines.find((l) => l.startsWith('HEAD '));
        const branchLine = lines.find((l) => l.startsWith('branch '));

        if (pathLine && headLine) {
          const path = pathLine.substring('worktree '.length);
          // Only include OpenCLI worktrees
          if (path.includes('.opencli/workspaces/')) {
            worktrees.push({
              path,
              branch: branchLine?.substring('branch refs/heads/'.length) ?? 'detached',
              head: headLine.substring('HEAD '.length),
            });
          }
        }
      }
      return worktrees;
    } catch {
      return [];
    }
  }

  // Create a commit in a worktree
  commit(
    worktreePath: string,
    message: string,
    files?: string[],
  ): { success: boolean; hash?: string; error?: string } {
    try {
      if (files && files.length > 0) {
        for (const file of files) {
          execSync(`git add "${file}"`, { cwd: worktreePath, timeout: 10000 });
        }
      } else {
        execSync('git add -A', { cwd: worktreePath, timeout: 10000 });
      }

      const hash = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();

      const shortHash = hash.match(/\[[\w]+\s+([a-f0-9]+)\]/)?.[1] ?? hash;

      this.eventBus?.emit({
        type: 'git.commit_created',
        payload: { path: worktreePath, message, hash: shortHash },
      });

      return { success: true, hash: shortHash };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Merge a worktree branch back to main
  merge(
    projectPath: string,
    branch: string,
  ): { success: boolean; error?: string; conflict?: boolean } {
    const info = this.getInfo(projectPath);
    if (!info.isRepository || !info.rootPath) {
      return { success: false, error: 'Not a git repository' };
    }

    try {
      execSync(`git merge ${branch} --no-edit`, {
        cwd: info.rootPath,
        encoding: 'utf-8',
        timeout: 30000,
      });
      return { success: true };
    } catch (err: any) {
      const isConflict = err.stdout?.includes('CONFLICT') ?? err.message?.includes('CONFLICT');
      if (isConflict) {
        this.eventBus?.emit({
          type: 'git.merge_conflict',
          payload: { branch, error: err.message },
        });
      }
      return { success: false, error: err.message, conflict: isConflict };
    }
  }

  // Get diff for a worktree
  getDiff(worktreePath: string, staged = false): string {
    try {
      const flag = staged ? '--staged' : '';
      return execSync(`git diff ${flag}`, {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch {
      return '';
    }
  }
}
