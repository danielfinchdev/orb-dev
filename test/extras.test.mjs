// Pure pieces: which terminal Ctrl+J opens, and how an agent's failure is explained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terminalPlan } from '../src/main/terminal.mjs';
import { explainFailure } from '../src/core/agent-errors.mjs';

test('Ctrl+J: Warp si está instalado, si no Windows Terminal o PowerShell; se puede forzar uno', () => {
  const dir = 'D:\\Orb\\mi;web';
  const all = { warp: 'C:\\W\\warp.exe', wt: 'C:\\A\\wt.exe', powershell: 'powershell.exe', cmd: 'cmd.exe' };
  const warp = terminalPlan('auto', dir, all, 'win32');
  assert.equal(warp.name, 'Warp');
  assert.equal(warp.url, `warp://action/new_tab?path=${encodeURIComponent(dir)}`);
  assert.equal(warp.fallback.cmd, all.warp);
  const wt = terminalPlan('auto', dir, { ...all, warp: null }, 'win32');
  assert.deepEqual([wt.cmd, wt.args], [all.wt, ['-d', 'D:\\Orb\\mi\\;web']]);
  assert.equal(terminalPlan('auto', dir, { ...all, warp: null, wt: null }, 'win32').name, 'PowerShell');
  assert.equal(terminalPlan('cmd', dir, all, 'win32').cwd, dir);
  assert.throws(() => terminalPlan('warp', dir, { ...all, warp: null }, 'win32'), /Warp no está instalado/);
  assert.equal(terminalPlan('auto', '/home/a', { warp: '/usr/bin/warp-terminal', linux: 'gnome-terminal' }, 'linux').name, 'Warp');
  assert.equal(terminalPlan('auto', '/home/a', { warp: null, linux: 'gnome-terminal' }, 'linux').cmd, 'gnome-terminal');
});

test('los fallos de los agentes se explican en palabras claras', () => {
  assert.equal(explainFailure('Cursor', 'Free plan users cannot use the agent. Upgrade to Pro.').kind, 'plan');
  assert.match(explainFailure('Cursor', 'This feature requires a paid subscription').reason, /plan de Cursor/);
  assert.equal(explainFailure('Codex', 'Error: Not logged in. Run `codex login`').kind, 'login');
  assert.equal(explainFailure('Codex', 'unknown model gpt-9').kind, 'model');
  assert.equal(explainFailure('Claude', 'getaddrinfo ENOTFOUND api.anthropic.com').kind, 'network');
  assert.equal(explainFailure('Claude', 'algo salió mal'), null);
});
