// End-to-end check of the native Android app's Kotlin link client against the PC's REAL engine (no fake): it boots the
// engine on a temp home, makes the master password, hands the pairing QR to the Kotlin test (RealPcE2eTest) and checks
// that Gradle ran it without skips or failures. Run with `npm run android:e2e`; it takes several minutes (Gradle).
// It never starts an AI agent: only read calls and the link itself.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawn } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

const PASSWORD = 'e2e master password';
const RESULTS = path.join(ROOT, 'android', 'app', 'build', 'test-results', 'testDebugUnitTest');
const RESULT_FILE = path.join(RESULTS, 'TEST-dev.orb.app.link.RealPcE2eTest.xml');

let t; let engine; let n = 0; let port; let tmp;
const pending = new Map();
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });

before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port } });
  // The engine must run with the production password costs (scrypt 2^16 for linking), which the app refuses to relax:
  // NODE_TEST_CONTEXT would make the vault use cheap ones. Without it the engine would touch this PC's real backup and
  // bridge folders, so both are pointed at the temp folder.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-e2e-'));
  const env = { ...process.env, ORB_REMOTE_BIND: '127.0.0.1', ORB_BACKUP_ROOT: path.join(tmp, 'backups'), ORB_BRIDGE_DIR: path.join(tmp, 'bridge') };
  delete env.NODE_TEST_CONTEXT;
  engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env });
  engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
  await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
  await until(async () => (await call('remote.status')).running, 'phone link server');
  await call('master.create', { password: PASSWORD });
});

after(async () => {
  if (engine) {
    const closed = new Promise((resolve) => engine.once('exit', resolve));
    engine.send({ type: 'shutdown' });
    await Promise.race([closed, new Promise((r) => setTimeout(r, 10_000))]);
    if (engine.exitCode === null) engine.kill();
  }
  t?.cleanup();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

const gradle = (env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'android-native.mjs'), 'testDebugUnitTest', '--tests', 'dev.orb.app.link.RealPcE2eTest'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'] });
  const timer = setTimeout(() => child.kill(), 15 * 60_000);
  child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
});

test('the Kotlin link client works against the real engine', { timeout: 16 * 60_000 }, async () => {
  const { url } = await call('remote.pair', {});
  const config = path.join(tmp, 'pc.json');
  // The config holds the one-time QRs and the test password of a throwaway home; it is deleted with the temp folder.
  fs.writeFileSync(config, JSON.stringify({ link: url, password: PASSWORD, base: `http://127.0.0.1:${port}` }));
  fs.rmSync(RESULT_FILE, { force: true });

  const code = await gradle({ ORB_E2E_PC: config });
  assert.equal(code, 0, 'Gradle must pass');

  const xml = fs.readFileSync(RESULT_FILE, 'utf8');
  const head = xml.match(/<testsuite [^>]*>/)[0];
  const num = (k) => Number(head.match(new RegExp(`\\b${k}="(\\d+)"`))[1]);
  assert.equal(num('tests'), 1, 'the e2e test ran');
  assert.equal(num('skipped'), 0, 'nothing was skipped');
  assert.equal(num('failures'), 0);
  assert.equal(num('errors'), 0);
});
