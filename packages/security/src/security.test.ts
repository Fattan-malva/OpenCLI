import { describe, it, expect } from 'vitest';
import { PermissionEvaluator, evaluateCommandRisk, redactSecrets } from './index.js';

describe('PermissionEvaluator', () => {
  it('grants task-level permission', () => {
    const pe = new PermissionEvaluator();
    pe.requestApproval({
      level: 'task',
      permissionClass: 'filesystem.write',
      taskId: 'T1',
      agentId: 'opencode',
    });

    expect(pe.hasPermission('opencode', 'filesystem.write', { taskId: 'T1' })).toBe(true);
    expect(pe.hasPermission('opencode', 'filesystem.write', { taskId: 'T2' })).toBe(false);
  });

  it('grants project-level permission', () => {
    const pe = new PermissionEvaluator();
    pe.requestApproval({
      level: 'project',
      permissionClass: 'git.write',
      projectId: 'P1',
      agentId: 'claude',
    });

    expect(pe.hasPermission('claude', 'git.write', { projectId: 'P1' })).toBe(true);
    expect(pe.hasPermission('claude', 'git.write', { projectId: 'P2' })).toBe(false);
  });

  it('grants global permission', () => {
    const pe = new PermissionEvaluator();
    pe.requestApproval({
      level: 'global',
      permissionClass: 'network.access',
      agentId: 'opencode',
    });

    expect(pe.hasPermission('opencode', 'network.access', { projectId: 'any' })).toBe(true);
  });

  it('revokes approval', () => {
    const pe = new PermissionEvaluator();
    const approval = pe.requestApproval({
      level: 'task',
      permissionClass: 'filesystem.write',
      taskId: 'T1',
      agentId: 'opencode',
    });

    expect(pe.hasPermission('opencode', 'filesystem.write', { taskId: 'T1' })).toBe(true);
    pe.revokeApproval(approval.id);
    expect(pe.hasPermission('opencode', 'filesystem.write', { taskId: 'T1' })).toBe(false);
  });
});

describe('evaluateCommandRisk', () => {
  it('marks rm -rf as critical', () => {
    expect(evaluateCommandRisk({ executable: 'rm', arguments: ['-rf', '/tmp/test'], workingDirectory: '/', environment: {}, riskLevel: 'low' })).toBe('critical');
  });

  it('marks git push --force as critical', () => {
    expect(evaluateCommandRisk({ executable: 'git', arguments: ['push', '--force'], workingDirectory: '/', environment: {}, riskLevel: 'low' })).toBe('critical');
  });

  it('marks git commit as medium', () => {
    expect(evaluateCommandRisk({ executable: 'git', arguments: ['commit', '-m', 'test'], workingDirectory: '/', environment: {}, riskLevel: 'low' })).toBe('medium');
  });

  it('marks ls as low', () => {
    expect(evaluateCommandRisk({ executable: 'ls', arguments: [], workingDirectory: '/', environment: {}, riskLevel: 'low' })).toBe('low');
  });
});

describe('redactSecrets', () => {
  it('redacts API keys', () => {
    const input = 'Using sk-abc123def456ghi789jkl012mno';
    expect(redactSecrets(input)).toContain('[REDACTED]');
    expect(redactSecrets(input)).not.toContain('sk-abc123');
  });

  it('redacts GitHub tokens', () => {
    const input = 'Token: ghp_abcdefghijklmnopqrstuvwxyz123456';
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test';
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('does not redact normal text', () => {
    const input = 'Hello world, this is a normal sentence.';
    expect(redactSecrets(input)).toBe(input);
  });
});
