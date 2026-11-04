// 3.5, Orb Núcleo: the engine without Electron (src/server/host.mjs) as the server's «centro», its packaging
// (scripts/dist-servidor.mjs, without downloading Node) and the SSH installer in simulation (scripts/instalar-servidor.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { tempHome, startEngine, until, ROOT } from './helpers.mjs';
import { createHost, prepareHome } from '../src/server/host.mjs';
import { manifest, appFiles, serverPackage, serviceUnit, launcher, writeTarGz, readTarGz } from '../scripts/dist-servidor.mjs';
import { plan, remoteScript, explain } from '../scripts/instalar-servidor.mjs';

test('Orb Núcleo arranca el motor sin ventana como centro, se reinicia si se cae y se cierra limpio', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { port } });
  const home = prepareHome(t.home, { profile: 'centro' });
  assert.equal(home, t.home);
  const stored = JSON.parse(fs.readFileSync(path.join(home, 'orb.json'), 'utf8'));
  assert.equal(stored.role, 'centro');
  assert.equal(stored.mobile.enabled, true, 'el acceso de otros dispositivos se enciende la primera vez como centro');
  assert.equal(stored.mobile.port, port);
  const events = [];
  const host = createHost({ home, version: 'test', env: { ORB_REMOTE_BIND: '127.0.0.1' }, backoff: { base: 200, max: 1000, stableMs: 60_000 }, onEvent: (e, p) => events.push([e, p]) });
  try {
    const info = await host.start();
    assert.equal(info.role, 'centro');
    const s = await host.call('app.state');
    assert.equal(s.role, 'centro');
    assert.equal(s.version, 'test');
    // Conversations, schedules and the phone access are there; the PC's development tools are not.
    assert.ok(Array.isArray(await host.call('conversations.list')));
    assert.ok(Array.isArray(await host.call('schedules.list')));
    await until(async () => (await host.call('remote.status')).running, 'acceso remoto del centro');
    await assert.rejects(host.call('expert.tree', {}), /servidor/);
    await assert.rejects(host.call('actions.list', {}), /servidor/);
    // The secret of the approvals, without Windows' encryption: a file only its owner can read.
    const key = path.join(home, '.orb', 'datos', 'clave.bin');
    assert.ok(fs.existsSync(key));
    if (process.platform !== 'win32') assert.equal(fs.statSync(key).mode & 0o777, 0o600);

    // A crash: the host starts it again by itself.
    const before = host.pid;
    process.kill(before, 'SIGKILL');
    await until(() => host.restarts === 1 && host.running && host.pid !== before, 'reinicio del motor', 20000);
    await until(() => events.some(([e]) => e === 'engine:restarted'), 'aviso de reinicio', 20000);
    assert.equal((await host.call('app.state')).role, 'centro');
  } finally {
    const r = await host.stop();
    assert.equal(r.clean, true, 'el motor se cierra con su mensaje de cierre, sin forzarlo');
    assert.equal(host.running, false);
    const log = fs.readFileSync(path.join(home, '.orb', 'ejecuciones', 'nucleo.log'), 'utf8');
    assert.match(log, /se ha caído/);
    assert.match(log, /motor detenido/);
    t.cleanup();
  }
});

test('el motor de la app lo hace todo sin papel y prepareHome crea la carpeta del servidor', async () => {
  const t = tempHome();
  const e = await startEngine(t.home);
  try {
    const s = await e.call('app.state');
    assert.equal(s.role, 'todo', 'un Orb sin papel es centro y taller a la vez');
    assert.equal(JSON.parse(fs.readFileSync(path.join(t.home, 'orb.json'), 'utf8')).role, undefined, 'sin papel, orb.json no cambia');
    await assert.doesNotReject(e.call('expert.status', {}).catch((error) => { if (/servidor/.test(error.message)) throw error; }));
    // A PC can be the centre too: with a window, God mode and the rest stay (only a server without a window loses them).
    await e.call('config.save', { patch: { role: 'centro' } });
    assert.equal((await e.call('app.state')).role, 'centro');
    await assert.doesNotReject(e.call('expert.status', {}).catch((error) => { if (/servidor/.test(error.message)) throw error; }));
    await assert.rejects(e.call('config.save', { patch: { role: 'raro' } }), /role/);
  } finally { await e.stop(); }
  // The role chosen by the user stays when Orb Núcleo starts that folder again; a folder without one becomes «centro».
  assert.equal(prepareHome(t.home), t.home);
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.home, 'orb.json'), 'utf8')).role, 'centro');
  prepareHome(t.home, { profile: 'todo' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.home, 'orb.json'), 'utf8')).role, 'todo', '--papel lo cambia a propósito');
  prepareHome(t.home);
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.home, 'orb.json'), 'utf8')).role, 'todo', 'y sin --papel se queda');
  // A new folder: made with its secret and the role.
  const dir = path.join(t.base, 'servidor', 'orb');
  const home = prepareHome(dir, { profile: 'centro' });
  assert.equal(home, dir);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'orb.json'), 'utf8')).role, 'centro');
  assert.ok(fs.existsSync(path.join(home, '.orb', 'datos', 'clave.bin')));
  assert.throws(() => prepareHome(dir, { profile: 'raro' }), /papel/);
  t.cleanup();
});

test('el paquete del servidor lleva el motor y la interfaz compilada, nunca src/ui ni la app de Electron', () => {
  const files = appFiles(ROOT).map(([rel]) => rel);
  for (const must of ['src/engine/engine.mjs', 'src/core/home.mjs', 'src/agents/claude.mjs', 'src/mcp/server.mjs', 'src/server/host.mjs', 'src/server/orb-nucleo.mjs', 'src/renderer/index.html']) assert.ok(files.includes(must), must);
  assert.ok(!files.some((f) => f.startsWith('src/ui/') || f.startsWith('src/main/')), 'ni fuentes de la interfaz ni Electron');
  const entries = manifest({ root: ROOT, version: '9.9.9' });
  const names = entries.map((e) => e.name);
  for (const must of ['orb-nucleo', 'orb-nucleo.service', 'INSTALAR.md', 'package.json', 'VERSION']) assert.ok(names.includes(`orb-nucleo-9.9.9/${must}`), must);
  assert.ok(names.every((n) => n.startsWith('orb-nucleo-9.9.9')));
  assert.equal(entries.find((e) => e.name.endsWith('/orb-nucleo')).mode, 0o755);
  const pkg = serverPackage(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));
  assert.ok(pkg.dependencies['@anthropic-ai/claude-agent-sdk']);
  assert.ok(!pkg.dependencies['electron-updater'] && !pkg.devDependencies, 'sin el actualizador de la app ni dependencias de desarrollo');
  const unit = serviceUnit();
  for (const line of ['Restart=always', 'MemoryMax=1G', 'Nice=5', 'KillMode=mixed', 'ExecStart=%h/orb-nucleo/current/orb-nucleo']) assert.ok(unit.includes(line), line);
  assert.match(launcher(), /node\/bin\/node.*src\/server\/orb-nucleo\.mjs/);
});

test('el tar del servidor guarda los permisos de Linux y los nombres largos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-tar-'));
  try {
    const long = `top/${'carpeta-larga/'.repeat(10)}archivo.mjs`;
    const out = path.join(dir, 'p.tar.gz');
    await writeTarGz(out, [{ name: 'top', dir: true }, { name: 'top/run', data: Buffer.from('#!/bin/sh\n'), mode: 0o755 }, { name: long, data: Buffer.from('x'.repeat(700)) }]);
    const list = readTarGz(out);
    assert.deepEqual(list.map((e) => e.name), ['top/', 'top/run', long]);
    assert.equal(list[1].mode, 0o755);
    assert.equal(list[2].data.length, 700);
    // And the system's tar reads it the same (bsdtar on Windows, GNU tar on Linux).
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const r = spawnSync(tar, ['-tzf', out], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) assert.ok(r.stdout.includes(long));
    assert.ok(zlib.gunzipSync(fs.readFileSync(out)).length % 512 === 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('el instalador por SSH, en simulación: sin preguntas, copia antes de actualizar y linger solo con sudo -n', () => {
  const steps = plan({ host: 'mi-servidor', version: '3.5.0', tarball: 'C:\\x\\orb-nucleo-3.5.0-linux-x64.tar.gz' });
  assert.equal(steps.length, 3);
  for (const s of steps) assert.ok(s.args.includes('BatchMode=yes'), `${s.what}: BatchMode`);
  const script = steps[2].input;
  assert.equal(script, remoteScript('3.5.0'));
  for (const must of ['tar -czf "$B/copias/datos-antes-$V', 'ln -sfn "$V"', 'mv -Tf "$B/current.nuevo" "$B/current"', '.config/systemd/user', 'systemctl --user daemon-reload', 'systemctl --user enable --now orb-nucleo', 'sudo -n loginctl enable-linger']) assert.ok(script.includes(must), must);
  assert.ok(script.indexOf('datos-antes') < script.indexOf('tar -xzf'), 'la copia de los datos va antes de descomprimir la versión nueva');
  assert.ok(!/sudo (?!-n)/.test(script), 'nunca un sudo que pida contraseña');
  assert.throws(() => plan({ host: 'a b', version: '3.5.0', tarball: 'x' }), /servidor/);
  assert.throws(() => remoteScript('3.5.0; rm -rf ~'), /versión/);
  assert.match(explain('SERVICIO=active\nLINGER=falta\nTS=si\n', 'srv'), /sudo loginctl enable-linger \$USER/);
  assert.doesNotMatch(explain('SERVICIO=active\nLINGER=si\nTS=si\n', 'srv'), /sudo/);
  // The command itself, with --dry-run, runs nothing and says every step.
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'instalar-servidor.mjs'), 'mi-servidor', '--dry-run'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[simulación\]/);
  assert.match(r.stdout, /enable --now orb-nucleo/);
});
