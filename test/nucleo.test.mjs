// 3.5, Orb Server: the engine without Electron (src/server/host.mjs) as the server's «centro», its packaging
// (scripts/dist-servidor.mjs, without downloading Node) and the SSH installer in simulation (scripts/instalar-servidor.mjs).
// 3.7: Orb Server's own engine (src/server/engine-server.mjs): bots and links, never programming.
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
import { plan, remoteScript, explain, archOf } from '../scripts/instalar-servidor.mjs';

test('Orb Server arranca el motor sin ventana como centro, se reinicia si se cae y se cierra limpio', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { port } });
  const home = prepareHome(t.home, { profile: 'centro' });
  assert.equal(home, t.home);
  const stored = JSON.parse(fs.readFileSync(path.join(home, 'orb.json'), 'utf8'));
  assert.equal(stored.role, 'centro');
  assert.equal(stored.mobile.enabled, true, 'el acceso de otros dispositivos se enciende la primera vez como centro');
  assert.equal(stored.mobile.port, port);
  const events = [];
  const host = createHost({ home, version: 'test', mode: 'fork', env: { ORB_REMOTE_BIND: '127.0.0.1' }, backoff: { base: 200, max: 1000, stableMs: 60_000 }, onEvent: (e, p) => events.push([e, p]) });
  try {
    const info = await host.start();
    assert.equal(info.role, 'centro');
    const s = await host.call('app.state');
    assert.equal(s.role, 'centro');
    assert.equal(s.version, 'test');
    // 3.7: the bots and the phone access are there; programming is not (no conversations, schedules, tasks, God mode).
    assert.equal(s.product, 'server');
    assert.ok(Array.isArray((await host.call('bots.list')).bots));
    for (const m of ['conversations.list', 'schedules.list', 'tasks.list', 'projects.list', 'whiteboard.load']) await assert.rejects(host.call(m, {}), /servidor/, m);
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
  // The role chosen by the user stays when Orb Server starts that folder again; a folder without one becomes «centro».
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
  // 3.7: a new folder has Orb Server's layout (data/, logs/, bots/, browser/, engines/, app/).
  assert.ok(fs.existsSync(path.join(home, 'data', 'datos', 'clave.bin')));
  for (const d of ['app', 'bots', 'browser', 'data', 'engines', 'logs']) assert.ok(fs.existsSync(path.join(home, d)), d);
  assert.ok(!fs.existsSync(path.join(home, '.orb')) && !fs.existsSync(path.join(home, 'web')), 'ni .orb ni categorías de proyectos');
  assert.throws(() => prepareHome(dir, { profile: 'raro' }), /papel/);
  t.cleanup();
});

test('el paquete del servidor lleva solo el motor del Server: ni la interfaz, ni Electron, ni la programación', () => {
  const files = appFiles(ROOT).map(([rel]) => rel);
  for (const must of ['src/server/engine-server.mjs', 'src/core/home.mjs', 'src/agents/claude.mjs', 'src/mcp/server.mjs', 'src/mcp/bot.mjs', 'src/server/host.mjs', 'src/server/orb-server.mjs', 'src/server/orb-nucleo.mjs', 'src/server/admin-helper.sh', 'src/core/templates/es/casa.json']) assert.ok(files.includes(must), must);
  assert.ok(!files.some((f) => f.startsWith('src/ui/') || f.startsWith('src/main/') || f.startsWith('src/renderer/')), 'ni la interfaz ni Electron');
  for (const never of ['src/engine/engine.mjs', 'src/engine/api.mjs', 'src/engine/scheduler.mjs', 'src/engine/whiteboard.mjs', 'src/engine/expert.mjs', 'src/engine/github.mjs']) assert.ok(!files.includes(never), never);
  const entries = manifest({ root: ROOT, version: '9.9.9' });
  const names = entries.map((e) => e.name);
  for (const must of ['orb-server', 'orb-nucleo', 'orb-server.service', 'orb-server-nosudo.service', 'admin-setup.sh', 'INSTALAR.md', 'package.json', 'VERSION']) assert.ok(names.includes(`orb-server-9.9.9/${must}`), must);
  assert.ok(names.every((n) => n.startsWith('orb-server-9.9.9')));
  for (const bin of ['/orb-server', '/orb-nucleo', '/admin-setup.sh', '/src/server/admin-helper.sh']) assert.equal(entries.find((e) => e.name.endsWith(bin)).mode, 0o755, bin);
  assert.ok(!String(entries.find((e) => e.name.endsWith('/src/server/admin-helper.sh')).data).includes('\r'), 'el ayudante con finales de línea de Unix');
  const pkg = serverPackage(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));
  assert.ok(pkg.dependencies['@anthropic-ai/claude-agent-sdk']);
  assert.ok(!pkg.dependencies['electron-updater'] && !pkg.devDependencies, 'sin el actualizador de la app ni dependencias de desarrollo');
  const unit = serviceUnit();
  for (const line of ['Restart=always', 'MemoryMax=512M', 'Nice=5', 'KillMode=mixed', 'ExecStart=%h/orb-server/app/current/orb-server', 'Environment=ORB_HOME=%h/orb-server', 'WatchdogSec=', 'NotifyAccess=all', 'WantedBy=default.target']) assert.ok(unit.includes(line), line);
  // With the admin helper the unit cannot have NoNewPrivileges (sudo would not work); without sudo it keeps it.
  assert.doesNotMatch(unit, /^NoNewPrivileges=/m);
  assert.match(serviceUnit({ sudo: false }), /^NoNewPrivileges=true$/m);
  assert.match(launcher(), /node\/bin\/node.*src\/server\/orb-server\.mjs/);
  assert.match(launcher(), /update-tries/, 'el lanzador vuelve a la versión anterior si la nueva no arranca');
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

test('el instalador por SSH, en simulación: sin preguntas y con el mismo install.sh que el comando de una línea', () => {
  const steps = plan({ host: 'mi-servidor', version: '3.7.0', arch: 'arm64', dist: 'C:\\x' });
  assert.equal(steps.length, 3);
  for (const s of steps) assert.ok(s.args.includes('BatchMode=yes'), `${s.what}: BatchMode`);
  assert.ok(steps[1].args.includes('install.sh') && steps[1].args.includes('orb-server-3.7.0-linux-arm64.tar.gz'));
  const script = steps[2].input;
  assert.equal(script, remoteScript('3.7.0', 'arm64'));
  assert.match(script, /bash "\$P\/install\.sh" --tarball "\$TAR"/);
  assert.ok(!/sudo/.test(script), 'el sudo, si hace falta, lo dice install.sh');
  assert.throws(() => plan({ host: 'a b', version: '3.7.0' }), /servidor/);
  assert.throws(() => remoteScript('3.7.0; rm -rf ~'), /versión/);
  assert.throws(() => remoteScript('3.7.0', 'mips'), /procesador/);
  assert.equal(archOf('aarch64'), 'arm64'); assert.equal(archOf('x86_64\n'), 'x64'); assert.equal(archOf('mips'), null);
  assert.match(explain('SERVICIO=active\nADMIN=no\n   (sin terminal para la contraseña) Hazlo luego una vez: sudo sh /h/orb-server/app/current/admin-setup.sh ana /h/orb-server/app/3.7.0\n', 'srv'), /sudo sh \/h\/orb-server\/app\/current\/admin-setup\.sh ana/);
  assert.doesNotMatch(explain('SERVICIO=active\nADMIN=si\n', 'srv'), /sudo/);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'instalar-servidor.mjs'), 'mi-servidor', '--dry-run'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[simulación\]/);
  assert.match(r.stdout, /install\.sh" --tarball/);
});
