// 3.8.3: the engine at rest after some real use. Up to 3.8.2 every finished task left a «leftovers_pending» row and the
// engine listed the PC's processes (a synchronous PowerShell of ~0.8 s) once per row on every tick: its event loop was
// blocked almost all the time and one core stayed busy. This measures exactly that, on a throwaway workspace in %TEMP%
// (never the real C:\Orb or %APPDATA%), with the real agents' code path (the fake agents skip the leftovers):
//
//   node scripts/medir-reposo.mjs [--src <checkout>/src] [--tasks 40] [--idle 20] [--out <results.json>]
//
// --src: the engine to measure (another checkout's src, e.g. the release before) — the workspace is made with this one.
// Each finished task gets a «task.launched» event and the empty «leftovers_pending» row 3.8.2 left behind.
// Measured during --idle seconds, 5 s after the start: PowerShell processes the engine started, the engine's CPU (% of
// one core), and the event loop's lag: a cheap call (app.coreState) every 100 ms, its round trip p50 / p99 / max.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const SRC = path.resolve(arg('src', path.join(ROOT, 'src')));
const TASKS = Number(arg('tasks', 40));
const IDLE_S = Number(arg('idle', 20));
const out = arg('out');
if (process.platform !== 'win32') { console.error('solo Windows (PowerShell y Win32_Process)'); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-medir-reposo-'));
const SANDBOX = { ORB_NO_ADB: '1', ORB_NO_UPDATE: '1', ORB_BACKUP_ROOT: path.join(tmp, 'copias'), ORB_BRIDGE_DIR: path.join(tmp, 'puente'), ORB_MODELS_DELAY_MS: '600000' };
Object.assign(process.env, SANDBOX);
delete process.env.ORB_FAKE_AGENTS;
const url = (f) => `file:///${path.join(SRC, f).replace(/\\/g, '/')}`;
const { createHome } = await import(url('domain/workspace/home.mjs'));
const { loadConfig, merge } = await import(url('platform/config-file.mjs'));
const { writeJson, paths } = await import(url('platform/paths.mjs'));
const { useHome } = await import(url('platform/context.mjs'));

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the workspace: projects and finished tasks, as after a day of use
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { userName: 'Ana' });
const OFF = Object.fromEntries(['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot'].map((a) => [a, { enabled: false }]));
writeJson(paths(home).config, merge(loadConfig(home), { ui: { tourDone: true }, agents: OFF, autoRun: false }));
useHome(home);
{
  const { Board } = await import(url('core/board.mjs'));
  const { syncProjects } = await import(url('core/projects.mjs'));
  fs.mkdirSync(path.join(home, 'web', 'proyecto-1'), { recursive: true });
  const board = new Board();
  syncProjects(board);
  const dir = path.join(home, 'web', 'proyecto-1');
  board.transaction(() => {
    for (let i = 1; i <= TASKS; i++) {
      const t = board.createTask({ project: 'proyecto-1', title: `Tarea ${i}`, description: 'x', agent: 'claude' }, 'usuario');
      board.run('UPDATE tasks SET status = ?, workdir = ? WHERE id = ?', 'done', dir, t.id);
      board.event(t.id, 'orb', 'task.launched', 'x');
      board.setting(`leftovers_pending:${t.id}`, ''); // what 3.8.2 left for every finished task
    }
  });
  board.db.close();
}

// ---- the engine
const child = fork(path.join(SRC, 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env } });
let n = 0; const pending = new Map();
child.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); p?.(m); } });
const call = (method, params = {}) => new Promise((resolve) => { const id = ++n; pending.set(id, resolve); child.send({ type: 'call', id, method, params }); });
const cleanup = () => {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp folder */ }
};
process.on('exit', cleanup);
await new Promise((resolve, reject) => {
  const onStart = (m) => { if (m?.type !== 'started') return; child.off('message', onStart); if (m.ok) resolve(); else reject(new Error(m.error)); };
  child.on('message', onStart);
  child.send({ type: 'start', home, version: 'medir' });
});
await wait(5000);

// The engine's CPU time (ms) and the PowerShell processes it has started, watched every 200 ms by one PowerShell.
const cpuOf = (pid) => { const o = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$p = Get-Process -Id ${pid}; [math]::Round($p.TotalProcessorTime.TotalMilliseconds)`], { encoding: 'utf8' }); return Number(o.trim()); };
const watcher = spawn('powershell.exe', ['-NoProfile', '-Command', `$seen=@{}; $end=(Get-Date).AddSeconds(${IDLE_S}); while ((Get-Date) -lt $end) { Get-CimInstance Win32_Process -Filter "ParentProcessId=${child.pid} AND Name='powershell.exe'" | ForEach-Object { if (-not $seen.ContainsKey($_.ProcessId)) { $seen[$_.ProcessId]=1; Write-Output $_.ProcessId } }; Start-Sleep -Milliseconds 200 }`], { stdio: ['ignore', 'pipe', 'ignore'] });
let watched = ''; watcher.stdout.on('data', (d) => { watched += d; });
const watchedDone = new Promise((r) => watcher.once('exit', r));
const cpu0 = cpuOf(child.pid); const t0 = Date.now();
const lags = [];
while (Date.now() - t0 < IDLE_S * 1000) {
  const s = performance.now(); await call('app.coreState'); lags.push(performance.now() - s);
  await wait(100);
}
const cpu1 = cpuOf(child.pid); const elapsed = Date.now() - t0;
await watchedDone;
const results = {
  src: SRC, tasks: TASKS, idleS: IDLE_S,
  powershellStarted: watched.split(/\s+/).filter(Boolean).length,
  engineCpuPct: r1(((cpu1 - cpu0) / elapsed) * 100),
  callRoundTripMs: { p50: r1(pct(lags, 50)), p99: r1(pct(lags, 99)), max: r1(Math.max(...lags)), calls: lags.length }
};
console.log(JSON.stringify(results, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
child.send({ type: 'shutdown' });
process.exit(0);
