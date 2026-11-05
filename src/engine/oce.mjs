// 3.7 (WS8): Open Control Edge (OCE) for the bots, read-only. OCE is the same author's Windows widget (WPF + sensors of
// LibreHardwareMonitor: Windows only, no Linux build); it shares its readings with Orb through the file bridge of
// engine/bridge.mjs (%LOCALAPPDATA%\OrbPuente\oce.json, every 2 s). Nothing here writes to OCE or changes the PC.
// - Here: localStatus() / localValues() read this machine (installed = its exe in C:\Program Files\OpenControlEdge;
//   open = a fresh oce.json). On any other system: «no disponible en este equipo».
// - Linked Orbs of the owner (link feature oce.v1) answer the link calls oce.status / oce.values with theirs (serve).
//   The engine keeps what they said in the setting oce_machines; a bot's MCP process (src/mcp/bot.mjs) reads it and asks
//   for a fresh reading through the setting oce_wanted (it has no link of its own).
// - Optimus: the first time OCE is found on this machine or on a linked Orb of the owner, ONE bot «Optimus» is made for
//   the owner (setting oce_optimus remembers it for ever: deleted, it is never made again). With several Orbs, the one
//   that makes it is the Orb Server if there is one, otherwise the lowest identity; an Orb that learns another made it
//   (or was told so) never makes its own. Off with oce.optimus: false («Crear Optimus automáticamente»).
// - Alerts: the limits the user gives Optimus (oce_alerts, bots/<id>/oce-umbrales.json, copied with the bot) are checked
//   here every minute by the bot's home: crossing one leaves a line in its chat (and a push), at most every 30 min.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ctx, tr, role } from '../core/context.mjs';
import { oneLine } from '../core/safety.mjs';
import { readOce, bridgeDir } from './oce-reading.mjs';

const FAKE = Boolean(process.env.ORB_FAKE_AGENTS);
// Tests: the fake agents read a made-up bridge (ORB_OCE_FAKE=1, any system) and a made-up install folder (ORB_OCE_DIR).
// Without that, an engine of the tests never looks at the real OCE of the PC that runs them.
export const oceSupported = () => (FAKE ? process.env.ORB_OCE_FAKE === '1' : process.platform === 'win32');
export const oceInstallDir = () => (FAKE && process.env.ORB_OCE_DIR) || path.join(process.env.ProgramFiles || 'C:\\Program Files', 'OpenControlEdge');
export const machineName = () => oneLine(String(ctx.config?.mobile?.name || os.hostname() || 'Orb'), 60);
const STATUS_MS = Number(FAKE && process.env.ORB_OCE_MS) || 60_000;
const ALERT_MS = Number(FAKE && process.env.ORB_OCE_ALERT_MS) || 60_000;
const ALERT_AGAIN_MS = Number(FAKE && process.env.ORB_OCE_ALERT_AGAIN_MS) || 30 * 60_000;
const CALL_MS = 8000;
export const OPTIMUS_KEY = 'oce_optimus';
export const MACHINES_KEY = 'oce_machines';
export const WANTED_KEY = 'oce_wanted';
export const THRESHOLDS_FILE = 'oce-umbrales.json';
export const ORIGIN_FILE = 'oce-origen.json';
const UIDS_KEY = 'oce_optimus_uids';
export const METRICS = ['cpuTemp', 'cpuLoad', 'gpuTemp', 'gpuLoad', 'ram', 'vram', 'ai'];
export const OPTIMUS_AVATAR = Object.freeze({ shape: 'estrella', color: 'cielo' });

const installed = () => { try { return fs.statSync(path.join(oceInstallDir(), 'OpenControlEdge.exe')).isFile(); } catch { return false; } };
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

// This machine. → { machine, here, available, installed, open, sharing, version, at, reason }
export function localStatus() {
  const base = { machine: machineName(), here: true, platform: process.platform };
  if (!oceSupported()) return { ...base, available: false, installed: false, open: false, reason: tr('sys.oce.notHere') };
  const sharing = ctx.config?.oce?.share !== false;
  const reading = sharing ? readOce() : null;
  // An oce.json (even an old one) means OCE ran here: a copy unzipped elsewhere counts as installed too.
  const isInstalled = installed() || Boolean(reading) || exists(path.join(bridgeDir(), 'oce.json'));
  const out = { ...base, available: true, installed: isInstalled, open: Boolean(reading), sharing, version: reading?.version || null, at: reading?.at ?? null };
  if (!sharing) return { ...out, reason: tr('sys.oce.sharingOff') };
  if (!isInstalled) return { ...out, reason: tr('sys.oce.notInstalled') };
  if (!reading) return { ...out, reason: tr('sys.oce.closed') };
  return out;
}
// This machine's readings (only real ones: null = OCE could not read it). → status + { values } or status with reason
export function localValues() {
  const s = localStatus();
  if (!s.open) return { ...s, values: null };
  const d = readOce();
  if (!d) return { ...s, open: false, values: null, reason: tr('sys.oce.closed') };
  const vramPct = d.gpu?.vramUsedMb != null && d.gpu?.vramTotalMb ? Math.round((d.gpu.vramUsedMb / d.gpu.vramTotalMb) * 1000) / 10 : null;
  return { ...s, at: d.at, values: { cpu: d.cpu, gpu: d.gpu ? { ...d.gpu, vramUsedPct: vramPct } : null, ramUsedPct: d.ramUsedPct, fps: d.fps, aiUsage: d.usage } };
}

// One number of a reading for a limit (metric of METRICS; provider for «ai»: claude, codex…; none = the highest).
export function metricOf(values, metric, provider = null) {
  if (!values) return null;
  switch (metric) {
    case 'cpuTemp': return values.cpu?.tempC ?? null;
    case 'cpuLoad': return values.cpu?.loadPct ?? null;
    case 'gpuTemp': return values.gpu?.tempC ?? null;
    case 'gpuLoad': return values.gpu?.loadPct ?? null;
    case 'ram': return values.ramUsedPct ?? null;
    case 'vram': return values.gpu?.vramUsedPct ?? null;
    case 'ai': {
      const list = (values.aiUsage ?? []).filter((u) => u.usedPct != null && (!provider || u.provider === provider));
      return list.length ? Math.max(...list.map((u) => u.usedPct)) : null;
    }
    default: return null;
  }
}

// ---- a bot's limits (bots/<id>/oce-umbrales.json: in its folder, so a move or a copy takes them along)
export function checkThresholds(list) {
  if (!Array.isArray(list) || list.length > 20) throw Object.assign(new Error(tr('sys.oce.badThresholds')), { userFacing: true });
  return list.map((r) => {
    const above = Number(r?.above);
    if (!r || !METRICS.includes(r.metric) || !Number.isFinite(above) || above < 0 || above > 1000) throw Object.assign(new Error(tr('sys.oce.badThresholds')), { userFacing: true });
    return { metric: r.metric, above: Math.round(above * 10) / 10, machine: r.machine ? oneLine(String(r.machine), 60) : null, ...(r.metric === 'ai' && r.provider ? { provider: oneLine(String(r.provider), 20).toLowerCase() } : {}) };
  });
}
const thresholdsFile = (botId) => path.join(ctx.paths?.bots ?? path.join(ctx.home, 'bots'), String(Number(botId)), THRESHOLDS_FILE);
export function readThresholds(botId) { try { return checkThresholds(JSON.parse(fs.readFileSync(thresholdsFile(botId), 'utf8')).rules ?? []); } catch { return []; } }
export function writeThresholds(botId, list) {
  const rules = checkThresholds(list); const file = thresholdsFile(botId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ rules }, null, 2)); fs.renameSync(`${file}.tmp`, file);
  return rules;
}

// Which Orb makes Optimus among the ones that can (each { key, server }): an Orb Server if there is one, otherwise the
// lowest identity. Every Orb works it out the same way, so two of them at the same moment never both make one.
export function creatorKey(candidates) {
  const list = candidates.filter((c) => c?.key);
  const pool = list.some((c) => c.server) ? list.filter((c) => c.server) : list;
  return pool.map((c) => String(c.key)).sort()[0] ?? null;
}

// ---- the engine's side
export function createOce({ board, bots, log = () => {}, link: getLink = () => null, remote: getRemote = () => null, replica: getReplica = () => null, product = () => ctx.product ?? process.env.ORB_PRODUCT ?? 'app' }) {
  let R = null; let LP = null; let B = null; let A = null;
  const ready = (async () => {
    R = await import('../core/replica.mjs'); LP = await import('../core/link-persons.mjs'); B = await import('../core/bots.mjs'); A = await import('../core/authz.mjs');
  })();
  const self = () => R.selfId(board);
  const owner = () => A.ownerOfBoard(board) ?? board.ownerId();
  const selfServer = () => product() === 'server' || role() === 'centro';
  const timeout = (p) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('sin respuesta'), { offline: true })), CALL_MS).unref?.())]);

  // The owner's linked Orbs (one per identity; a copy of another Orb is never asked).
  function peers() {
    const out = new Map();
    for (const p of getLink()?.peers?.() ?? []) {
      if (p.revoked || p.clone || !p.orb) continue;
      out.set(p.orb, { key: p.orb, name: p.name, online: Boolean(p.online), person: p.person ?? null, features: p.remote?.features ?? [], role: p.role ?? null, call: (method, params) => getLink().op(p.id, 'replica', { method, params }) });
    }
    for (const d of getRemote()?.orbPeers?.() ?? []) {
      if (!d.key) continue;
      const have = out.get(d.key);
      if (have && (have.online || !d.online)) continue;
      out.set(d.key, { ...d, call: (method, params) => getRemote().callOrb(d.id, method, params) });
    }
    return [...out.values()].filter((p) => LP.linkPerson(board, p) === owner());
  }
  const capable = (p) => (p.features ?? []).includes('oce.v1');
  const isServer = (p) => (p.features ?? []).includes('server') || p.role === 'centro';

  // What this Orb tells a linked Orb of the owner (a link call; nobody else is answered).
  async function serve(raw, method) {
    await ready;
    const peer = { ...raw, key: raw?.key ?? raw?.orb ?? null };
    if (LP.linkPerson(board, peer) !== owner()) throw Object.assign(new Error(tr('msg.authz.denied')), { status: 403 });
    if (method === 'oce.status') {
      const flag = board.settingJson(OPTIMUS_KEY);
      return { ...localStatus(), server: selfServer(), autoCreate: ctx.config?.oce?.optimus !== false, optimus: flag ? { known: true, uid: flag.uid ?? null, uids: optimusUids() } : { known: false } };
    }
    if (method === 'oce.values') return localValues();
    throw Object.assign(new Error('operación desconocida'), { status: 404 });
  }

  // ---- what the linked Orbs say (kept for the bots' MCP processes)
  const machines = () => board.settingJson(MACHINES_KEY)?.list ?? [];
  const save = (list) => board.settingJson(MACHINES_KEY, { at: new Date().toISOString(), list });
  async function poll({ values = false } = {}) {
    const known = new Map(machines().map((m) => [m.key, m]));
    const fresh = [];
    await Promise.all(peers().map(async (p) => {
      const was = known.get(p.key) ?? {};
      const entry = { ...was, key: p.key, name: p.name, online: p.online, capable: capable(p), server: isServer(p) };
      if (p.online && entry.capable) {
        try {
          entry.status = await timeout(p.call('oce.status', {})); entry.statusAt = new Date().toISOString(); entry.error = null;
          if (values) { entry.values = await timeout(p.call('oce.values', {})); entry.valuesAt = new Date().toISOString(); }
          fresh.push(entry);
        } catch (error) { entry.error = oneLine(error.message, 200); if (error.offline || error.status === 0) entry.online = false; }
      }
      known.set(p.key, entry);
    }));
    const now = peers(); const list = [...known.values()].filter((m) => now.some((p) => p.key === m.key));
    if (list.length || machines().length) save(list);
    return { list, fresh };
  }

  // ---- Optimus, once
  // Every Optimus this Orb knows of (its own and the ones the linked Orbs said they made): the ones kept to one.
  const optimusUids = () => [...new Set([...(board.settingJson(UIDS_KEY) ?? []), board.settingJson(OPTIMUS_KEY)?.uid].filter(Boolean))].slice(0, 20);
  const addUids = (list) => { const all = new Set(optimusUids()); for (const u of list ?? []) if (R.isUid(String(u ?? ''))) all.add(String(u)); board.settingJson(UIDS_KEY, [...all].slice(0, 20)); };
  function markKnown(uid, by) { if (uid) addUids([uid]); if (!board.settingJson(OPTIMUS_KEY)) board.settingJson(OPTIMUS_KEY, { uid: uid ?? null, by, at: new Date().toISOString() }); }
  function optimusCheck(fresh) {
    for (const m of fresh) addUids([m.status?.optimus?.uid, ...(m.status?.optimus?.uids ?? [])]);
    if (board.settingJson(OPTIMUS_KEY)) return null;
    // A bot with these tools already here (one of this Orb or the copy of one run elsewhere) is the one.
    const have = board.all('SELECT uid, tools FROM bots').find((b) => { try { return JSON.parse(b.tools || '[]').includes('oce'); } catch { return false; } });
    if (have) { markKnown(have.uid, 'existing'); return null; }
    const told = fresh.find((m) => m.status?.optimus?.known);
    if (told) { markKnown(told.status.optimus.uid, told.key); return null; }
    if (ctx.config?.oce?.optimus === false || fresh.some((m) => m.status?.autoCreate === false)) return null;
    const here = localStatus();
    const found = here.installed || here.open || fresh.some((m) => m.status?.installed || m.status?.open);
    if (!found) return null;
    const me = self();
    if (creatorKey([{ key: me, server: selfServer() }, ...fresh.map((m) => ({ key: m.key, server: Boolean(m.status?.server ?? m.server) }))]) !== me) return null;
    return createOptimus();
  }
  function createOptimus() {
    const person = owner();
    const taken = new Set(B.listBots(board, { person }).map((b) => b.name.toLowerCase()));
    let name = 'Optimus'; for (let i = 2; taken.has(name.toLowerCase()); i++) name = `Optimus ${i}`;
    const bot = B.createBot(board, { name, icon: '🌡️', avatar: { ...OPTIMUS_AVATAR }, role_text: tr('sys.oce.optimusRole'), tools: ['oce', 'recordatorios'], effort: 'low' }, { person });
    markKnown(bot.uid, 'here');
    // Where it was born, in its own folder (it travels with the bot): if two are kept to one, both PCs are named.
    try { fs.writeFileSync(originFile(bot.id), JSON.stringify({ sources: [{ key: self(), machine: machineName() }] })); } catch { /* best effort */ }
    try {
      const conv = B.botConversation(board, bot, { person });
      if (bots) bots.say('bot', tr('sys.oce.optimusHello', { name }), bots.botMeta(bot), conv, { notify: [person] });
      else board.addChat('bot', tr('sys.oce.optimusHello', { name }), { bot: bot.id, name: bot.name, icon: bot.icon }, conv);
      bots?.updated(bot.id);
    } catch (error) { log(`optimus: ${error.message}`); }
    log(`Open Control Edge encontrado: bot ${name} creado (${bot.uid})`);
    return bot;
  }

  // ---- ONE Optimus: two made by Orbs that were not linked yet (each found OCE alone) become one once they see each other.
  // Kept: the one whose home is the Orb Server, else the older (then the lower uid): every Orb picks the same. The home of
  // the other one moves it to the kept one's home (bots.move of WS3); there, bots.merge keeps the survivor, the other's
  // memory goes as pending proposals and it is archived with its chat; the survivor names both PCs as its sources.
  const originFile = (id) => path.join(ctx.paths?.bots ?? path.join(ctx.home, 'bots'), String(Number(id)), ORIGIN_FILE);
  const sourcesOf = (id) => { try { return JSON.parse(fs.readFileSync(originFile(id), 'utf8')).sources ?? []; } catch { return []; } };
  const tried = new Map();
  async function dedupe() {
    const rep = getReplica(); if (!rep) return;
    const uids = new Set(optimusUids());
    const rows = board.all("SELECT * FROM bots WHERE uid IS NOT NULL AND (home_state IS NULL OR home_state IN ('active', 'moving'))").filter((r) => uids.has(r.uid));
    if (rows.length < 2) return;
    const servers = new Set(peers().filter(isServer).map((p) => p.key)); if (selfServer()) servers.add(self());
    const rank = (r) => `${servers.has(r.home) ? 0 : 1}|${r.created_at ?? ''}|${r.uid}`;
    rows.sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
    const keep = rows[0];
    for (const other of rows.slice(1)) {
      if (!R.isHomeHere(board, other) || other.home_state === 'moving') continue;
      if (R.isHomeHere(board, keep)) {
        const all = [...sourcesOf(keep.id), ...sourcesOf(other.id)].filter((x, i, l) => x?.key && l.findIndex((y) => y.key === x.key) === i);
        const r = rep.merge(keep.id, other.id);
        try { fs.writeFileSync(originFile(keep.id), JSON.stringify({ sources: all })); } catch { /* best effort */ }
        const row = B.getBot(board, keep.id); const person = B.botPerson(board, row) ?? owner();
        const body = tr('sys.oce.merged', { name: row.name, machines: all.map((x) => x.machine).join(', ') || machineName() });
        const conv = B.botConversation(board, row, { person });
        if (bots) bots.say('system', body, { bot: row.id, kind: 'oce_merged', sources: all }, conv, { notify: [person] });
        else board.addChat('system', body, { bot: row.id, kind: 'oce_merged', sources: all }, conv);
        log(`optimus: ${other.uid} unido a ${keep.uid} (${r.proposals} propuestas de memoria)`);
        continue;
      }
      // Its home is elsewhere: this one goes there first (once a minute at most while it fails).
      if (Date.now() - (tried.get(other.uid) ?? 0) < 60_000) continue;
      const home = peers().find((p) => p.key === keep.home);
      if (!home?.online) continue;
      tried.set(other.uid, Date.now());
      try {
        let r = await rep.move(other.id, keep.home, { group: 'leave' });
        if (r?.step === 'brain' && r.brains?.length) r = await rep.move(other.id, keep.home, { group: 'leave', brain: { agent: r.brains[0], model: null } });
        log(`optimus: ${other.uid} pasa a ${home.name} para quedar uno solo: ${r?.ok ? 'hecho' : JSON.stringify(r).slice(0, 200)}`);
      } catch (error) { log(`optimus: no se pudo pasar ${other.uid}: ${error.message}`); }
    }
  }

  // ---- alerts of the bots run here
  async function alerts() {
    const list = board.all('SELECT * FROM bots WHERE paused = 0').filter((b) => { try { return JSON.parse(b.tools || '[]').includes('oce') && R.isHomeHere(board, b); } catch { return false; } });
    if (!list.length) return;
    let remoteValues = null;
    const valuesFor = async (machine) => {
      const local = localValues();
      if (!machine || sameMachine(machine, { name: local.machine, key: self() })) return [{ ...local, key: self() }];
      remoteValues ??= (await poll({ values: true })).list;
      const all = [{ ...local, key: self() }, ...remoteValues.filter((m) => m.values).map((m) => ({ ...m.values, machine: m.name, key: m.key }))];
      return machine === '*' ? all : all.filter((m) => sameMachine(machine, { name: m.machine, key: m.key }));
    };
    for (const bot of list) {
      const rules = readThresholds(bot.id); if (!rules.length) continue;
      const state = board.settingJson(`oce_alerted:${bot.uid}`) ?? {};
      let dirty = false;
      for (const r of rules) {
        for (const m of await valuesFor(r.machine ?? '*')) {
          const v = metricOf(m.values, r.metric, r.provider ?? null);
          const k = `${r.metric}:${r.provider ?? ''}:${r.above}:${m.key}`;
          if (v == null || v <= r.above) { if (state[k]) { delete state[k]; dirty = true; } continue; }
          if (state[k] && Date.now() - Date.parse(state[k]) < ALERT_AGAIN_MS) continue;
          state[k] = new Date().toISOString(); dirty = true;
          const row = B.getBot(board, bot.id); const person = B.botPerson(board, row) ?? owner();
          const what = tr(`sys.oce.metric.${r.metric}`) + (r.provider ? ` (${r.provider})` : '');
          const body = tr('sys.oce.alert', { what, machine: m.machine, value: v, above: r.above, unit: tr(r.metric.endsWith('Temp') ? 'sys.oce.unitC' : 'sys.oce.unitPct') });
          if (bots) bots.say('bot', body, bots.botMeta(row, { kind: 'oce_alert' }), B.botConversation(board, row, { person }), { notify: [person] });
          else board.addChat('bot', body, { bot: row.id, name: row.name, kind: 'oce_alert' }, B.botConversation(board, row, { person }));
        }
      }
      if (dirty) board.settingJson(`oce_alerted:${bot.uid}`, state);
    }
  }

  let timers = []; let busy = false; let lastWanted = 0; let lastStatus = 0; let lastAlert = Date.now();
  async function tick() {
    if (busy) return; busy = true;
    try {
      await ready;
      const wanted = Number(board.settingJson(WANTED_KEY)?.at) || 0;
      if (wanted > lastWanted) { lastWanted = wanted; lastStatus = Date.now(); const r = await poll({ values: true }); optimusCheck(r.fresh); }
      else if (Date.now() - lastStatus >= STATUS_MS) { lastStatus = Date.now(); const r = await poll(); optimusCheck(r.fresh); await dedupe(); }
      if (Date.now() - lastAlert >= ALERT_MS) { lastAlert = Date.now(); await alerts(); }
    } catch (error) { log(`open control edge: ${error.message}`); } finally { busy = false; }
  }
  return {
    serve, poll, tick, alerts, dedupe, optimusCheck: (fresh = []) => optimusCheck(fresh), peers,
    start() { lastStatus = Date.now() - STATUS_MS + Math.min(STATUS_MS, 3000); const t = setInterval(tick, 1000); t.unref?.(); timers.push(t); return this; },
    stop() { for (const t of timers) clearInterval(t); timers = []; }
  };
}

// A machine named by the user or the bot: its name or identity, without case; «este», «aquí», «local», «this» = here.
export function sameMachine(asked, m) {
  const a = String(asked ?? '').trim().toLowerCase();
  if (!a) return true;
  if (m.here && ['este', 'aquí', 'aqui', 'local', 'this', 'here', 'este equipo', 'this computer'].includes(a)) return true;
  return a === String(m.name ?? '').toLowerCase() || a === String(m.key ?? '').toLowerCase();
}
