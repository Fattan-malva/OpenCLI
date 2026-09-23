import type { ApprovalLevel, CommandSpec, PermissionSet } from '@opencli/domain';

// === Permission classes (11-security.md) ===

export const PERMISSION_CLASSES = [
  { id: 'filesystem.read', description: 'Read files within project scope' },
  { id: 'filesystem.write', description: 'Write/create files within project scope' },
  { id: 'filesystem.delete', description: 'Delete files within project scope' },
  { id: 'process.execute', description: 'Execute system commands' },
  { id: 'network.access', description: 'Access network resources' },
  { id: 'git.write', description: 'Create commits and branches' },
  { id: 'git.push', description: 'Push to remote repositories' },
  { id: 'package.install', description: 'Install packages via package managers' },
  { id: 'system.modify', description: 'Modify system configuration' },
  { id: 'credential.read', description: 'Read secrets from credential store' },
] as const;

export type PermissionClassId = (typeof PERMISSION_CLASSES)[number]['id'];

// === Permission evaluator ===

export interface ApprovalRecord {
  id: string;
  level: ApprovalLevel;
  permissionClass: PermissionClassId;
  projectId?: string;
  taskId?: string;
  agentId: string;
  command?: CommandSpec;
  approvedAt: string;
  expiresAt?: string;
}

export class PermissionEvaluator {
  private approvals: ApprovalRecord[] = [];

  hasPermission(
    agentId: string,
    permissionClass: PermissionClassId,
    scope: { projectId?: string; taskId?: string },
  ): boolean {
    // Check task-level approval
    if (scope.taskId) {
      const taskApproval = this.approvals.find(
        (a) =>
          a.agentId === agentId &&
          a.permissionClass === permissionClass &&
          a.level === 'task' &&
          a.taskId === scope.taskId &&
          this.isActive(a),
      );
      if (taskApproval) return true;
    }

    // Check project-level approval
    if (scope.projectId) {
      const projectApproval = this.approvals.find(
        (a) =>
          a.agentId === agentId &&
          a.permissionClass === permissionClass &&
          a.level === 'project' &&
          a.projectId === scope.projectId &&
          this.isActive(a),
      );
      if (projectApproval) return true;
    }

    // Check global approval
    const globalApproval = this.approvals.find(
      (a) =>
        a.agentId === agentId &&
        a.permissionClass === permissionClass &&
        a.level === 'global' &&
        this.isActive(a),
    );
    if (globalApproval) return true;

    return false;
  }

  requestApproval(
    request: Omit<ApprovalRecord, 'id' | 'approvedAt'>,
  ): ApprovalRecord {
    const record: ApprovalRecord = {
      ...request,
      id: crypto.randomUUID(),
      approvedAt: new Date().toISOString(),
    };
    this.approvals.push(record);
    return record;
  }

  revokeApproval(id: string): boolean {
    const idx = this.approvals.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.approvals.splice(idx, 1);
    return true;
  }

  private isActive(approval: ApprovalRecord): boolean {
    if (approval.expiresAt && new Date(approval.expiresAt) < new Date()) {
      return false;
    }
    return true;
  }

  listApprovals(projectId?: string): ApprovalRecord[] {
    if (projectId) {
      return this.approvals.filter(
        (a) => a.projectId === projectId || a.level === 'global',
      );
    }
    return [...this.approvals];
  }
}

// === Command risk evaluator ===

export function evaluateCommandRisk(cmd: CommandSpec): CommandSpec['riskLevel'] {
  const dangerous = [
    /rm\s+-rf/,
    /rmdir\s+\/s/,
    /del\s+\/[sfq]/,
    /git\s+(push\s+--force|reset\s+--hard)/,
    /git\s+push.*--force/,
    /DROP\s+TABLE/i,
    /DROP\s+DATABASE/i,
    /sudo/,
    /format\s+[a-z]:/i,
  ];

  const high = [
    /rm\s+/,
    /rmdir/,
    /del\s+/,
    /git\s+(push|reset)/,
    /npm\s+install\s+-g/,
    /pip\s+install\s+-g/,
    /winget\s+install/,
    /brew\s+install/,
    /apt\s+(install|remove)/,
  ];

  const medium = [/git\s+(commit|merge|checkout|branch)/, /npm\s+(install|uninstall)/, /yarn/];

  const full = `${cmd.executable} ${cmd.arguments.join(' ')}`.toLowerCase();

  if (dangerous.some((p) => p.test(full))) return 'critical';
  if (high.some((p) => p.test(full))) return 'high';
  if (medium.some((p) => p.test(full))) return 'medium';
  return 'low';
}

// === Secret redaction ===

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /xoxb-[a-zA-Z0-9-]+/,
  /AKIA[A-Z0-9]{16}/,
  /Bearer\s+[a-zA-Z0-9._-]+/,
  /api[_-]?key[=:]\s*["']?[a-zA-Z0-9._-]{16,}/i,
  /token[=:]\s*["']?[a-zA-Z0-9._-]{16,}/i,
];

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

// === Audit log ===

export interface AuditEntry {
  timestamp: string;
  agentId: string;
  taskId?: string;
  projectId?: string;
  command?: CommandSpec;
  permissionClass: PermissionClassId;
  approvalId?: string;
  result: 'approved' | 'denied' | 'executed' | 'failed';
  details?: string;
}

export class AuditLog {
  private entries: AuditEntry[] = [];

  record(entry: Omit<AuditEntry, 'timestamp'>): void {
    this.entries.push({
      ...entry,
      timestamp: new Date().toISOString(),
      command: entry.command
        ? { ...entry.command, environment: {} } // Don't store env with potential secrets
        : undefined,
    });
  }

  getEntries(filter?: { projectId?: string; agentId?: string; limit?: number }): AuditEntry[] {
    let entries = this.entries;
    if (filter?.projectId) entries = entries.filter((e) => e.projectId === filter.projectId);
    if (filter?.agentId) entries = entries.filter((e) => e.agentId === filter.agentId);
    if (filter?.limit) entries = entries.slice(-filter.limit);
    return entries;
  }
}
