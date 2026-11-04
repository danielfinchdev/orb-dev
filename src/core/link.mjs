// Magic Link (3.5) in Node: the same protocol as the phone's page (src/ui/lib/web-bridge.js), so an Orb can link to
// another Orb (the laptop «taller» to the server «centro») or a script can act as a phone.
//
// - Linking: the QR of the other Orb (an URL whose fragment carries its key and a one-time code, protocol v2) or the short
//   code typed by hand plus its address. This side makes its own X25519 key and proves it read the code without sending it.
// - Every request afterwards is sealed (XChaCha20-Poly1305, src/core/mobile-crypto.mjs) and refused if replayed.
// - Live events over a streamed GET /api/events, reconnected with a growing pause (1 s … 30 s).
// - The keys of every link are kept in <home>/.orb/datos/enlaces.json, sealed with a key derived from the app's secret.
// - An Orb that programs («taller» or «todo») linked to one that keeps bots («centro» or «todo») runs the calls that one
//   forwards to it for its phones (onRequest) and sends it its live events (it keeps them only if it is its «Orb para
//   programar»).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nodeCrypto from 'node:crypto';
import * as C from './mobile-crypto.mjs';
// The same as home.mjs › hostsBots / doesDev (not imported: the terminal client ships this file without home.mjs).
const hostsBots = (role) => role !== 'taller';
const doesDev = (role) => role !== 'centro';

export const PROTOCOL = 2;
// Live events of a workshop the centre passes on to its phones (the same ones a phone gets from its own PC).
export const RELAY_EVENTS = new Set(['board:changed', 'chat:state', 'chat:new', 'notice', 'session:item', 'session:update', 'session:removed', 'config:changed', 'session:delta', 'session:queue', 'approval:changed']);
// The short code typed by hand: 8 letters and digits that cannot be confused (no 0/O, 1/I/L, U).
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const normalCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
export const shortCodeLabel = (code) => normalCode(code).replace(/(.{4})(?=.)/g, '$1-');

const err = (message, extra = {}) => Object.assign(new Error(message), extra);

// The base URL of an address typed by hand: «100.64.1.2:3131», «casa.tail.ts.net:3131», «http://…» or «https://…».
export function normalAddress(address) {
  let a = String(address ?? '').trim();
  if (!a) throw err('falta la dirección del otro Orb');
  if (!/^https?:\/\//i.test(a)) a = `http://${a}`;
  let u; try { u = new URL(a); } catch { throw err('la dirección no es válida'); }
  if (!u.port && u.protocol === 'http:') u.port = '3131';
  return `${u.protocol}//${u.host}`;
}

// What a QR carries (v2: «http://ip:port/#vincular=<code>&pc=<key>&v=2&n=<name>&r=<role>&a=<other addresses>»; v1 had
// only the code and the key). Also accepts the same as an object or JSON ({ v, urls, pc, code, name, role }).
export function parseQr(input) {
  let q = input;
  if (typeof q === 'string' && q.trim().startsWith('{')) { try { q = JSON.parse(q); } catch { throw err('el QR no es válido'); } }
  if (q && typeof q === 'object') {
    const urls = (Array.isArray(q.urls) ? q.urls : [q.url]).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)).map((u) => normalAddress(u));
    if (!urls.length || typeof q.pc !== 'string' || typeof q.code !== 'string') throw err('el QR no es válido');
    return { v: Number(q.v ?? 2), urls, pc: q.pc, code: q.code, name: q.name ?? null, role: q.role ?? null };
  }
  let u; try { u = new URL(String(q ?? '').trim()); } catch { throw err('el QR no es válido'); }
  const h = new URLSearchParams(u.hash.slice(1));
  const code = h.get('vincular'); const pc = h.get('pc');
  if (!code || !pc) throw err('el QR no es válido');
  const others = (h.get('a') ?? '').split(',').filter((x) => /^https?:\/\//.test(x));
  const urls = [...new Set([`${u.protocol}//${u.host}`, ...others.map((x) => normalAddress(x))])];
  return { v: Number(h.get('v') ?? 1), urls, pc, code, name: h.get('n'), role: h.get('r') };
}

// The other Orb's public data (for the short code, which does not carry its key): GET /api/hello.
export async function hello(address, { fetch: f = globalThis.fetch } = {}) {
  const base = normalAddress(address);
  const res = await f(`${base}/api/hello`, { credentials: 'omit' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.pc !== 'string') throw err(data.error ?? `el otro Orb no responde (${res.status})`);
  return { ...data, base };
}

const storeKey = (secret) => new Uint8Array(nodeCrypto.createHmac('sha256', Buffer.from(secret)).update('orb-enlaces-v1').digest());

export function createLink({ file, secret, identity = () => ({}), onRequest = null, onChange = () => {}, log = () => {}, fetch: f = globalThis.fetch } = {}) {
  if (!file || !secret) throw new Error('createLink: falta el archivo o la clave');
  const peers = new Map(); // id -> { rec, key, skew, ctrl, online, wait, at }
  const listeners = new Map();
  let started = false;
  let outbox = []; let flushTimer = null; // events waiting to go to the centre

  const fire = (event, payload, peer) => {
    for (const fn of listeners.get(event) ?? []) { try { fn(payload, peer); } catch (e) { log(`enlace: ${e.message}`); } }
    for (const fn of listeners.get('*') ?? []) { try { fn(event, payload, peer); } catch (e) { log(`enlace: ${e.message}`); } }
  };
  const view = (p) => ({ id: p.rec.id, name: p.rec.name, role: p.rec.role ?? null, fp: p.rec.fp ?? null, url: p.rec.urls[p.rec.at ?? 0] ?? p.rec.urls[0], urls: p.rec.urls,
    online: Boolean(p.online), revoked: Boolean(p.rec.revoked), linkedAt: p.rec.linkedAt, lastSeen: p.rec.lastSeen ?? null });
  const changed = () => { try { onChange(list()); } catch { /* listener */ } fire('link:peers', list()); };
  const list = () => [...peers.values()].map(view);

  // ---- storage
  function load() {
    peers.clear();
    let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    let data; try { data = C.open(storeKey(secret), raw.box, 'orb:enlaces'); } catch { log('enlace: no se pudo abrir enlaces.json (¿otra clave?)'); return; }
    for (const rec of data?.peers ?? []) {
      if (!rec?.id || !rec.priv || !rec.pc || !Array.isArray(rec.urls)) continue;
      peers.set(rec.id, { rec, key: C.sessionKey(C.b64.dec(rec.priv), C.b64.dec(rec.pc)), skew: 0, online: false, wait: 1000 });
    }
  }
  function save() {
    const box = C.seal(storeKey(secret), { v: 1, peers: [...peers.values()].map((p) => p.rec) }, 'orb:enlaces');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, box }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  // ---- requests
  const baseOf = (p) => p.rec.urls[p.rec.at ?? 0] ?? p.rec.urls[0];
  const stamp = (p) => Date.now() + (p.skew ?? 0);
  const clockFixed = async (p, res) => {
    if (res.status !== 409) return false;
    const d = await res.clone().json().catch(() => ({}));
    if (!Number.isFinite(d.now)) return false;
    p.skew = d.now - Date.now(); return true;
  };
  const box = (p, kind, body) => C.seal(p.key, { t: stamp(p), m: kind, b: body }, C.AAD.request(p.rec.id));
  const postBox = (p, pathname, b) => f(`${baseOf(p)}${pathname}`, { method: 'POST', credentials: 'omit', headers: { 'X-Orb-Device': p.rec.id, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  function revoked(p) {
    if (p.rec.revoked) return;
    p.rec.revoked = true; p.online = false; p.ctrl?.abort(); p.ctrl = null;
    try { save(); } catch { /* disk */ }
    log(`enlace: ${p.rec.name} cerró el enlace`);
    changed();
  }
  async function request(p, pathname, kind, body, retry = true) {
    if (p.rec.revoked) throw err('el enlace está cerrado', { status: 401, revoked: true });
    const b = box(p, kind, body);
    let res;
    try { res = await postBox(p, pathname, b); } catch (e) { throw err(`el otro Orb no responde (${e.cause?.code ?? e.message})`, { status: 0, offline: true }); }
    if (retry && await clockFixed(p, res)) return request(p, pathname, kind, body, false);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { revoked(p); throw err(data.error ?? 'el enlace está cerrado', { status: 401, revoked: true }); }
    if (!res.ok) throw err(data.error ?? `error ${res.status}`, { status: res.status });
    let msg; try { msg = C.open(p.key, data, C.AAD.response(p.rec.id)); } catch { throw err('respuesta no válida'); }
    if (msg.r !== b.n) throw err('respuesta no válida');
    return msg;
  }
  const peerOf = (id) => {
    const p = id ? peers.get(String(id)) : [...peers.values()].find((x) => !x.rec.revoked);
    if (!p) throw err('ese enlace no existe');
    return p;
  };

  // ---- live events
  async function stream(p) {
    if (!started || p.rec.revoked || peers.get(p.rec.id) !== p) return;
    p.ctrl?.abort(); const ctrl = new AbortController(); p.ctrl = ctrl;
    let opened = false;
    try {
      const auth = C.sealText(p.key, { t: stamp(p), m: 'events' }, C.AAD.request(p.rec.id));
      const res = await f(`${baseOf(p)}/api/events`, { headers: { 'X-Orb-Device': p.rec.id, 'X-Orb-Auth': auth }, credentials: 'omit', signal: ctrl.signal });
      if (res.status === 401) { res.body?.cancel().catch(() => {}); return revoked(p); }
      if (await clockFixed(p, res)) p.wait = 100;
      if (!res.ok) throw new Error(String(res.status));
      opened = true; p.online = true; p.wait = 1000; p.rec.lastSeen = new Date().toISOString();
      changed();
      helloAfterConnect(p).catch((e) => log(`enlace: hola: ${e.message}`));
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
          if (!data) continue;
          let ev; try { ev = C.openText(p.key, data, C.AAD.event(p.rec.id)); } catch { continue; }
          if (ev.e === 'link:request') handleRequest(p, ev.p).catch((e) => log(`enlace: petición: ${e.message}`));
          else if (ev.e === 'link:rehello') helloAfterConnect(p).catch((e) => log(`enlace: hola: ${e.message}`));
          else fire(ev.e, ev.p, view(p));
        }
      }
    } catch { /* closed or unreachable */ }
    if (p.ctrl !== ctrl) return; // replaced or stopped
    if (opened) { p.online = false; p.rec.lastSeen = new Date().toISOString(); changed(); }
    else if (p.rec.urls.length > 1) p.rec.at = ((p.rec.at ?? 0) + 1) % p.rec.urls.length; // try the next address
    if (!started || p.rec.revoked) return;
    const wait = p.wait; p.wait = Math.min(p.wait * 2, 30_000);
    p.timer = setTimeout(() => { if (p.ctrl === ctrl) stream(p); }, wait);
    p.timer.unref?.();
  }
  // An Orb tells the other one who it is each time it connects (name, role, hostname, network cards for Wake-on-LAN).
  async function helloAfterConnect(p) {
    const me = identity() ?? {};
    if (me.kind !== 'orb') return;
    const r = await request(p, '/api/link', 'link', { op: 'hello', ...me });
    if (r.ok && r.result?.role && r.result.role !== p.rec.role) { p.rec.role = r.result.role; save(); changed(); }
    if (r.ok && typeof r.result?.wantsEvents === 'boolean') p.wantsEvents = r.result.wantsEvents;
    if (r.ok && r.result?.name && r.result.name !== p.rec.name) { p.rec.name = r.result.name; save(); changed(); }
  }
  // A call the centre forwards to this workshop (only from a centre, only as a workshop).
  async function handleRequest(p, req) {
    if (!req || typeof req.id !== 'string') return;
    let out;
    try {
      if (!hostsBots(p.rec.role ?? 'taller') || !doesDev(identity()?.role ?? 'todo') || !onRequest) throw err('este Orb no programa para ese Orb');
      out = { ok: true, result: (await onRequest(String(req.method ?? ''), req.params && typeof req.params === 'object' ? req.params : {}, view(p))) ?? null };
    } catch (e) { out = { ok: false, error: String(e?.message ?? e).slice(0, 1000), status: e?.status }; }
    await request(p, '/api/link', 'link', { op: 'reply', id: req.id, ...out });
  }
  async function flushOutbox() {
    flushTimer = null;
    const list = outbox; outbox = [];
    if (!list.length) return;
    for (const p of peers.values()) {
      if (!p.online || !hostsBots(p.rec.role ?? 'taller') || p.wantsEvents === false) continue;
      request(p, '/api/link', 'link', { op: 'events', list }).catch(() => {});
    }
  }

  // ---- linking
  async function pairAt(base, pcPub, code, via) {
    const { priv, pub } = C.newKeyPair();
    const me = identity() ?? {};
    let skew = 0;
    const body = () => ({ via, pub: C.b64.enc(pub), proof: C.seal(C.pairingKey(priv, pcPub, via === 'code' ? `corto:${normalCode(code)}` : code), { ...me, pub: C.b64.enc(pub), name: me.name, t: Date.now() + skew, v: PROTOCOL }, C.AAD.pair) });
    const send = () => f(`${base}/api/pair`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    let res = await send();
    if (res.status === 409) { const d = await res.json().catch(() => ({})); if (Number.isFinite(d.now)) { skew = d.now - Date.now(); res = await send(); } }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw err(data.error ?? `error ${res.status}`, { status: res.status });
    const key = C.sessionKey(priv, pcPub);
    let ok; try { ok = C.open(key, data.box, C.AAD.paired(data.id)); } catch { ok = null; }
    if (!ok || ok.id !== data.id) throw err('el otro Orb no es el del código');
    return { rec: { id: data.id, priv: C.b64.enc(priv), pc: C.b64.enc(pcPub), name: String(ok.orb ?? ok.name ?? 'Orb').slice(0, 60), role: ok.role ?? null, fp: ok.pc ?? C.fingerprint(pcPub), linkedAt: new Date().toISOString(), lastSeen: new Date().toISOString() }, key };
  }

  const link = {
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
    start() { if (started) return; started = true; load(); for (const p of peers.values()) if (!p.rec.revoked) stream(p); },
    stop() { started = false; for (const p of peers.values()) { p.ctrl?.abort(); p.ctrl = null; clearTimeout(p.timer); p.online = false; } clearTimeout(flushTimer); flushTimer = null; outbox = []; },
    peers: () => list(),
    // 3.5: say again who this Orb is to every linked Orb on now (after its role changed in Ajustes).
    refresh() { for (const p of peers.values()) if (p.online && !p.rec.revoked) helloAfterConnect(p).catch((e) => log(`enlace: hola: ${e.message}`)); },
    // Link with the QR (its text) or with the short code and the other Orb's address.
    async connect({ qr, code, address } = {}) {
      if (!started) link.start();
      let urls; let pcPub; let secretCode; let via;
      if (qr) { const q = parseQr(qr); urls = q.urls; pcPub = C.b64.dec(q.pc); secretCode = q.code; via = 'qr'; }
      else if (code) { const h = await hello(address, { fetch: f }); urls = [...new Set([h.base, ...(h.urls ?? []).filter((u) => /^https?:\/\//.test(u)).map(normalAddress)])]; pcPub = C.b64.dec(h.pc); secretCode = code; via = 'code'; }
      else throw err('falta el QR o el código');
      if (pcPub.length !== 32) throw err('el QR no es válido');
      let last = null;
      for (const base of urls) {
        try {
          const { rec, key } = await pairAt(base, pcPub, secretCode, via);
          rec.urls = [base, ...urls.filter((u) => u !== base)]; rec.at = 0;
          const p = { rec, key, skew: 0, online: false, wait: 1000 };
          peers.set(rec.id, p); save();
          stream(p); changed();
          return view(p);
        } catch (e) { last = e; if (e.status) break; } // the other Orb answered «no»: no point trying another address
      }
      throw last ?? err('el otro Orb no responde');
    },
    // Forget a link (and ask the other side to forget it too, if it can be reached).
    async disconnect(id) {
      const p = peerOf(id);
      if (!p.rec.revoked) await request(p, '/api/link', 'link', { op: 'bye' }).catch(() => {});
      p.ctrl?.abort(); p.ctrl = null; clearTimeout(p.timer);
      peers.delete(p.rec.id); save(); changed();
      return true;
    },
    // A call to the other Orb (as a phone would make it). With target 'taller', the centre forwards it to its workshop.
    async call(id, method, params = {}, { target } = {}) {
      const p = peerOf(id);
      const r = await request(p, '/api/call', 'call', { method, params: params ?? {}, ...(target ? { target } : {}) });
      if (!r.ok) throw err(r.error ?? 'error', { status: r.status, offline: r.offline, lastSeen: r.lastSeen, canWake: r.canWake });
      return r.result;
    },
    async me(id) { const r = await request(peerOf(id), '/api/me', 'me', null); if (!r.ok) throw err(r.error); return r.result; },
    // Live events of this Orb for the centre it works for (batched every 150 ms).
    relay(event, payload) {
      if (!RELAY_EVENTS.has(event) || ![...peers.values()].some((p) => p.online && hostsBots(p.rec.role ?? 'taller') && p.wantsEvents !== false)) return;
      if (!doesDev(identity()?.role ?? 'todo')) return;
      outbox.push({ e: event, p: event === 'config:changed' ? null : payload });
      if (outbox.length > 200) outbox.splice(0, outbox.length - 200);
      flushTimer ??= setTimeout(() => { flushOutbox().catch(() => {}); }, 150);
    },
    // Low level, for tests: seal and post a request exactly as this link does.
    raw(id) { const p = peerOf(id); return { id: p.rec.id, key: p.key, base: baseOf(p), box: (kind, body) => box(p, kind, body), post: (pathname, b) => postBox(p, pathname, b) }; }
  };
  return link;
}

// Who this Orb is, for the other side (and the MAC addresses a centre needs to wake it).
export function orbIdentity({ name, role, version, macs = [] } = {}) {
  return { kind: 'orb', name: String(name ?? os.hostname()).slice(0, 60), role: role ?? 'todo', host: os.hostname().slice(0, 80), macs, version: version ?? null, platform: process.platform };
}
