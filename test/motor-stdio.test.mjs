// 3.8.1 (D1): the engine as a plain Node process speaking JSON lines on stdin/stdout (how Tauri runs it), its calls to
// the app (host.*: nothing is opened or started here, the test is the app and only answers), and this PC's tools that
// moved from Electron's main process into the engine (app.openTerminal, app.openIn, app.runAction, app.editors…).
import { tempHome, ROOT, until, wait } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { stdioTransport, encode, decode } from '../src/engine/stdio.mjs';
import { checkHostRequest } from '../src/engine/host.mjs';
import { writeJson, homeKey } from '../src/platform/paths.mjs';
import { loadConfig, merge } from '../src/platform/config-file.mjs';
import { METHODS } from '../src/domain/security/permissions.mjs';

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

test('host requests are checked by the app: https, this PC\'s pages and Warp\'s tab; local folders; programs by kind; the secret', () => {
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
  // A network or device path is never touched (looking at it already sends Windows' credentials to that server).
  for (const p of ['\\\\servidor\\recurso', '\\\\?\\C:\\carpeta', '\\\\.\\C:', '//servidor/recurso']) {
    assert.throws(() => checkHostRequest('host.openPath', { path: p }, { isDir: () => true }), undefined, p);
    assert.throws(() => checkHostRequest('host.openTerminal', { dir: p }, { isDir: () => true }), undefined, p);
  }
  // A terminal, an editor or an action by kind: the app picks the program; the engine never names one.
  assert.deepEqual(checkHostRequest('host.openTerminal', { dir, choice: 'cmd', cmd: 'C:\\malo.exe' }, { isDir }), { dir, choice: 'cmd' });
  assert.deepEqual(checkHostRequest('host.openTerminal', { dir, choice: 'otra' }, { isDir }), { dir, choice: 'auto' });
  assert.deepEqual(checkHostRequest('host.openEditor', { which: 'vscode', dir }, { isDir }), { which: 'vscode', dir });
  assert.throws(() => checkHostRequest('host.openEditor', { which: 'notepad', dir }, { isDir }));
  assert.deepEqual(checkHostRequest('host.runAction', { command: 'npm run dev', dir, choice: 'wt' }, { isDir }), { command: 'npm run dev', dir, choice: 'wt' });
  assert.throws(() => checkHostRequest('host.runAction', { command: '  ', dir }, { isDir }));
  assert.throws(() => checkHostRequest('host.runAction', { command: 'x', dir: path.resolve('/no-existe') }, { isDir }));
  assert.throws(() => checkHostRequest('host.spawnDetached', { cmd: 'cmd.exe', args: [], cwd: dir }, { isDir }));
  // This PC's secret is the vault's (src-tauri/vault/src/machine.rs): the engine never asks the app to seal or open it.
  assert.throws(() => checkHostRequest('host.seal', { text: 'ab'.repeat(32) }));
  assert.throws(() => checkHostRequest('host.unseal', { data: Buffer.from('ORB2xyz').toString('base64') }));
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
  // core itself and its secrets: only with a fresh unlock of the master password (none here: refused, nothing asked).
  const asked = hostAnswers.length;
  await assert.rejects(call('app.openIn', { which: 'explorer', dir: path.join(home, 'core') }));
  await assert.rejects(call('app.openIn', { which: 'vscode', dir: path.join(home, 'core', 'secretos') }));
  await assert.rejects(call('app.openIn', { which: 'explorer', dir: '\\\\servidor\\recurso' }));
  assert.equal(hostAnswers.length, asked);
  // A project's action: the app picks the terminal and starts it (outside the engine); the engine only gives the command.
  assert.equal(await call('app.runAction', { dir: home, command: 'npm run dev' }), true);
  assert.equal(hostAnswers.at(-1).method, 'host.runAction');
  assert.deepEqual(hostAnswers.at(-1).params, { command: 'npm run dev', dir: home, choice: 'cmd' });
  // Ctrl+J with the CMD chosen in Ajustes › Interfaz: the app answers with the terminal's name.
  answer = (m) => ({ ok: true, result: m.method === 'host.openTerminal' ? 'CMD' : true });
  assert.equal(await call('app.openTerminal', { dir: home }), 'CMD');
  assert.equal(hostAnswers.at(-1).method, 'host.openTerminal');
  assert.deepEqual(hostAnswers.at(-1).params, { dir: home, choice: 'cmd' });
  // In core or its secrets: the terminal opens in the workspace; an action there needs the master password.
  assert.equal(await call('app.openTerminal', { dir: path.join(home, 'core', 'secretos') }), 'CMD');
  assert.deepEqual(hostAnswers.at(-1).params, { dir: home, choice: 'cmd' });
  const before = hostAnswers.length;
  await assert.rejects(call('app.runAction', { dir: path.join(home, 'core'), command: 'dir' }));
  assert.equal(hostAnswers.length, before);
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

// 3.8.1 (D3): what the Tauri app asks the engine around the start (it has no Node of its own): where the workspace is,
// the first-run setup, moving to another workspace and the texts of its own dialogs. The same rules as Electron's main
// process (src/engine/desktop-home.mjs).
test('the engine answers the Tauri app: locate, setup, switchHome, texts; a sealed secret only with the app\'s sealing', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-shell-'));
  t.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp folder */ } });
  const userData = path.join(tmp, 'datos-app'); const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'engine', 'engine.mjs')], { env: { ...process.env, ORB_ENGINE_STDIO: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  t.after(() => { try { child.kill(); } catch { /* gone */ } });
  let stderr = ''; child.stderr.on('data', (c) => { stderr += c; });
  const seen = [];
  const send = (m) => child.stdin.write(encode(m));
  // Whatever the engine asks the app (host.*): none of it is about the secret any more.
  const sealings = [];
  const host = () => ({ ok: false, error: 'no en esta prueba' });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const m = decode(line); if (!m) return;
    if (m.type === 'host') { sealings.push(m.method); send({ type: 'hostReply', id: m.id, ...host(m) }); } else seen.push(m);
  });
  let n = 0;
  const ask = async (type, fields = {}) => {
    const id = ++n; send({ type, id, ...fields });
    const r = await until(() => seen.find((m) => m.type === 'reply' && m.id === id), type, 20000);
    if (!r.ok) throw new Error(r.error);
    return r.result;
  };
  // A fresh PC (run from the code: never an existing real folder).
  assert.deepEqual(await ask('locate', { userData, packaged: false }), { home: null });
  const { home } = await ask('setup', { userData, base, assistantName: 'Orb', userName: 'Ana', language: 'en' });
  assert.equal(path.dirname(home), base);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData, 'ubicacion.json'), 'utf8')), { home });
  assert.deepEqual(await ask('locate', { userData }), { home });
  // Texts of the app's own dialogs, in the workspace's language.
  const texts = await ask('texts', { home });
  assert.equal(texts['sys.dialog.closeAnyway'], 'Close anyway');
  assert.ok(texts['sys.main.engineOff']);
  assert.ok(Object.keys(texts).every((k) => /^sys\.(main|dialog|terminal)\./.test(k)));
  assert.ok(texts['sys.terminal.notInstalled']);
  // Another folder only if it is a workspace.
  assert.deepEqual(await ask('switchHome', { userData, target: base }), { ok: false });
  assert.deepEqual(await ask('switchHome', { userData, target: home }), { ok: true });
  // Not a message the engine knows: nothing comes back for it, and the engine keeps answering.
  send({ type: 'toString', id: 99 });
  // A sealed secret (in core, or only its copy outside: core would be put back from it) and an app that does not seal:
  // the engine never starts with a new plain key instead.
  const secret = 'c3'.repeat(32);
  const sealed = path.join(home, 'core', 'datos', 'clave.enc');
  const copy = path.join(userData, 'claves', `${homeKey(home)}.enc`);
  for (const file of [sealed, copy]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `v10${secret}`);
    seen.length = 0;
    send({ type: 'start', home, version: 'prueba', userData });
    const refused = await until(() => seen.find((m) => m.type === 'started'), 'started', 30000);
    assert.equal(refused.ok, false, file);
    assert.match(refused.error, /clave cifrada|encrypted key/);
    fs.rmSync(file);
  }
  assert.deepEqual(sealings, []);
  // Tauri (hostSecret): the vault opens it (the tests' vault seals ORB2 + the text). Only Orb 3.8.0's key files (no longer
  // read) stop the start with a code (the window offers a new key); never a new secret behind the user's back.
  fs.writeFileSync(sealed, 'v10basura'); fs.writeFileSync(copy, 'v10basura');
  const startWith = async (more = {}) => {
    seen.length = 0;
    send({ type: 'start', home, version: 'prueba', userData, hostSecret: true, ...more });
    return until(() => seen.find((m) => m.type === 'started'), 'started', 30000);
  };
  const old = await startWith();
  assert.equal(old.ok, false); assert.equal(old.code, 'secretUnreadable'); assert.match(old.error, /3\.8\.0/);
  assert.equal(fs.existsSync(path.join(path.dirname(sealed), 'clave2.enc')), false);
  // ORB2 in core and outside: it opens; 3.8.0's files stay as they were.
  fs.writeFileSync(path.join(path.dirname(sealed), 'clave2.enc'), `ORB2${secret}`);
  fs.writeFileSync(copy.replace(/\.enc$/, '.v2.enc'), `ORB2${secret}`);
  const started = await startWith();
  assert.ok(started.ok, started.error);
  assert.deepEqual(sealings, [], 'nunca host.seal / host.unseal');
  assert.equal(fs.readFileSync(sealed, 'latin1'), 'v10basura');
  assert.equal(fs.readFileSync(copy, 'latin1'), 'v10basura');
  assert.equal(fs.readFileSync(path.join(path.dirname(sealed), 'clave2.enc'), 'latin1'), `ORB2${secret}`);
  assert.equal(seen.some((m) => m.id === 99), false);
  child.stdin.end();
  assert.equal(await Promise.race([exited, wait(10000).then(() => 'sigue vivo')]), 0, stderr.slice(-2000));
});
