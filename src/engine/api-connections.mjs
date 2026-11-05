// 3.7 (WS9): «Conexiones» (Ajustes › Magic Link › Conexiones, and the user menu): one list of everything connected to
// this Orb, each row with its state (online / offline / attention) and what can be done with it.
//   connections.list({ nested? }) → { rows: [row], self, at }
//   connections.close({ kind, id, at? })      kind: device | peer | tunnel | adb | browser
//   connections.reconnect({ kind, id, at? })  kind: peer | adb | vault
// row: { id, kind, source, ref, name, status, person, personName, lastSeen, detail, actions, where }
//   kind (what it is): server, orb, phone, browser, terminal, tunnel, adb, vault, tailscale, ha, agent, live
//   source (what close/reconnect take as kind): device, peer, tunnel, adb, browser, vault, agent, tailscale, ha
//   where: 'here' or 'server' (a row the user's Orb Server reported; its actions go there, at: 'server')
// Each person sees their own rows; the admin sees everyone's, but of other people only the name, the kind and the
// state (never addresses, pages or hosts).
// Nothing here spawns adb: the Android rows are the devices recorded the last time the user listed them
// (android.devices), and «Desconectar ADB» / «Reconectar» only appear while the adb of the user's own session runs.
// Tailscale is read with `tailscale status --json` only when its program is there (no prompts, no login).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { ctx, tr } from '../core/context.mjs';
import { fail, str, oneOf } from './api-common.mjs';
import { audit, ownerOfBoard, can } from '../core/authz.mjs';
import { accountsOf, loginState } from '../core/accounts.mjs';
import { accountPerson } from '../core/budget.mjs';
import { listPersons } from '../core/persons.mjs';
import { haConfig } from '../core/bots.mjs';
// adb's modules are the app's only (Orb Server's package leaves them out, and its engine never loads them): imported
// by name when an Android row needs them (the server's file list follows only literal imports).
const ANDROID_MODULE = './android.mjs';
const NETWORK_MODULE = '../core/network.mjs';
const android = () => import(ANDROID_MODULE);
const network = () => import(NETWORK_MODULE);

export const CLOSE_KINDS = ['device', 'peer', 'tunnel', 'adb', 'browser'];
export const RECONNECT_KINDS = ['peer', 'adb', 'vault'];
const SERVER_TIMEOUT_MS = 4000;
const TAILSCALE_CACHE_MS = 30_000;
const HA_CACHE_MS = 60_000;
const ADB_KEY = 'connections.adb';

// ---- what this module tracks itself
// The SSH sessions Orb opened (net.remote › ssh): a console of the user's own; closing it ends the session.
const tunnels = new Map(); // id -> { id, host, user, person, pid, at, child }
// «Something changed»: one event a moment later (several changes together make one).
let emitter = null; let changeTimer = null;
const changed = () => {
  if (!emitter) return;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => { changeTimer = null; try { emitter('connections:changed', {}); } catch { /* closing */ } }, 300);
  changeTimer.unref?.();
};
// spawnFn: the tests' stand-in (they never open a console).
export function sshOpen({ host, user, person = null }, { spawnFn = spawn } = {}) {
  const id = `ssh-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // A console of its own (visible: the user asked for it), so its pid is the session's and can be closed from here.
  const child = process.platform === 'win32'
    ? spawnFn('cmd.exe', ['/k', 'ssh', `${user}@${host}`], { detached: true, stdio: 'ignore', windowsHide: false })
    : spawnFn('ssh', [`${user}@${host}`], { detached: true, stdio: 'ignore' });
  const entry = { id, host, user, person, pid: child.pid ?? null, at: new Date().toISOString(), child };
  tunnels.set(id, entry);
  child.on('exit', () => { if (tunnels.delete(id)) changed(); });
  child.on('error', () => { if (tunnels.delete(id)) changed(); });
  child.unref();
  changed();
  return true;
}
function sshClose(entry) {
  tunnels.delete(entry.id);
  if (entry.pid) {
    if (process.platform === 'win32') spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(entry.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    else { try { process.kill(-entry.pid, 'SIGTERM'); } catch { try { process.kill(entry.pid, 'SIGTERM'); } catch { /* gone */ } } }
  }
  changed();
}

// The Android devices the user listed last (android.devices calls it): kept so Conexiones never has to ask adb.
export function noteAdbDevices(board, devices) {
  try {
    const list = (Array.isArray(devices) ? devices : []).filter((d) => d && d.wireless).slice(0, 20)
      .map((d) => ({ serial: String(d.serial).slice(0, 80), state: String(d.state ?? '').slice(0, 20), model: d.model ? String(d.model).slice(0, 60) : null }));
    board.settingJson(ADB_KEY, { at: new Date().toISOString(), devices: list });
    changed();
  } catch { /* only a cache */ }
}

// ---- Tailscale (only when its program is there; tests set ORB_FAKE_TAILSCALE instead)
const onPath = (name) => {
  for (const dir of String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const f = path.join(dir, name);
    try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ }
  }
  return null;
};
export const tailscaleExe = () => (process.platform === 'win32'
  ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe')].find((f) => fs.existsSync(f)) ?? null
  : onPath('tailscale') ?? ['/usr/bin/tailscale', '/usr/local/bin/tailscale'].find((f) => fs.existsSync(f)) ?? null);
let tsCache = { at: 0, value: null };
async function tailscaleState() {
  if (process.env.ORB_FAKE_AGENTS) { try { return process.env.ORB_FAKE_TAILSCALE ? JSON.parse(process.env.ORB_FAKE_TAILSCALE) : null; } catch { return null; } }
  if (Date.now() - tsCache.at < TAILSCALE_CACHE_MS) return tsCache.value;
  const exe = tailscaleExe();
  const value = !exe ? null : await new Promise((resolve) => {
    execFile(exe, ['status', '--json', '--peers=false'], { windowsHide: true, timeout: 6000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      try { resolve(JSON.parse(String(stdout ?? ''))); } catch { resolve(error ? { BackendState: 'Unavailable' } : null); }
    });
  });
  tsCache = { at: Date.now(), value };
  return value;
}

// ---- Home Assistant: a light look at its API with the token (cached a minute; never in tests)
let haCache = { at: 0, key: '', value: null };
async function haState(board) {
  const { url, token } = haConfig(board);
  if (!url) return null;
  if (!token) return { url, state: 'noToken' };
  if (process.env.ORB_FAKE_AGENTS) return { url, state: process.env.ORB_FAKE_HA ?? 'unknown' };
  if (haCache.key === url && Date.now() - haCache.at < HA_CACHE_MS) return haCache.value;
  let state = 'offline';
  try {
    const r = await fetch(`${url}/api/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
    state = r.ok ? 'online' : r.status === 401 || r.status === 403 ? 'badToken' : 'offline';
  } catch { state = 'offline'; }
  haCache = { at: Date.now(), key: url, value: { url, state } };
  return haCache.value;
}

const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); t.unref?.(); })]);
const ORDER = ['server', 'orb', 'phone', 'browser', 'terminal', 'tunnel', 'adb', 'vault', 'tailscale', 'ha', 'agent', 'live'];
const STATUS_ORDER = { attention: 0, online: 1, offline: 2 };

// Events: a list changed (no content: each screen asks again with its own rights). The router's sink watches the links'
// own events so the screen follows them.
const WATCHED = /^(link:(devices|peers|status)|agents:login|bot\.home)$/;
export function connectionsSink(emit) {
  emitter = emit;
  return (event, payload) => {
    if (event === 'connections:changed') return;
    if (WATCHED.test(event) || (event === 'browser:live' && payload?.state === 'stopped')) changed();
  };
}

export function connectionMethods({ board, emit, remoteRef, version = null }) {
  emitter ??= emit;
  const owner = () => ownerOfBoard(board);
  const isAdmin = (who) => !who || who.channel === 'system' || who.role === 'owner';
  const meOf = (who) => (who && who.channel !== 'system' && who.person ? who.person : owner());
  const nameOf = (pid) => { try { return pid ? board.personName(pid) : null; } catch { return null; } };
  const row = (o) => ({ id: `${o.source}:${o.ref}`, status: 'offline', person: owner(), lastSeen: null, detail: {}, actions: [], where: 'here', ...o, ref: String(o.ref) });
  const remote = () => remoteRef?.current ?? null;
  const link = () => remoteRef?.link ?? null;
  const serverPeer = () => (link()?.peers?.() ?? []).find((p) => p.server && !p.revoked) ?? null;

  function self() {
    return { version, product: ctx.product ?? null, platform: process.platform,
      memory: { total: os.totalmem(), free: os.freemem(), rss: process.memoryUsage().rss } };
  }

  async function localRows(who) {
    const rows = [];
    const admin = isAdmin(who);
    // Linked devices (they linked to this Orb): phones, tablets, browsers, terminals and other PCs with Orb.
    for (const d of remote()?.devices?.() ?? []) {
      const attention = d.confirmed === false || d.devPending;
      rows.push(row({ source: 'device', ref: d.id, kind: d.kind === 'orb' ? 'orb' : ['phone', 'browser', 'terminal'].includes(d.kind) ? d.kind : 'phone', name: d.name,
        status: attention ? 'attention' : d.online ? 'online' : 'offline', person: d.person ?? owner(), lastSeen: d.lastSeen ?? null,
        detail: { ip: d.ip ?? null, host: d.host ?? null, version: d.version ?? null, role: d.role ?? null, ...(attention ? { why: d.confirmed === false ? 'unconfirmed' : 'devPending' } : {}) },
        actions: ['revoke'] }));
    }
    // Orbs this one linked to (the user's Orb Server among them).
    let skew = null;
    try { skew = remoteRef?.hub?.status?.().skew ?? null; } catch { /* no hub */ }
    for (const p of link()?.peers?.() ?? []) {
      const server = Boolean(p.server);
      const attention = p.clone || (server && skew);
      rows.push(row({ source: 'peer', ref: p.id, kind: server ? 'server' : 'orb', name: p.name,
        status: p.revoked ? 'offline' : attention ? 'attention' : p.online ? 'online' : 'offline', person: p.person ?? owner(), lastSeen: p.lastSeen ?? null,
        detail: { version: p.remote?.version ?? null, url: p.url ?? null, revoked: Boolean(p.revoked), ...(p.clone ? { why: 'clone' } : server && skew ? { why: 'skew', message: skew.message ?? null } : {}) },
        actions: p.revoked ? ['disconnect'] : p.online ? ['disconnect'] : ['reconnect', 'disconnect'] }));
    }
    // The SSH sessions Orb opened.
    for (const t of tunnels.values()) {
      rows.push(row({ source: 'tunnel', ref: t.id, kind: 'tunnel', name: `${t.user}@${t.host}`, status: 'online', person: t.person ?? owner(), lastSeen: t.at, detail: { host: t.host, user: t.user, since: t.at }, actions: ['closeTunnel'] }));
    }
    // The bots' browser on Orb Server: the live views open now.
    for (const l of ctx.serverBrowser?.live?.list?.() ?? []) {
      rows.push(row({ source: 'browser', ref: l.sid, kind: 'live', name: hostOf(l.url) || tr('conn.liveName'), status: 'online', person: l.person ?? owner(), detail: { url: l.url ?? null, device: l.device ?? null }, actions: ['closeBrowser'] }));
    }
    // The password vault (Orb Server): each person's own account.
    if (ctx.vault) {
      const persons = admin ? listPersons(board).map((p) => p.id) : [meOf(who)];
      for (const pid of persons) {
        let st = null;
        try { if (!ctx.vault.configured(pid)) continue; st = await withTimeout(ctx.vault.status(pid), 3000); } catch (error) { st = { error: error?.code ?? 'error' }; }
        const bad = Boolean(st?.error || st?.locked === true);
        rows.push(row({ source: 'vault', ref: pid, kind: 'vault', name: tr('conn.vaultName'), status: bad ? 'attention' : 'online', person: pid, lastSeen: st?.syncedAt ?? null,
          detail: { server: st?.server ? hostOf(st.server) || String(st.server).slice(0, 80) : null, items: st?.items ?? null, ...(bad ? { why: 'vault' } : {}) }, actions: ['reconnect'] }));
      }
    }
    // The agents' accounts signed in on this Orb (Claude and Codex).
    for (const agent of ['claude', 'codex']) {
      if (ctx.config.agents?.[agent]?.enabled === false) continue;
      for (const acc of accountsOf(agent)) {
        if (acc.enabled === false) continue;
        let login = 'desconocido'; try { login = loginState(acc); } catch { /* unknown */ }
        rows.push(row({ source: 'agent', ref: acc.id, kind: 'agent', name: acc.label ?? acc.id, status: login === 'si' ? 'online' : login === 'no' ? 'attention' : 'offline', person: accountPerson(board, acc) ?? owner(),
          detail: { agent, login, ...(login === 'no' ? { why: 'signedOut' } : {}) }, actions: login === 'si' ? [] : ['reconnect'] }));
      }
    }
    // What belongs to the machine (the admin's; no person): Android over Wi-Fi, Tailscale, Home Assistant.
    if (admin) {
      const cache = board.settingJson(ADB_KEY);
      const running = cache?.devices?.length ? (await android()).adbInUse() : false;
      for (const d of cache?.devices ?? []) {
        const on = running && d.state === 'device';
        rows.push(row({ source: 'adb', ref: d.serial, kind: 'adb', name: d.model || d.serial, person: null, status: d.state === 'unauthorized' ? 'attention' : on ? 'online' : 'offline', lastSeen: cache.at,
          detail: { serial: d.serial, state: d.state, cached: !running, ...(d.state === 'unauthorized' ? { why: 'unauthorized' } : {}) },
          actions: running ? (d.state === 'device' ? ['disconnectAdb'] : ['reconnect']) : [] }));
      }
      const ts = await tailscaleState().catch(() => null);
      if (ts) {
        const state = String(ts.BackendState ?? '');
        const s = ts.Self ?? {};
        rows.push(row({ source: 'tailscale', ref: 'self', kind: 'tailscale', name: 'Tailscale', person: null, status: state === 'Running' ? 'online' : /^Needs/.test(state) ? 'attention' : 'offline',
          detail: { state, dns: s.DNSName ? String(s.DNSName).replace(/\.$/, '') : null, ip: (s.TailscaleIPs ?? [])[0] ?? null, ...(/^Needs/.test(state) ? { why: 'tailscaleLogin' } : {}) } }));
      }
    }
    if (admin || can(board, who, 'view', { type: 'integration', id: 'ha' })) {
      const ha = await haState(board).catch(() => null);
      if (ha) {
        rows.push(row({ source: 'ha', ref: 'self', kind: 'ha', name: 'Home Assistant', person: null, status: ha.state === 'online' ? 'online' : ['noToken', 'badToken'].includes(ha.state) ? 'attention' : 'offline',
          detail: { host: hostOf(ha.url) || null, ...(['noToken', 'badToken'].includes(ha.state) ? { why: ha.state } : {}) } }));
      }
    }
    return rows;
  }

  // What the user's Orb Server reports of itself (its RAM and version, its phones, vault, live views, accounts), for
  // the admin only (the link to the Server is the admin's). Older Servers or an offline one: just the peer row.
  async function serverRows() {
    const p = serverPeer();
    if (!p?.online) return { rows: [], self: null };
    try {
      const r = await withTimeout(link().call(p.id, 'connections.list', { nested: true }), SERVER_TIMEOUT_MS);
      const rows = (Array.isArray(r?.rows) ? r.rows : []).filter((x) => x && !['orb', 'server'].includes(x.kind)).slice(0, 200)
        .map((x) => ({ ...x, id: `server:${x.id}`, where: 'server', person: null, personName: x.personName ?? null }));
      return { rows, self: r?.self ?? null };
    } catch { return { rows: [], self: null }; }
  }

  // Who sees what: their own rows; the admin everyone's, of the others only name, kind and state.
  function shape(rows, who) {
    const me = meOf(who);
    const admin = isAdmin(who);
    return rows.filter((r) => admin || r.person === me).map((r) => {
      const mine = r.person === me || r.where === 'server' || r.person == null;
      const out = { ...r, personName: r.personName ?? nameOf(r.person) };
      if (!mine) { out.detail = r.detail?.why ? { why: r.detail.why } : {}; }
      return out;
    }).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || String(a.name).localeCompare(String(b.name)));
  }

  const mine = (r, who) => isAdmin(who) || r.person === meOf(who);
  const deny = (who, method, what) => { audit(board, who, method, { type: 'person', id: meOf(who) }, 'deny', what); fail(tr('conn.notYours')); };
  const find = async (source, ref, who) => (await localRows(who)).find((r) => r.source === source && r.ref === ref) ?? null;

  async function onServer(method, params, who) {
    if (!isAdmin(who)) deny(who, method, 'server');
    const p = serverPeer();
    if (!p) fail(tr('conn.noServer'));
    if (!p.online || !link()) fail(tr('conn.serverOffline', { name: p.name }));
    let out;
    // 3.7: the Server going away in the middle of the call: the same plain words as when it was already offline.
    try { out = await link().call(p.id, method, params); }
    catch (error) { if (error?.offline || error?.status === 0) fail(tr('conn.serverOffline', { name: p.name })); throw error; }
    changed();
    return out;
  }

  return {
    'connections.list': async ({ nested } = {}, who) => {
      const here = await localRows(who);
      let me = self();
      let rows = here;
      if (nested !== true && isAdmin(who)) {
        const s = await serverRows();
        rows = [...here, ...s.rows];
        if (s.self) {
          const sp = serverPeer();
          rows = rows.map((r) => (r.source === 'peer' && sp && r.ref === sp.id ? { ...r, detail: { ...r.detail, version: s.self.version ?? r.detail.version, memory: s.self.memory ?? null } } : r));
        }
      }
      if (!isAdmin(who)) me = { version };
      return { rows: shape(rows, who), self: me, at: new Date().toISOString() };
    },
    'connections.close': async ({ kind, id, at }, who) => {
      const source = oneOf(kind, CLOSE_KINDS, 'tipo');
      const ref = str(id, 'conexión', 120);
      if (at === 'server') return onServer('connections.close', { kind: source, id: ref }, who);
      const r = await find(source, ref, who);
      if (!r) fail(tr('conn.gone'));
      if (!mine(r, who)) deny(who, 'connections.close', source);
      let out = true;
      if (source === 'device') out = remote().revoke(ref);
      else if (source === 'peer') { if (!link()) fail(tr('msg.link.unavailable')); out = await link().disconnect(ref); }
      else if (source === 'tunnel') { const t = tunnels.get(ref); if (t) sshClose(t); }
      else if (source === 'adb') {
        const A = await android();
        if (A.adbDisabled()) fail(tr('msg.android.off'));
        if (!A.adbInUse()) fail(tr('conn.adbNotRunning'));
        out = await (await network()).adbDisconnect(A.adbPath(), ref);
        const cache = board.settingJson(ADB_KEY);
        if (cache) noteAdbDevices(board, cache.devices.map((d) => (d.serial === ref ? { ...d, state: 'offline', wireless: true } : { ...d, wireless: true })));
      } else if (source === 'browser') {
        const l = (ctx.serverBrowser?.live?.list?.() ?? []).find((x) => x.sid === ref);
        if (l) await ctx.serverBrowser.live.stop(ref, { person: l.person, device: l.device });
      }
      audit(board, who, 'connections.close', { type: 'person', id: r.person }, 'allow', `${source}:${r.name}`.slice(0, 120));
      changed();
      return out ?? true;
    },
    'connections.reconnect': async ({ kind, id, at }, who) => {
      const source = oneOf(kind, RECONNECT_KINDS, 'tipo');
      const ref = str(id, 'conexión', 120);
      if (at === 'server') return onServer('connections.reconnect', { kind: source, id: ref }, who);
      const r = await find(source, ref, who);
      if (!r) fail(tr('conn.gone'));
      if (!mine(r, who)) deny(who, 'connections.reconnect', source);
      let out = true;
      if (source === 'peer') { if (!link()?.retry) fail(tr('msg.link.unavailable')); out = link().retry(ref); }
      else if (source === 'adb') {
        const A = await android();
        if (A.adbDisabled()) fail(tr('msg.android.off'));
        if (!A.adbInUse()) fail(tr('conn.adbNotRunning'));
        if (!/^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(ref)) fail(tr('conn.adbNoAddress'));
        out = await (await network()).adbConnect(A.adbPath(), ref);
        const cache = board.settingJson(ADB_KEY);
        if (cache && out?.ok) noteAdbDevices(board, cache.devices.map((d) => ({ ...d, wireless: true, ...(d.serial === ref ? { state: 'device' } : {}) })));
      } else if (source === 'vault') {
        if (!ctx.vault) fail(tr('msg.vault.err.vault_off'));
        out = await ctx.vault.test(ref);
      }
      changed();
      return out ?? true;
    }
  };
}
