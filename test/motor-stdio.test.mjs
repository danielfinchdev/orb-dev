// 3.8.1 (D1): the engine as a plain Node process speaking JSON lines on stdin/stdout (how Tauri runs it), its calls to
// the app (host.*: nothing is opened or started here, the test is the app and only answers), and this PC's tools that
// moved from Electron's main process into the engine (app.openTerminal, app.openIn, app.runAction, app.editors…).
import { tempHome, ROOT, until, wait } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { stdioTransport, encode, decode } from '../src/engine/stdio.mjs';
import { checkHostRequest } from '../src/engine/host.mjs';
import { writeJson, loadConfig, merge } from '../src/core/home.mjs';
import { METHODS } from '../src/core/permissions.mjs';

test('stdio: one JSON message per line, and nothing else ever reaches stdout', async () => {
  assert.equal(encode({ a: 'uno\ndos' }), '{"a":"uno\\ndos"}\n');
  assert.deepEqual(decode(' {"type":"call"} '), { type: 'call' });
  for (const line of ['', 'hola', '[1,2]', 'null', '{roto']) assert.equal(decode(line), null);
  const input = new PassThrough(); const output = new PassThrough(); const errors = new PassThrough();
  let out = ''; let err = ''; output.on('data', (c) => { out += c; }); errors.on('data', (c) => { err += c; });
  let closed = false;
  const t = stdioTransport({ input, output, errors, onClose: () => { closed = true; } });
  const got = []; t.on((m) => got.push(m));
  output.write('ruido de una librería\n'); // console.log and any stray write go to stderr
  t.send({ type: 'reply', id: 1, ok: true, result: 'línea\ncon salto' });
  input.write('{"type":"call","id":7,"method":"app.state"}\r\nbasura\n{"type":"shutdown"}\n');
  await until(() => got.length === 2, 'dos mensajes');
  assert.deepEqual(got, [{ type: 'call', id: 7, method: 'app.state' }, { type: 'shutdown' }]);
  assert.equal(out, '{"type":"reply","id":1,"ok":true,"result":"línea\\ncon salto"}\n');
  assert.match(err, /ruido de una librería/);
  assert.match(err, /línea ignorada/);
  input.end();
  await until(() => closed, 'stdin cerrado');
});

test('host requests are checked by the app: https, this PC\'s pages and Warp\'s tab; folders; programs as a list', () => {
  const isDir = (p) => p === path.resolve('C:/carpeta') || p === path.resolve('/carpeta');
  const dir = path.resolve('/carpeta');
  assert.deepEqual(checkHostRequest('host.openUrl', { url: 'https://github.com/x' }), { url: 'https://github.com/x' });
  assert.ok(checkHostRequest('host.openUrl', { url: 'http://localhost:5173/' }));
  assert.ok(checkHostRequest('host.openUrl', { url: 'http://127.0.0.1:3000/app' }));
  assert.ok(checkHostRequest('host.openUrl', { url: 'warp://action/new_tab?path=C%3A%5Cx' }));
  for (const url of ['http://ejemplo.com', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'warp://otra/cosa', 'ms-settings:', 'no es un enlace']) {
    assert.throws(() => checkHostRequest('host.openUrl', { url }), undefined, url);
  }
  assert.deepEqual(checkHostRequest('host.openPath', { path: dir }, { isDir }), { path: dir });
  assert.throws(() => checkHostRequest('host.openPath', { path: 'relativa' }, { isDir }));
  assert.throws(() => checkHostRequest('host.openPath', { path: path.resolve('/otra/archivo.exe') }, { isDir }));
  assert.deepEqual(checkHostRequest('host.spawnDetached', { cmd: 'powershell.exe', args: ['-NoExit'], cwd: dir }, { isDir }), { cmd: 'powershell.exe', args: ['-NoExit'], cwd: dir });
  assert.ok(checkHostRequest('host.spawnDetached', { cmd: path.resolve('/apps/wt.exe'), args: [], cwd: dir }, { isDir }));
  assert.throws(() => checkHostRequest('host.spawnDetached', { cmd: 'sub\\prog.exe', args: [], cwd: dir }, { isDir }));
  assert.throws(() => checkHostRequest('host.spawnDetached', { cmd: 'cmd.exe', args: '/c calc', cwd: dir }, { isDir }));
  assert.throws(() => checkHostRequest('host.spawnDetached', { cmd: 'cmd.exe', args: [], cwd: path.resolve('/no-existe') }, { isDir }));
  assert.throws(() => checkHostRequest('host.borrarTodo', {}));
});

test('the engine over stdio: starts, answers, asks the app (host.*) and ends when stdin closes', async (t) => {
  const { home, cleanup } = tempHome();
  t.after(cleanup);
  writeJson(path.join(home, 'core', 'orb.json'), merge(loadConfig(home), { ui: { terminal: 'cmd' } }));
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'engine', 'engine.mjs')], { env: { ...process.env, ORB_ENGINE_STDIO: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  t.after(() => { try { child.kill(); } catch { /* gone */ } });
  let stderr = ''; child.stderr.on('data', (c) => { stderr += c; });
  const messages = []; const notJson = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => { const m = decode(line); if (m) messages.push(m); else notJson.push(line); });
  const send = (m) => child.stdin.write(encode(m));
  // The app's side of host.*: answered as told, never really opened or started.
  const hostAnswers = []; let answer = () => ({ ok: true, result: true });
  const watch = setInterval(() => {
    for (const m of messages.splice(0)) {
      if (m.type === 'host') { hostAnswers.push(m); send({ type: 'hostReply', id: m.id, ...answer(m) }); } else seen.push(m);
    }
  }, 10);
  t.after(() => clearInterval(watch));
  const seen = [];
  let n = 0;
  const call = async (method, params = {}) => {
    const id = ++n; send({ type: 'call', id, method, params });
    const r = await until(() => seen.find((m) => m.type === 'reply' && m.id === id), `respuesta a ${method}`, 20000);
    if (!r.ok) throw new Error(r.error);
    return r.result;
  };
  send({ type: 'start', home, version: 'prueba-stdio' });
  const started = await until(() => seen.find((m) => m.type === 'started'), 'started', 30000);
  assert.ok(started.ok, started.error);

  assert.equal((await call('app.state')).version, 'prueba-stdio');
  const editors = await call('app.editors');
  assert.deepEqual(Object.keys(editors).sort(), ['cursor', 'vscode']);
  // The File Explorer: the engine asks the app to open the folder.
  assert.equal(await call('app.openIn', { which: 'explorer', dir: home }), true);
  assert.deepEqual(hostAnswers.at(-1).method, 'host.openPath');
  assert.equal(hostAnswers.at(-1).params.path, home);
  await assert.rejects(call('app.openIn', { which: 'notepad', dir: home }));
  await assert.rejects(call('app.openIn', { which: 'explorer', dir: 'relativa' }));
  // A project's action: a program started by the app (outside the engine), its command never through a shell line.
  assert.equal(await call('app.runAction', { dir: home, command: 'npm run dev' }), true);
  const run = hostAnswers.at(-1);
  assert.equal(run.method, 'host.spawnDetached');
  assert.equal(run.params.cwd, home);
  assert.ok(run.params.args.some((a) => a.includes('npm run dev')), JSON.stringify(run.params));
  // Ctrl+J with the CMD chosen in Ajustes › Interfaz.
  assert.equal(await call('app.openTerminal', { dir: home }), 'CMD');
  assert.equal(hostAnswers.at(-1).method, 'host.spawnDetached');
  assert.equal(hostAnswers.at(-1).params.cwd, home);
  // The app could not do it: the window gets the reason.
  answer = () => ({ ok: false, error: 'el sistema no pudo abrirlo' });
  await assert.rejects(call('app.openIn', { which: 'explorer', dir: home }), /no pudo abrirlo/);
  // Methods of this PC only.
  for (const m of ['app.openTerminal', 'app.editors', 'app.openIn', 'app.runAction', 'app.feedbackSend', 'app.moreApps']) assert.equal(METHODS[m], 'pc', m);

  assert.deepEqual(notJson, [], `stdout solo lleva mensajes: ${notJson.join(' | ')}`);
  // The app went away (stdin closed): the engine ends by itself.
  child.stdin.end();
  const code = await Promise.race([exited, wait(10000).then(() => 'sigue vivo')]);
  assert.equal(code, 0, stderr.slice(-2000));
});
