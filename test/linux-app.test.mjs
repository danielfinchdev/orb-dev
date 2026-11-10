// 3.7: the engine's side of a Linux desktop: the terminals Ctrl+J and the project's actions open, and the editors found
// outside the desktop's PATH (the Linux app itself comes back in a later version).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { terminalPlan, linuxTerminal, externalEnv, terminalChoices, LINUX_TERMINALS } from '../src/engine/host/terminal.mjs';
import { actionPlan, findEditors } from '../src/engine/host/editors.mjs';
import { ROOT } from './helpers.mjs';

const found = { warp: null, linux: 'x-terminal-emulator', installed: ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'] };

test('Ctrl+J en Linux: la terminal del sistema o la elegida, cada una con la carpeta a su manera', () => {
  const dir = '/home/ana/Orb/mi web';
  assert.deepEqual(terminalPlan('auto', dir, found, 'linux'), { name: 'x-terminal-emulator', cmd: 'x-terminal-emulator', args: [], cwd: dir });
  assert.deepEqual(terminalPlan('gnome-terminal', dir, found, 'linux').args, [`--working-directory=${dir}`]);
  assert.deepEqual(terminalPlan('konsole', dir, found, 'linux').args, ['--workdir', dir]);
  assert.equal(terminalPlan('xterm', dir, found, 'linux').cwd, dir);
  assert.throws(() => terminalPlan('kitty', dir, found, 'linux'), /kitty no está instalado/);
  assert.throws(() => terminalPlan('auto', dir, { warp: null, linux: null, installed: [] }, 'linux'), /terminal/i);
  assert.equal(terminalPlan('auto', dir, { ...found, warp: '/usr/bin/warp-terminal' }, 'linux').name, 'Warp');
  // A Windows choice kept in orb.json (the same folder used on Windows before) falls back to the automatic one.
  assert.equal(terminalPlan('wt', dir, found, 'linux').name, 'x-terminal-emulator');
  assert.equal(linuxTerminal('konsole', found), 'konsole');
  assert.equal(linuxTerminal('alacritty', found), 'x-terminal-emulator');
  assert.deepEqual(terminalChoices('linux'), ['auto', 'warp', ...Object.keys(LINUX_TERMINALS)]);
  assert.ok(terminalChoices('win32').includes('powershell') && !terminalChoices('linux').includes('powershell'));
});

test('una acción del proyecto en Linux se abre en la terminal elegida y la ventana queda abierta', () => {
  const dir = '/home/ana/Orb/web';
  const sh = ['bash', '-lc', 'npm run dev; exec bash'];
  assert.deepEqual(actionPlan('npm run dev', dir, found, 'auto', 'linux'), { cmd: 'x-terminal-emulator', args: ['-e', ...sh], cwd: dir });
  assert.deepEqual(actionPlan('npm run dev', dir, found, 'gnome-terminal', 'linux').args, [`--working-directory=${dir}`, '--', ...sh]);
  assert.deepEqual(actionPlan('npm run dev', dir, found, 'konsole', 'linux').args, ['--workdir', dir, '-e', ...sh]);
  assert.throws(() => actionPlan('npm run dev', dir, { linux: null, installed: [] }, 'auto', 'linux'), /terminal/i);
});

test('los editores en Linux se buscan también fuera del PATH del escritorio (snap, ~/.local/bin)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-linux-'));
  try {
    const bin = path.join(home, '.local', 'bin'); fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'code'), '');
    const e = findEditors('linux', { PATH: '', HOME: home });
    assert.equal(e.vscode, path.join(bin, 'code'));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});


