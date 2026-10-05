// Test helpers: a throwaway assistant folder with the fake agents (test/fixtures/fake-live.mjs) in place of the real ones.
// Import this module before any module of src/agents: ORB_FAKE_AGENTS is read when src/agents/index.mjs loads, and the
// engine and MCP processes the tests start inherit it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHome, loadConfig, writeJson, merge } from '../src/core/home.mjs';
import { useHome } from '../src/core/context.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fake = (name) => path.join(ROOT, 'test', 'fixtures', name);
process.env.ORB_FAKE_AGENTS ??= fake('fake-live.mjs');

// Cursor and the ACP agents are off by default so "any" tasks and reviews go to Claude or Codex (as in the old tests).
const OFF = Object.fromEntries(['cursor', 'gemini', 'opencode', 'qwen', 'copilot'].map((a) => [a, { enabled: false }]));

export function tempHome(patch = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-test-'));
  const { home } = createHome(base, { assistantName: 'Orb', userName: 'Ana' });
  const config = merge(loadConfig(home), merge({ agents: OFF }, patch));
  writeJson(path.join(home, 'orb.json'), config);
  useHome(home);
  // On Windows a database still open (this process or an engine that is closing) cannot be deleted: try for a moment and
  // leave the rest to the system's temp cleanup rather than failing the tests.
  const cleanup = () => { try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp folder */ } };
  return { base, home, cleanup };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(100); }
  throw new Error(`timeout: ${what}`);
}

// The engine in its own process, as the app runs it: call(method, params) → result; events are collected.
export async function startEngine(home, { env = {} } = {}) {
  const child = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ...env } });
  let n = 0; const pending = new Map(); const events = [];
  child.on('message', (m) => {
    if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.resolve(m.result) : p.reject(new Error(m.error))); }
    if (m.type === 'event') events.push(m);
  });
  const exited = new Promise((r) => child.once('exit', r));
  await new Promise((resolve, reject) => {
    // Events may come before 'started' (e.g. a task that continues after a restart): wait for that message only.
    const onStart = (m) => { if (m?.type !== 'started') return; child.off('message', onStart); if (m.ok) resolve(); else reject(new Error(m.error)); };
    child.on('message', onStart);
    child.send({ type: 'start', home, version: 'test' });
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); child.send({ type: 'call', id, method, params }); });
  const taskDone = (id, ms = 20000) => until(async () => { const x = await call('tasks.get', { id }); return !['queued', 'running'].includes(x.status) && x.pid == null && x; }, `tarea #${id}`, ms);
  return {
    child, call, events, taskDone,
    // A clean stop (shutdown) or a crash (kill): both wait until the process is gone.
    stop: async () => { try { child.send({ type: 'shutdown' }); } catch { /* gone */ } await Promise.race([exited, wait(5000)]); },
    kill: async () => { child.kill('SIGKILL'); await exited; }
  };
}

// Lines the fake agents wrote to a run's registro.jsonl (a task: its id; a conversation: conversaciones/<id>).
export function fakeLog(home, run) {
  const file = path.join(home, '.orb', 'ejecuciones', String(run), 'registro.jsonl');
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.startsWith('{"fake"')).map((l) => JSON.parse(l));
}
