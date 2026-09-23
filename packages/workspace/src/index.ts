// Workspace management: file scopes, ownership, locks, conflict detection (07/09)
import { randomUUID } from 'node:crypto';
import type { Lock, LockOwnerType, Workspace, WorkspaceStatus } from '@opencli/domain';
import type { EventBus } from '@opencli/events';

export interface FileScope {
  taskId: string;
  patterns: string[]; // glob patterns like "src/auth/**"
}

export interface LockRequest {
  projectId: string;
  resource: string;
  ownerType: LockOwnerType;
  ownerId: string;
  ttlMs?: number;
}

export class WorkspaceService {
  private locks = new Map<string, Lock>();
  private fileScopes = new Map<string, FileScope>(); // taskId → FileScope
  private workspaces = new Map<string, Workspace>();

  constructor(private eventBus: EventBus) {}

  // === File scope management ===

  registerFileScope(taskId: string, patterns: string[]): void {
    this.fileScopes.set(taskId, { taskId, patterns });
  }

  getFileScope(taskId: string): FileScope | undefined {
    return this.fileScopes.get(taskId);
  }

  removeFileScope(taskId: string): void {
    this.fileScopes.delete(taskId);
  }

  // Check if two tasks have overlapping file scopes
  checkScopeConflict(taskId1: string, taskId2: string): boolean {
    const scope1 = this.fileScopes.get(taskId1);
    const scope2 = this.fileScopes.get(taskId2);
    if (!scope1 || !scope2) return false;

    // Simple prefix-based overlap check
    for (const p1 of scope1.patterns) {
      for (const p2 of scope2.patterns) {
        if (p1.startsWith(p2) || p2.startsWith(p1) || p1 === p2) {
          return true;
        }
      }
    }
    return false;
  }

  // Get all tasks that conflict with a given task
  getConflictingTasks(taskId: string): string[] {
    const conflicts: string[] = [];
    for (const otherId of this.fileScopes.keys()) {
      if (otherId !== taskId && this.checkScopeConflict(taskId, otherId)) {
        conflicts.push(otherId);
      }
    }
    return conflicts;
  }

  // === Lock management ===

  acquireLock(request: LockRequest): Lock | undefined {
    // Check if resource is already locked by another owner
    for (const lock of this.locks.values()) {
      if (
        lock.projectId === request.projectId &&
        lock.resource === request.resource &&
        lock.ownerId !== request.ownerId
      ) {
        // Check if lock is expired
        if (lock.expiresAt && new Date(lock.expiresAt) < new Date()) {
          this.releaseLock(lock.id);
        } else {
          return undefined; // Resource is locked
        }
      }
    }

    const ttl = request.ttlMs ?? 300_000; // 5 minutes default
    const lock: Lock = {
      id: randomUUID(),
      projectId: request.projectId,
      resource: request.resource,
      ownerType: request.ownerType,
      ownerId: request.ownerId,
      expiresAt: new Date(Date.now() + ttl).toISOString(),
      createdAt: new Date().toISOString(),
    };

    this.locks.set(lock.id, lock);

    this.eventBus.emit({
      type: 'workspace.locked',
      payload: { lockId: lock.id, resource: lock.resource, ownerType: lock.ownerType, ownerId: lock.ownerId },
    });

    return lock;
  }

  releaseLock(lockId: string): boolean {
    const lock = this.locks.get(lockId);
    if (!lock) return false;

    this.locks.delete(lockId);

    this.eventBus.emit({
      type: 'workspace.released',
      payload: { lockId, resource: lock.resource },
    });

    return true;
  }

  // Release all locks held by an owner
  releaseOwnerLocks(ownerId: string): number {
    let released = 0;
    for (const [id, lock] of this.locks) {
      if (lock.ownerId === ownerId) {
        this.locks.delete(id);
        released++;
      }
    }
    return released;
  }

  // Release stale locks (expired)
  releaseStaleLocks(): number {
    let released = 0;
    const now = new Date();
    for (const [id, lock] of this.locks) {
      if (lock.expiresAt && new Date(lock.expiresAt) < now) {
        this.locks.delete(id);
        released++;
      }
    }
    return released;
  }

  isResourceLocked(projectId: string, resource: string): boolean {
    for (const lock of this.locks.values()) {
      if (
        lock.projectId === projectId &&
        lock.resource === resource &&
        (!lock.expiresAt || new Date(lock.expiresAt) > new Date())
      ) {
        return true;
      }
    }
    return false;
  }

  getLocksByProject(projectId: string): Lock[] {
    return Array.from(this.locks.values()).filter((l) => l.projectId === projectId);
  }

  // === Workspace management ===

  createWorkspace(
    projectId: string,
    taskId: string,
    path: string,
    branch?: string,
  ): Workspace {
    const ws: Workspace = {
      id: randomUUID(),
      projectId,
      taskId,
      path,
      branch,
      status: 'created',
      createdAt: new Date().toISOString(),
    };
    this.workspaces.set(ws.id, ws);
    return ws;
  }

  updateWorkspaceStatus(id: string, status: WorkspaceStatus): Workspace | undefined {
    const ws = this.workspaces.get(id);
    if (!ws) return undefined;
    ws.status = status;

    if (status === 'conflict') {
      this.eventBus.emit({
        type: 'workspace.conflict',
        payload: { workspaceId: id, path: ws.path },
      });
    }

    return ws;
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  // Check if a path conflicts with any active workspace scopes
  checkPathConflict(path: string, excludeTaskId?: string): string | undefined {
    for (const scope of this.fileScopes.values()) {
      if (scope.taskId === excludeTaskId) continue;
      for (const pattern of scope.patterns) {
        if (path.startsWith(pattern.replace('/**', '/')) || path.includes(pattern.replace('/**', '/'))) {
          return scope.taskId;
        }
      }
    }
    return undefined;
  }

  // Cleanup released workspaces
  getActiveWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values()).filter((ws) => ws.status !== 'released');
  }
}
