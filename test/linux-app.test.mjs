// 3.7: the desktop app on Linux: the terminals Ctrl+J and the project's actions open, how a copy updates (AppImage
// itself, .deb only tells), the keyring check, programs started from an AppImage, and the packaging / release config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { terminalPlan, linuxTerminal, externalEnv, terminalChoices, LINUX_TERMINALS } from '../src/engine/terminal.mjs';
import { actionPlan, findEditors } from '../src/engine/editors.mjs';
import { linuxKind, keyringWeak } from '../src/main/linux.mjs';
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

test('cómo se actualiza cada copia en Linux, y el aviso de llavero', () => {
  assert.equal(linuxKind('linux', { APPIMAGE: '/home/ana/Apps/Orb.AppImage' }), 'appimage');
  assert.equal(linuxKind('linux', {}), 'package');
  assert.equal(linuxKind('win32', { APPIMAGE: 'x' }), null);
  assert.equal(keyringWeak('linux', true, 'gnome_libsecret'), false);
  assert.equal(keyringWeak('linux', true, 'kwallet6'), false);
  assert.equal(keyringWeak('linux', true, 'basic_text'), true);
  assert.equal(keyringWeak('linux', false, null), true);
  assert.equal(keyringWeak('win32', true, null), false);
  // A program started from the AppImage (an editor, a terminal) does not inherit its variables.
  const env = externalEnv({ PATH: '/usr/bin', APPIMAGE: '/a/Orb.AppImage', APPDIR: '/tmp/.mount_Orb', ARGV0: 'Orb', OWD: '/home/ana' });
  assert.deepEqual(env, { PATH: '/usr/bin' });
  const plain = { PATH: '/usr/bin' };
  assert.equal(externalEnv(plain), plain);
});

test('el empaquetado para Linux y su publicación con las de Windows', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const linux = pkg.build.linux;
  const targets = Object.fromEntries(linux.target.map((t) => [t.target, t.arch]));
  assert.deepEqual(Object.keys(targets).sort(), ['AppImage', 'deb']);
  for (const arch of Object.values(targets)) assert.deepEqual(arch, ['x64', 'arm64']);
  assert.equal(linux.icon, 'build/icons');
  assert.ok(pkg.build.files.includes('build/icon.png'), 'el icono va dentro (ventana y avisos)');
  assert.ok(pkg.build.files.includes('build/icon.ico'), 'y el .ico (la ventana en Windows)');
  assert.ok(pkg.devDependencies.pngjs, 'npm run icon usa pngjs: dependencia propia, no de paso');
  assert.equal(linux.desktop.entry.StartupWMClass, pkg.productName, 'el dock agrupa la ventana con su icono');
  assert.equal(pkg.desktopName, `${linux.executableName}.desktop`);
  assert.ok(pkg.homepage && /<.+@.+>/.test(linux.maintainer), 'el .deb necesita página y responsable');
  const release = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(release, /electron-builder --linux AppImage deb --x64 --arm64 --publish never/);
  for (const f of ['dist/Orb-*.AppImage', 'dist/Orb-*.deb', 'dist/latest-linux*.yml', 'dist/Orb-*-instalador.exe', 'dist/latest.yml', 'dist/latest.json', 'dist/Orb_*_x64-setup.exe.sig']) assert.ok(release.includes(f), f);
  const pruebas = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pruebas.yml'), 'utf8');
  assert.match(pruebas, /windows-latest, ubuntu-latest/);
  assert.match(pruebas, /npm run test:app/);
});
