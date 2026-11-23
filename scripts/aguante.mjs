// Endurance test of the phone-PC link (Orb 3.8.10, contract in desarrollo/orb-3.8.9-conexion-contrato.md).
// Starts the real engine (src/engine/engine.mjs) on a throwaway workspace in %TEMP% with the fake agents (never the real
// C:\Orb or %APPDATA%), links one or two simulated phones through a local TCP proxy and, for hours, keeps using the link
// while cutting it: abrupt closes of the live-event stream, a network that stops answering (stalled or reset), calls cut
// in the middle (request or answer lost, to force the resend with the same nonce), engine restarts and phone clocks off
// within the margin. Nothing opens a window.
//
//   node scripts/aguante.mjs [--hours 24 | --minutes 3] [--out <dir>] [--phones 2] [--seed 1]
//        [--msg-every 4] [--cut-every 90] [--restart-every 10800] [--sample-every 300] [--partial-every 3600]
//        [--call-timeout 45] [--long-stall-every 20] [--fault-rate 0.15]
//
// What it counts (per phone, by event id `<boot>.<n>`): events lost or duplicated, resyncs, calls executed twice (the
// chat lines the engine stored, one per logical message), reconnect times against the contract (1/2/5/10/30 s), the 15 s
// heartbeat, and the engine's memory and CPU every --sample-every seconds. A summary (JSON plus readable lines) is
// written at the end and a partial one every --partial-every seconds. Exit code 1 on any loss, duplicate, double
// execution or contract violation. To stop it early: create the file PARAR in the output folder (or taskkill /T /PID).
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const TOTAL_S = arg('minutes') != null ? Number(arg('minutes')) * 60 : Number(arg('hours', 24)) * 3600;
const PHONES = Math.max(1, Math.min(4, Number(arg('phones', 2))));
const MSG_EVERY = Number(arg('msg-every', 4));
const CUT_EVERY = Number(arg('cut-every', 90));
const RESTART_EVERY = Number(arg('restart-every', 10800));
const SAMPLE_EVERY = Number(arg('sample-every', 300));
const PARTIAL_EVERY = Number(arg('partial-every', 3600));
const CALL_MS = Number(arg('call-timeout', 45)) * 1000;
const LONG_STALL_EVERY = Number(arg('long-stall-every', 20));
const FAULT_RATE = Number(arg('fault-rate', 0.15));
const APPROVAL_EVERY = Number(arg('approval-every', Math.max(20, Math.min(120, TOTAL_S / 6))));
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), `orb-aguante-${Date.now()}`)));
fs.mkdirSync(OUT, { recursive: true });
if (!(TOTAL_S > 0)) { console.error('duración no válida'); process.exit(2); }

// the contract's numbers
const RETRY_S = [1, 2, 5, 10, 30];
const IDLE_MS = 40_000; // a stream silent this long is dead
const PING_LIMIT_MS = 17_000; // the PC pings every 15 s
const HEADERS_MS = 8_000;
const RECONNECT_LIMIT_MS = 40_000; // the 30 s step, the headers timeout and some slack

// mulberry32: a reproducible run for a given --seed
let seedState = Number(arg('seed', Date.now() % 100000)) >>> 0;
const rnd = () => { seedState = (seedState + 0x6D2B79F5) >>> 0; let t = seedState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b) => a + rnd() * (b - a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = (b) => Math.round((b / 1048576) * 10) / 10;
const stamp = () => new Date().toISOString();
const logFile = path.join(OUT, 'aguante.log');
const note = (line) => { try { fs.appendFileSync(logFile, `${stamp()} ${line}\n`); } catch { /* log unavailable */ } };

// ---- the sandbox: a throwaway workspace, the fake agents, loopback only
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-aguante-'));
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs');
const ENGINE_PORT = 20000 + Math.floor(rnd() * 20000);
// The vault helper (built by scripts/vault-build.mjs, not here: no cargo): this copy's, or the newest of a sibling copy.
// It is copied into the sandbox so a long run never locks a file another copy needs to rebuild.
function findVault() {
  if (process.env.ORB_VAULT_BIN && fs.existsSync(process.env.ORB_VAULT_BIN)) return process.env.ORB_VAULT_BIN;
  const name = process.platform === 'win32' ? 'orb-vault.exe' : 'orb-vault';
  const own = path.join(ROOT, 'src-tauri', 'target', 'release', name);
  const sibs = fs.existsSync(path.dirname(ROOT)) ? fs.readdirSync(path.dirname(ROOT)).map((d) => path.join(path.dirname(ROOT), d, 'src-tauri', 'target', 'release', name)) : [];
  if (fs.existsSync(own)) return own;
  return sibs.filter((x) => fs.existsSync(x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}
const vaultSrc = findVault();
if (!vaultSrc) { console.error('falta orb-vault (node scripts/vault-build.mjs)'); process.exit(2); }
fs.mkdirSync(tmp, { recursive: true });
const vaultBin = path.join(tmp, path.basename(vaultSrc)); fs.copyFileSync(vaultSrc, vaultBin);
const SANDBOX = { ORB_VAULT_BIN: vaultBin, ORB_NO_ADB: '1', ORB_NO_UPDATE: '1', ORB_FAKE_AGENTS: FAKE, ORB_BACKUP_ROOT: path.join(tmp, 'copias'), ORB_BRIDGE_DIR: path.join(tmp, 'puente'), ORB_MODELS_DELAY_MS: '600000', ORB_REMOTE_BIND: '127.0.0.1', ORB_FAKE_LOG: path.join(tmp, 'fake.jsonl') };
Object.assign(process.env, SANDBOX);
const { createHome } = await import('../src/domain/workspace/home.mjs');
const { loadConfig, merge } = await import('../src/platform/config-file.mjs');
const { writeJson, paths } = await import('../src/platform/paths.mjs');
const { useHome } = await import('../src/platform/context.mjs');
const C = await import('../src/shared/mobile-crypto.mjs');
const { createPhone, TEST_MASTER } = await import('../test/fixtures/phone-client.mjs');
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { userName: 'Ana' });
const OFF = Object.fromEntries(['cursor', 'gemini', 'opencode', 'qwen', 'copilot', 'hermes'].map((a) => [a, { enabled: false }]));
writeJson(paths(home).config, merge(loadConfig(home), { ui: { tourDone: true }, agents: OFF, autoRun: false, mobile: { enabled: true, port: ENGINE_PORT } }));
useHome(home);
fs.mkdirSync(path.join(home, 'web', 'aguante'), { recursive: true });
{
  const { Board } = await import('../src/domain/tasks/board.mjs');
  const { syncProjects } = await import('../src/domain/projects/projects.mjs');
  const board = new Board(); syncProjects(board); board.db.close();
}
const dbPath = paths(home).db;
const motorLog = path.join(home, 'core', 'ejecuciones', 'motor.log');
const errFd = fs.openSync(path.join(OUT, 'motor-stderr.log'), 'a');

// ---- the engine, as a child process the way the app runs it
let engine = null; // { child, call, stop, pid, bootedAt }
let engineUpAt = 0;
async function startEngine() {
  const child = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'ignore', errFd, 'ipc'], env: { ...process.env, ...SANDBOX }, windowsHide: true });
  let n = 0; const pending = new Map();
  child.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.resolve(m.result) : p.reject(new Error(m.error))); } });
  const exited = new Promise((r) => child.once('exit', r));
  child.once('exit', () => { for (const p of pending.values()) p.reject(new Error('el motor se ha cerrado')); pending.clear(); });
  await new Promise((resolve, reject) => {
    const onStart = (m) => { if (m?.type !== 'started') return; child.off('message', onStart); if (m.ok) resolve(); else reject(new Error(m.error)); };
    child.on('message', onStart);
    child.send({ type: 'start', home, version: 'aguante' });
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    if (!child.connected) return reject(new Error('el motor no está'));
    const id = ++n; pending.set(id, { resolve, reject }); child.send({ type: 'call', id, method, params });
  });
  const e = { child, call, pid: child.pid, startedAt: Date.now(),
    stop: async () => { try { child.send({ type: 'shutdown' }); } catch { /* gone */ } await Promise.race([exited, wait(8000)]); if (child.exitCode == null) child.kill(); } };
  engine = e;
  return e;
}
async function unlockAndOpen(e, first) {
  if (first) await e.call('master.create', { password: TEST_MASTER }); else await e.call('master.unlock', { password: TEST_MASTER });
  for (let i = 0; i < 300; i++) { if ((await e.call('remote.status')).running) { engineUpAt = Date.now(); return; } await wait(100); }
  throw new Error('el servidor del móvil no arrancó');
}

// ---- the proxy between a phone and the engine: pass, stall (nothing moves), down (every connection reset) and one-shot
// faults for the next connection (the request cut half-way, or the answer lost after the engine got the whole request).
function createProxy(targetPort) {
  let mode = 'pass'; let armed = null; let lastChange = Date.now(); let restoredAt = Date.now();
  const pairs = new Set();
  const server = net.createServer((c) => {
    if (mode === 'down') { c.destroy(); return; }
    const fault = armed; armed = null;
    const u = net.connect(targetPort, '127.0.0.1');
    const pair = { c, u, fault, qc: [], qu: [], firstDown: true };
    pairs.add(pair);
    const end = () => { pairs.delete(pair); c.destroy(); u.destroy(); };
    c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', end);
    const toUp = (d) => { if (u.writable) u.write(d); };
    c.on('data', (d) => {
      if (fault === 'halfRequest' && pair.firstDown) {
        pair.firstDown = false;
        const cut = d.indexOf('\r\n\r\n');
        if (cut > 0) { toUp(d.subarray(0, Math.min(d.length, cut + 4 + 5))); setTimeout(end, 20); return; }
      }
      pair.firstDown = false;
      if (mode === 'stall') pair.qu.push(d); else toUp(d);
    });
    u.on('data', (d) => {
      if (fault === 'dropResponse') { setTimeout(end, 5); return; }
      if (mode === 'stall') pair.qc.push(d); else if (c.writable) c.write(d);
    });
  });
  const flush = () => { for (const p of pairs) { for (const d of p.qu.splice(0)) if (p.u.writable) p.u.write(d); for (const d of p.qc.splice(0)) if (p.c.writable) p.c.write(d); } };
  const api = {
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => { api.port = server.address().port; resolve(); })),
    get mode() { return mode; },
    get lastChange() { return lastChange; },
    get restoredAt() { return restoredAt; },
    arm(kind) { armed = kind; },
    disarm() { armed = null; },
    set(next) {
      if (next === mode) return;
      const was = mode; mode = next; lastChange = Date.now();
      if (next === 'down') for (const p of [...pairs]) { p.c.destroy(); p.u.destroy(); pairs.delete(p); }
      if (next === 'pass') { restoredAt = Date.now(); if (was === 'stall') flush(); }
    },
    close: () => { for (const p of pairs) { p.c.destroy(); p.u.destroy(); } server.close(); }
  };
  return api;
}

// ---- a simulated phone: the link's key (from the test fixture's pairing), its own streams and calls through its proxy
const stats = { start: Date.now(), restarts: 0, cuts: {}, approvals: { asked: 0, done: 0, failed: 0 }, samples: [], anomalies: [], notes: {} };
const anomaly = (kind, detail) => { note(`ANOMALÍA ${kind} ${JSON.stringify(detail)}`); if (stats.anomalies.length < 200) stats.anomalies.push({ at: stamp(), kind, ...detail }); };
const bump = (o, k, by = 1) => { o[k] = (o[k] ?? 0) + by; };
const parseId = (id) => { const m = /^([0-9a-f]{12})\.(\d{1,15})$/.exec(String(id ?? '')); return m ? { boot: m[1], n: Number(m[2]) } : null; };
let gate = { restarting: false };
let stopping = false;

function createSim(index, link, proxy) {
  const label = `móvil${index + 1}`;
  const s = { label, id: link.id, key: link.key, skew: 0, proxy, lastId: null, lastBoot: null, lastN: null, resynced: false, connected: false, down: null,
    events: 0, byType: {}, dups: 0, lost: 0, resyncs: 0, resyncsSameBoot: 0, reconnects: 0, retries: {}, maxReconnectMs: 0, maxCleanGapMs: 0, idleKills: 0, streamErrors: 0,
    gaps: [], gapsExplained: 0, reloads: 0,
    calls: { sent: 0, ok: 0, failed: 0, resent: 0, gone: 0, clock409: 0, errors: 0, faults: { halfRequest: 0, dropResponse: 0 }, latencySum: 0, latencyMax: 0 },
    logical: new Map(), seq: 0, conversation: null, inflight: 0, ctrl: null, failures: 0 };
  const stampNow = () => Date.now() + s.skew;
  const mutateSkew = () => { s.skew = Math.round(between(-240, 240)) * 1000; note(`${label} reloj desfasado ${s.skew / 1000} s`); };
  mutateSkew();
  const hostHeader = `127.0.0.1:${ENGINE_PORT}`;

  // The same sealing as the page (src/ui/lib/web-bridge.js): one box per logical call, resent as is.
  const sealBox = (m, b) => C.seal(s.key, { t: stampNow(), m, b }, C.AAD.request(s.id));
  function post(box, timeoutMs) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(box);
      const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'POST', path: '/api/call', agent: false,
        headers: { Host: hostHeader, 'X-Orb-Device': s.id, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        const chunks = []; res.on('data', (d) => chunks.push(d));
        res.on('end', () => { clearTimeout(timer); let json = {}; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
        res.on('error', (e) => { clearTimeout(timer); reject(e); });
      });
      const timer = setTimeout(() => req.destroy(Object.assign(new Error('tiempo agotado'), { timeout: true })), timeoutMs);
      req.on('error', (e) => { clearTimeout(timer); reject(Object.assign(e, { offline: true })); });
      req.end(body);
    });
  }
  // One logical call: sent, and if it gets no answer, resent ONCE with the same nonce (contract §4).
  async function call(method, params = {}, { fault = null } = {}) {
    s.calls.sent++; s.inflight++;
    const t0 = Date.now();
    try {
      let box = sealBox('call', { method, params });
      let res; let resent = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt === 0 && fault) { proxy.arm(fault); bump(s.calls.faults, fault); }
        try { res = await post(box, CALL_MS); break; }
        catch (e) { proxy.disarm(); if (attempt === 1) throw e; resent = true; s.calls.resent++; }
      }
      if (res.status === 409 && !resent && Number.isFinite(res.json?.now)) { s.calls.clock409++; anomaly('reloj-409', { label }); s.skew = res.json.now - Date.now(); box = sealBox('call', { method, params }); res = await post(box, CALL_MS); }
      if (res.status === 410) { s.calls.gone++; return { ok: false, gone: true }; }
      if (res.status === 401) { anomaly('desvinculado', { label, method }); return { ok: false, error: 'desvinculado' }; }
      if (res.status !== 200) return { ok: false, error: `estado ${res.status}`, status: res.status };
      const msg = C.open(s.key, res.json, C.AAD.response(s.id));
      if (msg.r !== box.n) { anomaly('respuesta-ajena', { label, method }); return { ok: false, error: 'respuesta no válida' }; }
      s.calls.ok++;
      const ms = Date.now() - t0; s.calls.latencySum += ms; s.calls.latencyMax = Math.max(s.calls.latencyMax, ms);
      return msg;
    } catch (e) { s.calls.failed++; return { ok: false, error: e.message, offline: true }; }
    finally { s.inflight--; }
  }

  // ---- the live events (what the page's web-bridge does): resumes with Last-Event-ID, reloads on resync, 40 s of silence = dead
  const pendingGaps = [];
  function onEvent(id, ev, at) {
    s.events++; bump(s.byType, ev.e);
    if (ev.e === 'resync') {
      s.resyncs++; s.lastId = null; s.lastN = null; s.resynced = true; s.reloads++;
      note(`${label} resync`);
      return;
    }
    const cur = parseId(id);
    if (!cur) return;
    if (ev.e === 'chat:state') for (const g of pendingGaps) if (cur.n > g.to && at - g.at < 3000 && g.left > 0) { g.left--; s.gapsExplained++; }
    s.lastId = id;
    if (s.lastBoot && cur.boot !== s.lastBoot) {
      if (!s.resynced) { s.lost++; anomaly('arranque-sin-resync', { label, from: s.lastBoot, to: cur.boot }); }
      s.lastBoot = cur.boot; s.lastN = cur.n; s.resynced = false; return;
    }
    if (!s.lastBoot) s.lastBoot = cur.boot;
    if (s.lastN != null) {
      if (cur.n <= s.lastN) { s.dups++; anomaly('duplicado', { label, id }); return; }
      if (cur.n > s.lastN + 1) { const g = { at, from: s.lastN, to: cur.n, left: cur.n - s.lastN - 1, total: cur.n - s.lastN - 1 }; pendingGaps.push(g); s.gaps.push(g); }
    }
    s.lastN = cur.n; s.resynced = false;
  }
  const settleGaps = (final = false) => {
    const now = Date.now();
    for (let i = pendingGaps.length - 1; i >= 0; i--) {
      const g = pendingGaps[i];
      if (!final && now - g.at < 5000) continue;
      if (g.left > 0) { s.lost += g.left; anomaly('hueco-de-eventos', { label, from: g.from, to: g.to, sinExplicar: g.left }); }
      pendingGaps.splice(i, 1);
    }
  };
  function openStream() {
    return new Promise((resolve) => {
      const auth = C.sealText(s.key, { t: stampNow(), m: 'events' }, C.AAD.request(s.id));
      const headers = { Host: hostHeader, 'X-Orb-Device': s.id, 'X-Orb-Auth': auth };
      if (s.lastId) headers['Last-Event-ID'] = s.lastId;
      let up = false; let buf = ''; let lastChunk = 0; let idle = null;
      const finish = (ok) => { clearTimeout(headerTimer); clearInterval(idle); s.ctrl = null; resolve(ok); };
      const req = http.request({ host: '127.0.0.1', port: proxy.port, path: '/api/events', agent: false, headers }, (res) => {
        if (res.statusCode !== 200) { if (res.statusCode === 401) anomaly('desvinculado', { label, stream: true }); res.resume(); res.on('end', () => finish(false)); return; }
        clearTimeout(headerTimer);
        up = true; s.connected = true; lastChunk = Date.now();
        if (s.down) { const ms = Date.now() - Math.max(s.down.restoredAt(), s.down.since); s.maxReconnectMs = Math.max(s.maxReconnectMs, ms); s.reconnects++; if (ms > RECONNECT_LIMIT_MS) anomaly('reconexion-lenta', { label, ms }); s.down = null; }
        s.failures = 0;
        idle = setInterval(() => { if (Date.now() - lastChunk > IDLE_MS) { s.idleKills++; note(`${label} sin señal ${IDLE_MS / 1000} s: cierro y reabro`); req.destroy(); } }, 1000);
        res.on('data', (d) => {
          const at = Date.now(); const gap = at - lastChunk;
          if (proxy.mode === 'pass' && proxy.lastChange <= lastChunk && !gate.restarting) s.maxCleanGapMs = Math.max(s.maxCleanGapMs, gap);
          if (gap > PING_LIMIT_MS && proxy.mode === 'pass' && proxy.lastChange <= lastChunk && !gate.restarting) anomaly('latido-tardio', { label, ms: gap });
          lastChunk = at;
          buf += d.toString('utf8');
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const lines = block.split('\n');
            const idLine = lines.find((l) => l.startsWith('id: '));
            const data = lines.filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
            if (!data) continue;
            let ev; try { ev = C.openText(s.key, data, C.AAD.event(s.id)); } catch { anomaly('evento-ilegible', { label }); continue; }
            onEvent(idLine ? idLine.slice(4) : null, ev, at);
          }
        });
        res.on('end', () => finish(true)); res.on('error', () => finish(true)); res.on('close', () => finish(true));
      });
      const headerTimer = setTimeout(() => req.destroy(new Error('sin cabeceras')), HEADERS_MS);
      req.on('error', () => { s.streamErrors++; finish(up); });
      s.ctrl = req; req.end();
    });
  }
  async function streamLoop() {
    while (!stopping) {
      const ok = await openStream();
      if (stopping) break;
      const hadUp = s.connected; s.connected = false;
      if (hadUp) { s.down = { since: Date.now(), restoredAt: () => Math.max(proxy.restoredAt, engineUpAt) }; s.failures = 0; }
      else s.failures++;
      const w = RETRY_S[Math.min(s.failures, RETRY_S.length - 1)];
      bump(s.retries, w);
      void ok;
      await wait(w * 1000);
    }
  }

  // ---- what the phone does all day
  async function sendMessage() {
    const k = ++s.seq; const text = `aguante ${label}-${k}`;
    const fault = rnd() < FAULT_RATE ? (rnd() < 0.5 ? 'halfRequest' : 'dropResponse') : null;
    const params = { text, ...(s.conversation && k % 150 !== 0 ? { conversation: s.conversation } : {}) };
    const r = await call('chat.send', params, { fault });
    s.logical.set(text, { ok: r.ok === true, at: Date.now() });
    if (r.ok && r.result?.conversation != null) s.conversation = r.result.conversation;
  }
  async function reload() { await call('app.state'); await call('conversations.list'); await call('inbox.list', { zone: 'orb' }); s.reloads++; }
  async function traffic() {
    while (!stopping) {
      await wait(between(0.5, 1.5) * MSG_EVERY * 1000);
      if (stopping) break;
      if (gate.restarting) continue;
      const r = rnd();
      if (r < 0.75) await sendMessage();
      else if (r < 0.9) await call('app.state');
      else await reload();
    }
  }
  return { s, call, streamLoop, traffic, mutateSkew, settleGaps, stopStream: () => s.ctrl?.destroy() };
}

// ---- cuts
async function cut(sims, kind, short) {
  bump(stats.cuts, kind);
  const dur = Math.round(between(1, short ? 4 : 8) * 1000);
  note(`corte ${kind} (${kind === 'stallLargo' ? 'largo' : `${dur} ms`})`);
  const some = sims.filter(() => rnd() < 0.7); const hit = some.length ? some : [sims[0]];
  if (kind === 'reset') { for (const x of hit) x.s.proxy.set('down'); await wait(dur); for (const x of hit) x.s.proxy.set('pass'); }
  else if (kind === 'stall') { for (const x of hit) x.s.proxy.set('stall'); await wait(Math.min(dur + 2000, CALL_MS * 0.6)); for (const x of hit) x.s.proxy.set('pass'); }
  else if (kind === 'stallLargo') { for (const x of hit) x.s.proxy.set('stall'); await wait(IDLE_MS + 5000); for (const x of hit) x.s.proxy.set('pass'); }
  else if (kind === 'streamCut') { for (const x of hit) { for (const p of [x.s.proxy]) { p.set('down'); p.set('pass'); } } }
}

// ---- measurements
function procInfo(pid) {
  try {
    const ps = `$p = Get-Process -Id ${pid}; @{ ws = $p.WorkingSet64; priv = $p.PrivateMemorySize64; cpu = $p.TotalProcessorTime.TotalMilliseconds } | ConvertTo-Json -Compress`;
    const j = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 20000 }));
    return { wsMB: MB(j.ws), privateMB: MB(j.priv), cpuMs: Math.round(j.cpu) };
  } catch { return null; }
}
let lastCpu = null;
let logOffset = 0; const logErrors = { count: 0, samples: [] };
const sample = () => {
  if (!engine) return;
  const p = procInfo(engine.pid); if (!p) return;
  const at = Date.now();
  let cpuPct = null;
  if (lastCpu && lastCpu.pid === engine.pid) cpuPct = Math.round(((p.cpuMs - lastCpu.cpuMs) / (at - lastCpu.at)) * 1000) / 10;
  lastCpu = { pid: engine.pid, cpuMs: p.cpuMs, at };
  stats.samples.push({ at: stamp(), run: stats.restarts, ...p, cpuPct, orbRssMB: MB(process.memoryUsage().rss) });
  if (stats.samples.length > 600) stats.samples.splice(1, 1);
  // new error lines in motor.log since the last look
  try {
    const st = fs.statSync(motorLog);
    if (st.size < logOffset) logOffset = 0;
    const fd = fs.openSync(motorLog, 'r'); const len = st.size - logOffset; const b = Buffer.alloc(Math.min(len, 2_000_000));
    fs.readSync(fd, b, 0, b.length, logOffset); fs.closeSync(fd); logOffset += b.length;
    for (const l of b.toString('utf8').split('\n')) if (/error|excepci|uncaught|fallo|no se pudo|rechaz/i.test(l)) { logErrors.count++; if (logErrors.samples.length < 30) logErrors.samples.push(l.slice(0, 300)); }
  } catch { /* log not there yet */ }
};
const slope = (pts) => { // MB per hour, least squares
  if (pts.length < 4 || pts.at(-1).t - pts[0].t < 20 * 60_000) return null; // too short a run to tell a trend
  const t0 = pts[0].t; const xs = pts.map((p) => (p.t - t0) / 3600000); const ys = pts.map((p) => p.y);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length; const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0); if (!den) return null;
  return Math.round((xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den) * 10) / 10;
};

function executions() {
  const out = new Map();
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try { for (const r of db.prepare("SELECT body, COUNT(*) AS n FROM chat WHERE role = 'usuario' AND body LIKE 'aguante m%' GROUP BY body").all()) out.set(r.body, r.n); } finally { db.close(); }
  } catch (e) { note(`no pude leer la base: ${e.message}`); return null; }
  return out;
}

function summary(sims, { final }) {
  for (const x of sims) x.settleGaps(final);
  const exec = executions();
  const calls = { doubles: 0, okNotExecuted: 0, executedOfFailed: 0, logical: 0 };
  const now = Date.now();
  for (const x of sims) for (const [text, v] of x.s.logical) {
    calls.logical++;
    const n = exec?.get(text) ?? 0;
    if (exec == null) continue;
    if (n > 1) { calls.doubles++; anomaly('ejecucion-doble', { text, veces: n }); }
    else if (v.ok && n === 0 && now - v.at > 10_000) { calls.okNotExecuted++; anomaly('ok-sin-ejecutar', { text }); }
    else if (!v.ok && n === 1) calls.executedOfFailed++;
  }
  const phones = sims.map((x) => { const s = x.s; return { phone: s.label, events: s.events, byType: s.byType, lost: s.lost, duplicates: s.dups, resyncs: s.resyncs, gapsExplainedByNewerState: s.gapsExplained, reconnects: s.reconnects, maxReconnectMs: s.maxReconnectMs, retryWaitsUsed: s.retries, maxCleanHeartbeatGapMs: s.maxCleanGapMs, idleKills: s.idleKills, streamErrors: s.streamErrors, calls: { ...s.calls, avgMs: s.calls.ok ? Math.round(s.calls.latencySum / s.calls.ok) : null } }; });
  const mem = []; const byRun = new Map();
  for (const m of stats.samples) { if (!byRun.has(m.run)) byRun.set(m.run, []); byRun.get(m.run).push({ t: Date.parse(m.at), y: m.privateMB }); }
  for (const [run, pts] of byRun) mem.push({ run, samples: pts.length, privateMBPerHour: slope(pts) });
  const cpus = stats.samples.map((m) => m.cpuPct).filter((x) => x != null);
  const elapsed = Math.round((now - stats.start) / 1000);
  const violations = stats.anomalies.filter((a) => ['reconexion-lenta', 'latido-tardio', 'desvinculado', 'respuesta-ajena', 'evento-ilegible', 'reloj-409'].includes(a.kind)).length;
  const lost = phones.reduce((a, p) => a + p.lost, 0); const dups = phones.reduce((a, p) => a + p.duplicates, 0);
  const ok = lost === 0 && dups === 0 && calls.doubles === 0 && calls.okNotExecuted === 0 && violations === 0;
  return { final, ok, elapsedS: elapsed, plannedS: TOTAL_S, engineRestarts: stats.restarts, cuts: stats.cuts, approvals: stats.approvals,
    events: { lost, duplicates: dups, resyncs: phones.reduce((a, p) => a + p.resyncs, 0) }, calls, phones, violations,
    engine: { samples: stats.samples.length, last: stats.samples.at(-1) ?? null, maxPrivateMB: Math.max(0, ...stats.samples.map((m) => m.privateMB)), maxWsMB: Math.max(0, ...stats.samples.map((m) => m.wsMB)), maxCpuPct: cpus.length ? Math.max(...cpus) : null, avgCpuPct: cpus.length ? Math.round((cpus.reduce((a, b) => a + b, 0) / cpus.length) * 10) / 10 : null, memoryTrendPerRun: mem },
    motorLogErrors: logErrors, anomalies: stats.anomalies.slice(0, 50), notes: { workspace: tmp, out: OUT, enginePort: ENGINE_PORT } };
}
function lines(r) {
  const L = [];
  L.push(`${r.final ? 'RESULTADO' : 'PARCIAL'}: ${r.ok ? 'CORRECTO' : 'CON FALLOS'} · ${Math.round(r.elapsedS / 60)} min de ${Math.round(r.plannedS / 60)} · reinicios del motor ${r.engineRestarts}`);
  L.push(`Eventos: perdidos ${r.events.lost}, duplicados ${r.events.duplicates}, resync ${r.events.resyncs}. Llamadas lógicas ${r.calls.logical}: ejecutadas dos veces ${r.calls.doubles}, ok sin ejecutar ${r.calls.okNotExecuted}, falladas que sí se ejecutaron ${r.calls.executedOfFailed}.`);
  L.push(`Cortes: ${JSON.stringify(r.cuts)} · aprobaciones ${JSON.stringify(r.approvals)} · violaciones del contrato ${r.violations}`);
  for (const p of r.phones) L.push(`${p.phone}: ${p.events} eventos, ${p.reconnects} reconexiones (máx ${Math.round(p.maxReconnectMs / 100) / 10} s, esperas ${JSON.stringify(p.retryWaitsUsed)}), latido máx ${Math.round(p.maxCleanHeartbeatGapMs / 100) / 10} s, llamadas ${p.calls.ok}/${p.calls.sent} (reenvíos ${p.calls.resent}, 410 ${p.calls.gone}, media ${p.calls.avgMs} ms)`);
  L.push(`Motor: memoria privada máx ${r.engine.maxPrivateMB} MB, working set máx ${r.engine.maxWsMB} MB, CPU media ${r.engine.avgCpuPct}% máx ${r.engine.maxCpuPct}%, tendencia ${JSON.stringify(r.engine.memoryTrendPerRun)} (MB/h por arranque)`);
  L.push(`motor.log: ${r.motorLogErrors.count} líneas con error${r.motorLogErrors.samples.length ? `, p. ej. «${r.motorLogErrors.samples[0]}»` : ''}`);
  for (const a of r.anomalies.slice(0, 8)) L.push(`  anomalía ${a.kind} ${JSON.stringify({ ...a, kind: undefined, at: undefined })}`);
  return L;
}
const write = (sims, final) => {
  const r = summary(sims, { final });
  const name = final ? 'resumen' : 'parcial';
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(OUT, `${name}.txt`), `${lines(r).join('\n')}\n`);
  return r;
};

// ---- the run
fs.writeFileSync(path.join(OUT, 'pid.txt'), `${process.pid}\n`);
note(`inicio: ${TOTAL_S} s, ${PHONES} móviles, puerto ${ENGINE_PORT}, espacio ${tmp}`);
let e = await startEngine();
await unlockAndOpen(e, true);
const proxies = []; const sims = [];
for (let i = 0; i < PHONES; i++) {
  const { url } = await e.call('remote.pair', {});
  const phone = createPhone({ name: `Móvil ${i + 1}`, kind: i ? 'browser' : 'phone' });
  const { id } = await phone.connect({ qr: url });
  const link = phone.raw(id); phone.stop(); // the fixture's own stream goes; this script's streams take over
  const proxy = createProxy(ENGINE_PORT); await proxy.listen();
  proxies.push(proxy); sims.push(createSim(i, { id: link.id, key: link.key }, proxy));
}
note('móviles enlazados');
const deadline = Date.now() + TOTAL_S * 1000;
const loops = sims.flatMap((x) => [x.streamLoop(), x.traffic()]);

const sideLoops = [];
// board events and approvals, driven from the PC side like a person using the app
sideLoops.push((async () => {
  let k = 0;
  while (!stopping) {
    await wait(between(3, 8) * 1000);
    if (stopping || gate.restarting || !engine?.child.connected) continue;
    try { const sec = await engine.call('inbox.sections.create', { zone: 'orb', name: `s${++k}` }); await engine.call('inbox.sections.delete', { id: sec.id }); } catch { /* the engine may be restarting */ }
  }
})());
sideLoops.push((async () => {
  let session = null; let used = 0;
  while (!stopping) {
    await wait(APPROVAL_EVERY * 1000);
    if (stopping || gate.restarting || !engine?.child.connected) continue;
    try {
      if (!session || ++used > 30) { session = (await engine.call('sessions.create', { agent: 'claude', project: 'aguante' })).id; used = 0; }
      stats.approvals.asked++;
      await engine.call('sessions.send', { id: session, text: 'PIDE_PERMISO' });
      let done = false;
      for (let i = 0; i < 40 && !done && !stopping; i++) {
        await wait(1000);
        const r = await sims[0].call('approvals.list');
        const it = r.ok ? (r.result ?? []).find((x) => x.session?.id === session) : null;
        if (it) { const a = await sims[0].call('sessions.approve', { id: session, request: it.body?.id ?? it.id, decision: 'allow' }); done = a.ok === true; if (!done) note(`aprobación: ${a.error}`); }
      }
      if (done) stats.approvals.done++; else { stats.approvals.failed++; try { const pend = await engine.call('approvals.list'); for (const it of pend.filter((x) => x.session?.id === session)) await engine.call('sessions.approve', { id: session, request: it.body?.id ?? it.id, decision: 'deny' }); } catch { /* gone */ } }
    } catch (error) { stats.approvals.failed++; note(`aprobación: ${error.message}`); }
  }
})());
// cuts, restarts, clock changes, samples and partial summaries
const KINDS = ['reset', 'stall', 'streamCut', 'stall', 'reset'];
sideLoops.push((async () => {
  let n = 0; const short = TOTAL_S < 1800;
  while (!stopping) {
    await wait(between(0.7, 1.3) * CUT_EVERY * 1000);
    if (stopping || gate.restarting) continue;
    n++;
    const kind = LONG_STALL_EVERY > 0 && n % LONG_STALL_EVERY === 0 ? 'stallLargo' : KINDS[n % KINDS.length];
    await cut(sims, kind, short);
    if (n % 7 === 0) for (const x of sims) x.mutateSkew();
  }
})());
let nextRestart = Date.now() + RESTART_EVERY * 1000; let nextSample = Date.now() + 5000; let nextPartial = Date.now() + PARTIAL_EVERY * 1000;
async function restartEngine() {
  gate.restarting = true; note('reinicio del motor: espero las llamadas en curso');
  for (let i = 0; i < 200 && sims.some((x) => x.s.inflight > 0); i++) await wait(500);
  await engine.stop();
  await wait(between(0.5, 2) * 1000);
  engine = null; e = await startEngine(); await unlockAndOpen(e, false);
  stats.restarts++; gate.restarting = false; note('motor de nuevo en marcha');
}
const SHORT_RESTART = TOTAL_S < 1800 ? Math.round(TOTAL_S * 0.35 * 1000) : null;
if (SHORT_RESTART) nextRestart = Date.now() + SHORT_RESTART;
const stopFile = path.join(OUT, 'PARAR');
while (!stopping) {
  await wait(1000);
  const now = Date.now();
  if (now >= deadline || fs.existsSync(stopFile)) break;
  if (now >= nextSample) { sample(); nextSample = now + SAMPLE_EVERY * 1000; }
  if (now >= nextPartial) { try { write(sims, false); } catch (error) { note(`parcial: ${error.message}`); } nextPartial = now + PARTIAL_EVERY * 1000; }
  if (now >= nextRestart && deadline - now > 30_000) { try { await restartEngine(); } catch (error) { anomaly('reinicio-fallido', { error: error.message }); break; } nextRestart = Date.now() + RESTART_EVERY * 1000; }
}
// finish: stop the traffic, give the streams a moment to deliver what is left, then count
stopping = true;
note('fin: cierro el tráfico');
await wait(6000);
for (const x of sims) x.stopStream();
await Promise.race([Promise.all([...loops, ...sideLoops]), wait(10_000)]);
sample();
const result = write(sims, true);
console.log(lines(result).join('\n'));
for (const p of proxies) p.close();
await engine?.stop();
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp folder */ }
process.exit(result.ok ? 0 : 1);
