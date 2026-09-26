import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTerminalEnv, resolveLaunchTarget, unwrapShim } from './executable.js';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'opencli-launcher-'));
}

const win32 = 'win32' as NodeJS.Platform;

describe('resolveLaunchTarget on POSIX', () => {
  it('passes the command through untouched', () => {
    const target = resolveLaunchTarget('opencode', ['--help'], { platform: 'linux' });
    expect(target.file).toBe('opencode');
    expect(target.args).toEqual(['--help']);
    expect(target.viaShell).toBe(false);
  });
});

describe('unwrapShim', () => {
  it('follows the single-line npm shim that forwards to a .exe', () => {
    const dir = scratch();
    const binDir = join(dir, 'node_modules', 'pkg', 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'cli.exe'), 'MZ');
    const shim = join(dir, 'cli.cmd');
    writeFileSync(
      shim,
      ['@ECHO off', 'SET dp0=%~dp0', '"%dp0%\\node_modules\\pkg\\bin\\cli.exe"   %*', ''].join('\r\n'),
    );

    expect(unwrapShim(shim)).toBe(join(binDir, 'cli.exe'));
  });

  it('ignores the saved interpreter path npm shims use for recursion checks', () => {
    // Real shape emitted by npm for extensionless Node CLIs: `%_prog%` expands
    // to cmd.exe and must never be mistaken for the program to run.
    const dir = scratch();
    writeFileSync(
      join(dir, 'tool'),
      '#!/usr/bin/env node\nconsole.log(1)\n',
    );
    writeFileSync(
      join(dir, 'tool.cmd'),
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\tool" %*\r\n',
    );

    const target = resolveLaunchTarget('tool', ['--version'], { platform: win32, env: { PATH: dir } });

    expect(target.strategy).toBe('node-script');
    expect(target.file).toBe(process.execPath);
    expect(target.args).toEqual([join(dir, 'tool'), '--version']);
  });

  it('skips a second batch shim instead of chaining into it', () => {
    const dir = scratch();
    const shim = join(dir, 'a.cmd');
    writeFileSync(shim, ['@ECHO off', '"%dp0%\\b.cmd" %*', ''].join('\r\n'));
    writeFileSync(join(dir, 'b.cmd'), '@ECHO off\r\n');

    expect(unwrapShim(shim)).toBeUndefined();
  });

  it('ignores batch builtins that appear in quotes', () => {
    const dir = scratch();
    const shim = join(dir, 'a.cmd');
    writeFileSync(shim, ['@ECHO off', 'echo "hello world"', 'call "%dp0%\\real.exe" %*', ''].join('\r\n'));
    writeFileSync(join(dir, 'real.exe'), 'MZ');

    expect(unwrapShim(shim)).toBe(join(dir, 'real.exe'));
  });
});

describe('resolveLaunchTarget on Windows', () => {
  it('prefers a native binary over the .cmd shim in the same directory', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'mytool.exe'), 'MZ');
    writeFileSync(join(dir, 'mytool.cmd'), '@ECHO off\r\n');

    const target = resolveLaunchTarget('mytool', ['run'], {
      platform: win32,
      env: { PATH: dir },
    });

    expect(target.strategy).toBe('binary');
    expect(target.viaShell).toBe(false);
    expect(target.file).toBe(join(dir, 'mytool.exe'));
    expect(target.args).toEqual(['run']);
  });

  it('unwraps a .cmd shim to the real binary it forwards to', () => {
    const dir = scratch();
    const binDir = join(dir, 'node_modules', 'pkg', 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'tool.exe'), 'MZ');
    writeFileSync(join(dir, 'tool.cmd'), '@ECHO off\r\nSET dp0=%~dp0\r\n"%dp0%\\node_modules\\pkg\\bin\\tool.exe" %*\r\n');

    const target = resolveLaunchTarget('tool', [], { platform: win32, env: { PATH: dir } });

    expect(target.strategy).toBe('binary');
    expect(target.file).toBe(join(binDir, 'tool.exe'));
  });

  it('runs an extensionless shebang script through node', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'tool.js'), '#!/usr/bin/env node\nconsole.log(1)\n');
    writeFileSync(join(dir, 'tool.cmd'), '@ECHO off\r\nSET dp0=%~dp0\r\n"%dp0%\\tool.js" %*\r\n');

    const target = resolveLaunchTarget('tool', ['--flag'], { platform: win32, env: { PATH: dir } });

    expect(target.strategy).toBe('node-script');
    expect(target.file).toBe(process.execPath);
    expect(target.args).toEqual([join(dir, 'tool.js'), '--flag']);
  });

  it('falls back to cmd.exe when only a batch shim exists', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'tool.cmd'), '@ECHO off\r\nECHO hand-written\r\n');

    const target = resolveLaunchTarget('tool', ['a', 'b'], { platform: win32, env: { PATH: dir } });

    expect(target.strategy).toBe('cmd-shim');
    expect(target.viaShell).toBe(true);
    expect(target.file.toLowerCase()).toContain('cmd.exe');
    // `/d` guards against AutoRun, and the shim path must stay unquoted
    // because ConPTY already quotes each argument.
    expect(target.args[0]).toBe('/d');
    expect(target.args[1]).toBe('/c');
    expect(target.args[2]).toBe(join(dir, 'tool.cmd'));
    expect(target.args.slice(3)).toEqual(['a', 'b']);
  });

  it('refuses to launch a PowerShell shim', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'tool.ps1'), '#!/usr/bin/env pwsh\n');

    expect(() => resolveLaunchTarget('tool', [], { platform: win32, env: { PATH: dir } })).toThrow(
      /PowerShell shim/,
    );
  });

  it('reports a clear error when the command is not on PATH', () => {
    expect(() =>
      resolveLaunchTarget('definitely-not-installed-xyz', [], { platform: win32, env: { PATH: scratch() } }),
    ).toThrow(/not found on PATH/);
  });

  it('resolves an absolute path directly', () => {
    const dir = scratch();
    const exe = join(dir, 'tool.exe');
    writeFileSync(exe, 'MZ');

    const target = resolveLaunchTarget(exe, [], { platform: win32, env: { PATH: '' } });

    expect(target.file).toBe(exe);
    expect(target.viaShell).toBe(false);
  });
});

describe('buildTerminalEnv', () => {
  it('forces a colour-capable TERM and drops CI', () => {
    const env = buildTerminalEnv({ CI: 'true', TERM: 'dumb', PATH: '/bin' });
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
    expect(env.CI).toBeUndefined();
    expect(env.PATH).toBe('/bin');
  });

  it('applies overrides last and can unset a variable', () => {
    const env = buildTerminalEnv({ A: '1', B: '2' }, { A: 'override', B: undefined });
    expect(env.A).toBe('override');
    expect(env.B).toBeUndefined();
  });
});
