// Measures the engine alone (src/engine/engine.mjs as a plain Node child, the way the tests and the Tauri shell run it):
// time to «engine ready», its memory at rest and under load, the latency of the calls the window makes on every refresh
// and its CPU at rest. Everything runs on a throwaway workspace in %TEMP% with the fake agents and a large data set
// (default: 50 projects, 2000 tasks, 300 conversations of 6 lines, one conversation of 2000 lines, 30 direct sessions).
// Never the real C:\Orb or %APPDATA%.
//
//   node scripts/medir-motor.mjs [--runs 5] [--idle 30] [--calls 100] [--out <results.json>] [--profile <dir>] [--no-load] [--keep]
//
// --profile <dir>: one more start with --cpu-prof (the start and the calls) and --heap-prof, saved in <dir>.
// Memory: working set and private bytes of the engine's process (Get-Process). CPU at rest: the CPU time the engine used
// during --idle seconds, 5 s after its start. Latency: --calls sequential calls of each method (p50 / p95 / bytes of the
// JSON reply) and of the window's refresh (store.js › refresh: five calls at once). Load: the latency calls, then a
// coordinated conversation with the fake agent that creates and runs tasks; memory and CPU after it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const RUNS = Number(arg('runs', 5));
const IDLE_S = Number(arg('idle', 30));
const CALLS = Number(arg('calls', 100));
const N = { projects: Number(arg('projects', 50)), tasks: Number(arg('tasks', 2000)), conversations: Number(arg('conversations', 300)), long: Number(arg('long', 2000)), sessions: Number(arg('sessions', 30)) };
const profileDir = arg('profile') ? path.resolve(arg('profile')) : null;
const out = arg('out');
const noLoad = process.argv.includes('--no-load');
const keep = process.argv.includes('--keep'); // the workspace stays (its path is printed), e.g. for EXPLAIN QUERY PLAN

const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-medir-motor-'));
const SANDBOX = { ORB_NO_ADB: '1', ORB_NO_UPDATE: '1', ORB_FAKE_AGENTS: FAKE, ORB_BACKUP_ROOT: path.join(tmp, 'copias'), ORB_BRIDGE_DIR: path.join(tmp, 'puente'), ORB_MODELS_DELAY_MS: '600000' };
Object.assign(process.env, SANDBOX);
const { createHome, loadConfig, writeJson, merge, paths } = await import('../src/core/home.mjs');
const { useHome } = await import('../src/core/context.mjs');

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const MB = (b) => Math.round((b / 1048576) * 10) / 10;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(100); } throw new Error(`no llegó: ${what}`); };

// ---- the workspace
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { userName: 'Ana' });
const OFF = Object.fromEntries(['cursor', 'gemini', 'opencode', 'qwen', 'copilot'].map((a) => [a, { enabled: false }]));
writeJson(paths(home).config, merge(loadConfig(home), { ui: { tourDone: true }, agents: OFF, autoRun: false }));
useHome(home);
const t0 = Date.now();
let longId = null;
{
  const { Board } = await import('../src/core/board.mjs');
  const { syncProjects } = await import('../src/core/projects.mjs');
  for (let p = 1; p <= N.projects; p++) fs.mkdirSync(path.join(home, 'web', `proyecto-${p}`), { recursive: true });
  const board = new Board();
  syncProjects(board);
  const lorem = 'Revisa el componente, ajusta los estilos y comprueba que las pruebas siguen en verde antes de seguir con la siguiente parte del trabajo.';
  const proj = (i) => `proyecto-${(i % N.projects) + 1}`;
  const convs = [];
  board.transaction(() => {
    for (let i = 1; i <= N.conversations; i++) {
      const c = board.createConversation({ title: `Conversación de prueba ${i}`, project: i % 3 ? proj(i) : null });
      convs.push(c.id);
      for (let m = 0; m < 6; m++) board.addChat(m % 2 ? 'orb' : 'usuario', `${lorem} (${i}.${m})`, m === 5 && i % 10 === 0 ? { kind: 'report', tasks: [] } : null, c.id);
    }
    const long = board.createConversation({ title: 'Conversación larga' }); longId = long.id;
    for (let m = 0; m < N.long; m++) board.addChat(m % 2 ? 'orb' : 'usuario', `**Mensaje ${m}.** ${lorem}\n\n- punto uno\n- punto dos\n\n\`\`\`js\nconst x = ${m};\n\`\`\``, null, long.id);
  });
  // Tasks: almost all finished (done / failed / cancelled), a few blocked (open but never launched), each with events.
  const STATUS = ['done', 'done', 'done', 'done', 'failed', 'cancelled'];
  board.transaction(() => {
    for (let i = 1; i <= N.tasks; i++) {
      const t = board.createTask({ project: proj(i), title: `Tarea ${i}`, description: `${lorem}\n\n${lorem}`, agent: 'claude', conversation_id: i % 2 ? convs[i % convs.length] : null }, 'usuario');
      const status = i % 100 === 0 ? 'blocked' : STATUS[i % STATUS.length];
      board.patch(t.id, { status: 'running', assigned_to: 'claude' }, 'scheduler');
      board.patch(t.id, { status, result: `Hecho: ${lorem}` }, 'claude');
      if (i % 4 === 0) board.setting(`accepted:${t.id}`, '1');
    }
  });
  board.transaction(() => {
    const at = new Date().toISOString();
    for (let s = 1; s <= N.sessions; s++) {
      const id = `s${s}`;
      board.run("INSERT INTO sessions (id, kind, agent, title, project, cwd, status, created_at, updated_at) VALUES (?, 'chat', 'claude', ?, ?, ?, 'idle', ?, ?)", id, `Sesión ${s}`, proj(s), path.join(home, 'web', proj(s)), at, at);
      for (let k = 0; k < 40; k++) board.run('INSERT INTO session_items (session_id, kind, role, body, at) VALUES (?, ?, ?, ?, ?)', id, 'message', k % 2 ? 'agent' : 'user', JSON.stringify({ text: `${lorem} ${k}` }), at);
    }
  });
  board.db.close();
}
const dbBytes = fs.statSync(paths(home).db).size;
console.log(`datos: ${N.projects} proyectos, ${N.tasks} tareas, ${N.conversations} conversaciones, 1 de ${N.long} líneas, ${N.sessions} sesiones; base ${MB(dbBytes)} MB (${Date.now() - t0} ms)`);
const motorLog = path.join(home, 'core', 'ejecuciones', 'motor.log');

// ---- the engine
function procInfo(pid) {
  const ps = `$p = Get-Process -Id ${pid}; @{ ws = $p.WorkingSet64; priv = $p.PrivateMemorySize64; cpu = $p.TotalProcessorTime.TotalMilliseconds } | ConvertTo-Json -Compress`;
  const j = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }));
  return { wsMB: MB(j.ws), privateMB: MB(j.priv), cpuMs: Math.round(j.cpu) };
}
async function startEngine({ execArgv = [] } = {}) {
  const spawned = performance.now(); const wall = Date.now();
  const child = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...process.env, ...SANDBOX }, execArgv });
  let n = 0; const pending = new Map(); const events = [];
  child.on('message', (m) => {
    if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.resolve(m) : p.reject(new Error(m.error))); }
    if (m.type === 'event') events.push(m);
  });
  const exited = new Promise((r) => child.once('exit', r));
  await new Promise((resolve, reject) => {
    const onStart = (m) => { if (m?.type !== 'started') return; child.off('message', onStart); if (m.ok) resolve(); else reject(new Error(m.error)); };
    child.on('message', onStart);
    child.send({ type: 'start', home, version: 'medir' });
  });
  const startedMs = performance.now() - spawned;
  // «motor arrancado» (the engine's own clock), as scripts/medir.mjs reads it.
  const stamp = fs.readFileSync(motorLog, 'utf8').split('\n').filter((l) => l.includes('motor arrancado')).map((l) => Date.parse(l.slice(0, 24))).filter((t) => t >= wall - 5).at(-1);
  const raw = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); child.send({ type: 'call', id, method, params }); });
  const call = async (method, params) => (await raw(method, params)).result;
  return { child, call, raw, events, startedMs, readyMs: stamp ? stamp - wall : null,
    stop: async () => { try { child.send({ type: 'shutdown' }); } catch { /* gone */ } await Promise.race([exited, wait(6000)]); if (child.exitCode == null) child.kill(); } };
}

// The calls of the window's refresh (src/ui/lib/store.js › refresh) and the other lists it asks for often.
const HOT = [['app.state', {}], ['conversations.list', {}], ['inbox.list', { zone: 'orb' }], ['tasks.list', { limit: 200 }], ['projects.list', {}], ['sessions.list', {}], ['chat.list', () => ({ conversation: longId })], ['tasks.get', () => ({ id: Math.ceil(N.tasks / 2) })]];
const REFRESH = [['app.state', {}], ['sessions.list', {}], ['projects.list', {}], ['tasks.list', { limit: 200 }], ['conversations.list', {}]];
async function latency(e) {
  const res = {};
  for (const [m, p] of HOT) {
    const params = typeof p === 'function' ? p() : p;
    for (let i = 0; i < 5; i++) await e.call(m, params); // warm
    const ms = []; let bytes = 0;
    for (let i = 0; i < CALLS; i++) { const a = performance.now(); const r = await e.raw(m, params); ms.push(performance.now() - a); bytes = JSON.stringify(r.result).length; }
    res[m] = { p50: r2(median(ms)), p95: r2(pct(ms, 95)), kB: r2(bytes / 1024) };
  }
  const ms = [];
  for (let i = 0; i < CALLS; i++) { const a = performance.now(); await Promise.all(REFRESH.map(([m, p]) => e.call(m, p))); ms.push(performance.now() - a); }
  res.refresh = { p50: r2(median(ms)), p95: r2(pct(ms, 95)) };
  return res;
}

// A coordinated conversation with the fake agent: the coordinator creates tasks through the real MCP server and the
// scheduler runs them (the fake agent writes a file). Each «CREA_TAREA» turn makes one task.
async function orchestrated(e, n = 4) {
  const before = e.events.length;
  await e.call('config.save', { patch: { autoRun: true } });
  const ids = [];
  for (let i = 0; i < n; i++) {
    const { conversation } = await e.call('chat.send', { text: `Hazlo. CREA_TAREA proyecto-${i + 1}`, project: `proyecto-${i + 1}` });
    ids.push(conversation);
  }
  // Refreshes as the window makes them while it works (one per board:changed, as store.js does).
  let refreshes = 0; let stop = false;
  const pump = (async () => { let seen = e.events.length; while (!stop) { if (e.events.length !== seen) { seen = e.events.length; await Promise.all(REFRESH.map(([m, p]) => e.call(m, p))); refreshes++; } await wait(120); } })();
  await until(async () => {
    const tasks = await e.call('tasks.list', { limit: 50 });
    const mine = tasks.filter((t) => t.title === 'Tarea del asistente');
    return mine.length >= n && mine.every((t) => !['queued', 'running'].includes(t.status)) && (await e.call('app.state')).chats.every((c) => !c.busy);
  }, 'tareas del asistente', 120000);
  stop = true; await pump;
  await e.call('config.save', { patch: { autoRun: false } });
  return { conversations: ids.length, events: e.events.length - before, refreshes };
}

// ---- the runs
const results = { when: new Date().toISOString(), node: process.version, data: { ...N, dbMB: MB(dbBytes) }, runs: [] };
for (let r = 1; r <= RUNS; r++) {
  const e = await startEngine();
  const run = { run: r, startedMs: Math.round(e.startedMs), readyMs: e.readyMs };
  if (r === RUNS) {
    await wait(5000);
    const a = procInfo(e.child.pid);
    await wait(IDLE_S * 1000);
    const b = procInfo(e.child.pid);
    run.idle = { ...b, cpuIdlePct: r2(((b.cpuMs - a.cpuMs) / (IDLE_S * 1000)) * 100), cpuIdleMs: b.cpuMs - a.cpuMs };
    run.latency = await latency(e);
    run.afterCalls = procInfo(e.child.pid);
    if (!noLoad) {
      const t = performance.now();
      run.orchestrated = { ...(await orchestrated(e)), ms: Math.round(performance.now() - t) };
      run.afterLoad = procInfo(e.child.pid);
      await wait(10000);
      const c = procInfo(e.child.pid); await wait(10000); const d = procInfo(e.child.pid);
      run.afterLoadIdle = { ...d, cpuIdlePct: r2(((d.cpuMs - c.cpuMs) / 10000) * 100) };
    }
  } else {
    await wait(1500);
    run.mem = procInfo(e.child.pid);
  }
  await e.stop();
  results.runs.push(run);
  console.log(JSON.stringify(run));
}
const warm = results.runs.slice(1);
results.summary = {
  startedMs: { median: median(warm.map((x) => x.startedMs)), min: Math.min(...warm.map((x) => x.startedMs)), max: Math.max(...warm.map((x) => x.startedMs)) },
  readyMs: { median: median(warm.map((x) => x.readyMs)) },
  memAfterStart: { wsMB: median(results.runs.filter((x) => x.mem).map((x) => x.mem.wsMB)), privateMB: median(results.runs.filter((x) => x.mem).map((x) => x.mem.privateMB)) }
};
if (profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const e = await startEngine({ execArgv: ['--cpu-prof', `--cpu-prof-dir=${profileDir}`, '--heap-prof', `--heap-prof-dir=${profileDir}`] });
  await wait(3000 + IDLE_S * 1000); // the start, then IDLE_S seconds at rest, then the calls
  await latency(e);
  await e.stop();
  console.log(`perfiles en ${profileDir}`);
}
console.log(JSON.stringify(results.summary));
if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(results, null, 2)); }
if (keep) console.log(`espacio de trabajo: ${home}`);
else try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp */ }
