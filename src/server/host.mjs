// 3.5, Orb Núcleo: the engine without Electron and without a window, for the always-on server (role «centro»). It does in
// plain Node what src/main/main.mjs does with Electron: prepares the Orb folder, starts src/engine/engine.mjs in its own
// process (child_process.fork), relays calls to it and starts it again when it falls (with a growing wait). Nothing here
// is Windows-only; the CLI is src/server/orb-nucleo.mjs and systemd runs it on Linux (scripts/dist-servidor.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isHome, createHome, paths, writeJson, ROLES, readKey, loadConfig } from '../core/home.mjs';
import { createBackup, pruneBackups, backupDir } from '../core/backup.mjs';
import { rotateIfBig, oneLine } from '../core/safety.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENGINE = path.join(ROOT, 'src', 'engine', 'engine.mjs');

export function packageVersion(root = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? '0.0.0'; } catch { return '0.0.0'; }
}

// The Orb folder of the server: --home, else ORB_HOME, else ~/orb.
export const defaultHome = (env = process.env) => path.resolve(env.ORB_HOME || path.join(os.homedir(), 'orb'));

// The folder ready for the engine: made the first time (with its secret, clave.bin, readable by its owner only). The role
// is the user's: a folder without one starts as «centro» (a server keeps the bots); `profile` (--papel) sets it on
// purpose. The first time it becomes «centro» or «todo», the access for other devices is turned on, so they can link to
// it; after that, whatever the user set stays. Returns the Orb folder (createHome may put it in <dir>/Orb).
export function prepareHome(dir, { profile = null } = {}) {
  if (profile != null && !ROLES.includes(profile)) throw new Error(`papel desconocido: ${profile} (${ROLES.join(', ')})`);
  let home = path.resolve(dir);
  if (!isHome(home)) {
    fs.mkdirSync(home, { recursive: true });
    home = createHome(home).home;
  }
  const file = paths(home).config;
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  const want = profile ?? (ROLES.includes(stored.role) ? stored.role : 'centro');
  if (stored.role !== want) {
    stored.role = want;
    if (want !== 'taller') stored.mobile = { port: 3131, wifi: true, tailscale: true, ...(stored.mobile ?? {}), enabled: true };
    writeJson(file, stored);
  }
  return home;
}

// 3.6: before a new version of Orb Núcleo touches the data (its engine may migrate the database), a backup of what the
// old one left: the version that ran last is kept in .orb/datos/nucleo-version; a different one (or none, with a
// database already there: an Orb from before 3.6) makes a «preupdate» copy first. A failed copy is logged, never fatal.
export async function backupOnUpgrade(home, version, log = () => {}) {
  const p = paths(home);
  const mark = path.join(p.data, 'nucleo-version');
  let before = null; try { before = fs.readFileSync(mark, 'utf8').trim() || null; } catch { /* first run */ }
  if (before === version) return null;
  let made = null;
  if (fs.existsSync(p.db) && (before !== null || fs.existsSync(p.config))) {
    try {
      let config = null; try { config = loadConfig(home); } catch { /* default folder */ }
      const r = await createBackup({ home, secret: readKey(home), kind: 'preupdate', version: before, folder: backupDir(home, config), log });
      await pruneBackups(backupDir(home, config)).catch(() => {});
      log(`copia antes de actualizar (${before ?? 'anterior'} → ${version}): ${path.basename(r.file)}`);
      made = r.file;
    } catch (error) { log(`no se pudo hacer la copia antes de actualizar: ${error.message}`); }
  }
  try { fs.mkdirSync(p.data, { recursive: true }); fs.writeFileSync(mark, `${version}
`); } catch { /* next time */ }
  return made;
}

// The host: start() → { home, name, role, headless }, call(method, params) → result, stop() (clean shutdown). Events of the
// engine go to onEvent; restarts are logged and counted (host.restarts).
// backoff: wait before the n-th restart in a row = min(max, base · 2^(n-1)); a run longer than stableMs resets it.
export function createHost({ home, version = packageVersion(), engine = ENGINE, env = {}, onEvent = () => {}, logFile = null,
  backoff = { base: 1000, max: 60_000, stableMs: 60_000 }, echo = false, callTimeoutMs = 10 * 60_000, preUpdateBackup = true } = {}) {
  const logPath = logFile ?? path.join(paths(home).runs, 'nucleo.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = (line) => {
    const text = `${new Date().toISOString()} ${line}\n`;
    try { rotateIfBig(logPath); fs.appendFileSync(logPath, text); } catch { /* never fatal */ }
    if (echo) process.stdout.write(text);
  };
  let child = null; let ready = null; let stopping = false; let timer = null;
  let nextId = 0; const pending = new Map();
  let failsInARow = 0; let startedAt = 0;
  const host = { home, restarts: 0, log, get pid() { return child?.pid ?? null; }, get running() { return Boolean(child); } };

  const spawnEngine = () => {
    // ORB_NUCLEO: the engine runs as the server (the Agent SDK's own Claude Code may stand in for an installed one).
    // ORB_BRIDGE=0: the Open Control Edge bridge is a Windows PC thing. ORB_DEV_CONTROL is never passed on.
    const childEnv = { ...process.env, ORB_NUCLEO: '1', ORB_BRIDGE: '0', ...env };
    delete childEnv.ORB_DEV_CONTROL;
    child = fork(engine, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: childEnv, windowsHide: true });
    const me = child;
    const relay = (chunk) => { for (const line of String(chunk).split('\n')) if (line.trim()) log(`motor: ${oneLine(line, 2000)}`); };
    me.stdout?.on('data', relay); me.stderr?.on('data', relay);
    ready = new Promise((resolve, reject) => {
      me.on('message', (m) => {
        if (m?.type === 'started') {
          if (m.ok) { startedAt = Date.now(); log(`motor listo (pid ${me.pid}, papel ${m.result?.role ?? '?'})`); resolve(m.result); }
          else {
            // A start that fails (a wrong folder…) would fail again: the engine is closed and not started again.
            log(`el motor no arrancó: ${m.error}`); reject(new Error(m.error));
            stopping = true; try { me.kill('SIGKILL'); } catch { /* gone */ }
            try { onEvent('engine:failed', { error: m.error }); } catch { /* listener */ }
          }
          return;
        }
        if (m?.type === 'reply') { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); return m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); }
        if (m?.type === 'event') { try { onEvent(m.event, m.payload); } catch { /* the listener's problem */ } }
      });
      me.once('exit', (code, signal) => {
        if (child === me) { child = null; }
        for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('el motor se ha detenido')); }
        pending.clear();
        reject(new Error(`el motor terminó (código ${code ?? '-'}, señal ${signal ?? '-'})`));
        if (stopping) { log(`motor detenido (código ${code ?? '-'})`); return; }
        // A crash is not the end: it starts again, waiting longer each time it falls soon after starting.
        if (startedAt && Date.now() - startedAt > (backoff.stableMs ?? 60_000)) failsInARow = 0;
        failsInARow++; startedAt = 0;
        const delay = Math.min(backoff.max ?? 60_000, (backoff.base ?? 1000) * 2 ** (failsInARow - 1));
        log(`el motor se ha caído (código ${code ?? '-'}, señal ${signal ?? '-'}): se reinicia en ${Math.round(delay / 100) / 10} s`);
        timer = setTimeout(() => {
          timer = null; if (stopping) return;
          host.restarts++;
          spawnEngine().then(() => { try { onEvent('engine:restarted', { code, signal, restarts: host.restarts }); } catch { /* listener */ } }).catch(() => { /* its exit schedules the next try */ });
        }, delay);
      });
    });
    ready.catch(() => {}); // a failed start is reported through start() or the log, never as an unhandled rejection
    me.send({ type: 'start', home, version, headless: true }); // no window: the role is the one in orb.json
    return ready;
  };

  host.start = async () => { stopping = false; log(`Orb Núcleo ${version}: arrancando el motor en ${home}`); if (preUpdateBackup) await backupOnUpgrade(home, version, log); return spawnEngine(); };
  // Waits for the engine (also while it is being started again) and calls it.
  host.call = async (method, params = {}) => {
    if (!child) throw new Error('el motor no está en marcha');
    await ready;
    const me = child; if (!me) throw new Error('el motor no está en marcha');
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error('el motor no contesta')); }, callTimeoutMs);
      pending.set(id, { resolve, reject, timer: t });
      try { me.send({ type: 'call', id, method, params }); } catch (error) { clearTimeout(t); pending.delete(id); reject(error); }
    });
  };
  // Clean stop: the engine closes the phone access (and `tailscale serve`) and its agents; after waitMs it is killed.
  host.stop = async ({ waitMs = 8000 } = {}) => {
    stopping = true;
    if (timer) { clearTimeout(timer); timer = null; }
    const me = child; if (!me) return { clean: true };
    const gone = new Promise((r) => me.once('exit', (code) => r(code)));
    try { me.send({ type: 'shutdown' }); } catch { /* already gone */ }
    let clean = true;
    const code = await Promise.race([gone, new Promise((r) => setTimeout(() => r('timeout'), waitMs))]);
    if (code === 'timeout') { clean = false; log('el motor no se cerró a tiempo: se fuerza'); try { me.kill('SIGKILL'); } catch { /* gone */ } await gone; }
    return { clean, code };
  };
  return host;
}
