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

// 3.6 «Personas»: protocol 3. Each side says { v, min, version, features } (hello, /api/me): v what it speaks, min the
// oldest it still accepts. Phones and terminals of protocol 2 keep working (MIN_PROTOCOL); forwarding calls of people
// other than the owner needs a workshop of protocol 3 (FORWARD_MIN: it must know who asks, A13).
export const PROTOCOL = 3;
export const MIN_PROTOCOL = 2;
export const FORWARD_MIN = 3;
export const FEATURES = ['persons'];
// Who has to update, given what this side speaks and what the other says: null (they understand each other), 'me' (this
// side is too old for the other) or 'them' (the other is too old for this one). An answer without v is protocol 2 (3.5).
export function versionGap(mine = {}, theirs = {}) {
  const tv = Number(theirs?.v ?? 2); const tmin = Number(theirs?.min ?? 1);
  if (Number(mine.v ?? PROTOCOL) < tmin) return 'me';
  if (tv < Number(mine.min ?? MIN_PROTOCOL)) return 'them';
  return null;
}
// The app version an Orb of a protocol has at least (for «tiene 3.5, hace falta 3.6»).
export const versionOfProtocol = (v) => (Number(v) >= 3 ? '3.6' : Number(v) === 2 ? '3.5' : '3.4');
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

// protocol / min: what this side says it speaks (tests make an older Orb with them).
// verdict(known, seen): what to make of the other Orb's identity ({ orbId, incarnation, host }): 'new' | 'same' | 'moved' |
// 'clone' (src/core/export.mjs › cloneVerdict; not imported: the terminal ships this file alone). A clone is not trusted:
// its link is marked and the event 'link:clone' fires.
export function createLink({ file, secret, identity = () => ({}), onRequest = null, onChange = () => {}, log = () => {}, fetch: f = globalThis.fetch, protocol = PROTOCOL, min = MIN_PROTOCOL, verdict = null } = {}) {
  if (!file || !secret) throw new Error('createLink: falta el archivo o la clave');
  const peers = new Map(); // id -> { rec, key, skew, ctrl, online, wait, at }
  const listeners = new Map();
  let started = false;
  let outbox = new Map(); let flushTimer = null; // events waiting to go to each centre: peer id -> [{ e, p }]

  const fire = (event, payload, peer) => {
    for (const fn of listeners.get(event) ?? []) { try { fn(payload, peer); } catch (e) { log(`enlace: ${e.message}`); } }
    for (const fn of listeners.get('*') ?? []) { try { fn(event, payload, peer); } catch (e) { log(`enlace: ${e.message}`); } }
  };
  // 3.6: person: whose link this is on this side (who made it; null = the owner, as before 3.6); remotePerson: whom the
  // other side counts it as ({ id, name }, learned from its hello or /api/me); remote: { v, min, version, features }.
  const view = (p) => ({ id: p.rec.id, name: p.rec.name, role: p.rec.role ?? null, fp: p.rec.fp ?? null, url: p.rec.urls[p.rec.at ?? 0] ?? p.rec.urls[0], urls: p.rec.urls,
    online: Boolean(p.online), revoked: Boolean(p.rec.revoked), linkedAt: p.rec.linkedAt, lastSeen: p.rec.lastSeen ?? null,
    person: p.rec.person ?? null, remotePerson: p.rec.remotePerson ?? null, remote: p.rec.remote ?? null, clone: Boolean(p.rec.clone) });
  // What the other side said of itself and of whom it counts this link as (hello and /api/me answers).
  const learn = (p, r) => {
    if (!r || typeof r !== 'object') return;
    let dirty = false;
    if (r.person && typeof r.person === 'object' && r.person.id) {
      const rp = { id: String(r.person.id).slice(0, 40), name: String(r.person.name ?? '').slice(0, 60) };
      if (JSON.stringify(rp) !== JSON.stringify(p.rec.remotePerson ?? null)) { p.rec.remotePerson = rp; dirty = true; }
    }
    if (r.v != null) {
      const rv = { v: Number(r.v) || 2, min: Number(r.min ?? 1) || 1, version: r.version ? String(r.version).slice(0, 40) : null, features: Array.isArray(r.features) ? r.features.map(String).slice(0, 20) : [] };
      if (JSON.stringify(rv) !== JSON.stringify(p.rec.remote ?? null)) { p.rec.remote = rv; dirty = true; }
    }
    // 3.6 (moving an Orb): the other Orb's identity; a newer incarnation is followed, an older one or the same one from
    // another machine is a clone.
    if (verdict && r.orb && typeof r.orb === 'object' && /^[0-9a-f]{32}$/.test(String(r.orb.orbId ?? ''))) {
      const seen = { orbId: String(r.orb.orbId), incarnation: Number(r.orb.incarnation) || 1, host: r.orb.host ? String(r.orb.host).slice(0, 80) : null };
      const v = verdict(p.rec.orb ?? null, seen);
      if (v === 'clone') { if (!p.rec.clone) { p.rec.clone = true; dirty = true; fire('link:clone', { id: p.rec.id, name: p.rec.name }, view(p)); } }
      else if (JSON.stringify(seen) !== JSON.stringify(p.rec.orb ?? null) || p.rec.clone) { if (v === 'moved') fire('link:moved', { id: p.rec.id, name: p.rec.name }, view(p)); p.rec.orb = seen; p.rec.clone = false; dirty = true; }
    }
    if (dirty) { try { save(); } catch { /* disk */ } changed(); }
  };
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
      p.hello = helloAfterConnect(p); p.hello.catch((e) => log(`enlace: hola: ${e.message}`));
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
          else if (ev.e === 'link:rehello') { p.hello = helloAfterConnect(p); p.hello.catch((e) => log(`enlace: hola: ${e.message}`)); }
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
    // 3.6: what this side speaks (v, min, features) goes with it; the answer says the same of the other and whom it counts
    // this link as.
    const r = await request(p, '/api/link', 'link', { op: 'hello', ...me, v: protocol, min, features: FEATURES });
    if (r.ok) learn(p, r.result);
    if (r.ok && r.result?.role && r.result.role !== p.rec.role) { p.rec.role = r.result.role; save(); changed(); }
    if (r.ok && typeof r.result?.wantsEvents === 'boolean') p.wantsEvents = r.result.wantsEvents;
    if (r.ok && r.result?.name && r.result.name !== p.rec.name) { p.rec.name = r.result.name; save(); changed(); }
  }
  // A call the centre forwards to this workshop (only from a centre, only as a workshop).
  // 3.6 (A13, A12): it carries who asks there (principal: { person, device, channel, rights }) and a request_id the
  // workshop remembers, so a call sent twice runs once. onRequest maps the link to a person here and decides.
  async function handleRequest(p, req) {
    if (!req || typeof req.id !== 'string') return;
    let out;
    try {
      if (!hostsBots(p.rec.role ?? 'taller') || !doesDev(identity()?.role ?? 'todo') || !onRequest) throw err('este Orb no programa para ese Orb');
      if (p.rec.clone) throw err('ese Orb parece una copia de otro: no se atiende', { status: 409 });
      // Whom the other side counts this link as comes with the hello: wait for it if it is on its way.
      if (!p.rec.remotePerson && p.hello) await p.hello.catch(() => {});
      const principal = req.principal && typeof req.principal === 'object' ? req.principal : null;
      out = { ok: true, result: (await onRequest(String(req.method ?? ''), req.params && typeof req.params === 'object' ? req.params : {}, view(p),
        { principal, requestId: typeof req.request_id === 'string' ? req.request_id.slice(0, 80) : null, v: Number(req.v ?? 2) })) ?? null };
    } catch (e) { out = { ok: false, error: String(e?.message ?? e).slice(0, 1000), status: e?.status, ...(e?.reason ? { reason: e.reason } : {}) }; }
    await request(p, '/api/link', 'link', { op: 'reply', id: req.id, ...out });
  }
  async function flushOutbox() {
    flushTimer = null;
    const boxes = outbox; outbox = new Map();
    for (const [id, list] of boxes) {
      const p = peers.get(id);
      if (!list.length || !p || !p.online || !hostsBots(p.rec.role ?? 'taller') || p.wantsEvents === false) continue;
      request(p, '/api/link', 'link', { op: 'events', list }).catch(() => {});
    }
  }

  // ---- linking
  async function pairAt(base, pcPub, code, via) {
    const { priv, pub } = C.newKeyPair();
    const me = identity() ?? {};
    let skew = 0;
    // 3.5.1: the short code is stretched and tied to the key the other side gave (code3); the QR's code goes as it is.
    const secret = via === 'code3' ? await C.shortSecretAsync(normalCode(code), C.b64.enc(pcPub)) : code;
    const body = () => ({ via, pub: C.b64.enc(pub), proof: C.seal(C.pairingKey(priv, pcPub, secret), { ...me, pub: C.b64.enc(pub), name: me.name, t: Date.now() + skew, v: protocol, min }, C.AAD.pair) });
    const send = () => f(`${base}/api/pair`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    let res = await send(); let data = null;
    if (res.status === 409) { const d = await res.json().catch(() => ({})); if (Number.isFinite(d.now)) { skew = d.now - Date.now(); res = await send(); } else data = d; }
    data ??= await res.json().catch(() => ({}));
    if (!res.ok) throw err(data.error ?? `error ${res.status}`, { status: res.status });
    const key = C.sessionKey(priv, pcPub);
    let ok; try { ok = C.open(key, data.box, C.AAD.paired(data.id)); } catch { ok = null; }
    if (!ok || ok.id !== data.id) throw err('el otro Orb no es el del código');
    // 3.5.1: the other side proves it had the code too (a key swapped on the way cannot make this one).
    let sure; try { sure = data.confirm ? C.open(C.pairingKey(priv, pcPub, secret), data.confirm, C.AAD.confirm(data.id)) : null; } catch { sure = null; }
    if (via === 'code3' && sure?.id !== data.id) throw err('el otro Orb no es el del código');
    const rec = { id: data.id, priv: C.b64.enc(priv), pc: C.b64.enc(pcPub), name: String(ok.orb ?? ok.name ?? 'Orb').slice(0, 60), role: ok.role ?? null, fp: ok.pc ?? C.fingerprint(pcPub), linkedAt: new Date().toISOString(), lastSeen: new Date().toISOString() };
    // 3.6: whom the other side made this link for (the QR's «¿Para quién?») and what it speaks.
    if (ok.person?.id) rec.remotePerson = { id: String(ok.person.id).slice(0, 40), name: String(ok.person.name ?? '').slice(0, 60) };
    if (ok.v != null) rec.remote = { v: Number(ok.v) || 2, min: Number(ok.min ?? 1) || 1, version: ok.version ? String(ok.version).slice(0, 40) : null, features: Array.isArray(ok.features) ? ok.features.map(String).slice(0, 20) : [] };
    return { rec, key };
  }

  const link = {
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
    start() { if (started) return; started = true; load(); for (const p of peers.values()) if (!p.rec.revoked) stream(p); },
    stop() { started = false; for (const p of peers.values()) { p.ctrl?.abort(); p.ctrl = null; clearTimeout(p.timer); p.online = false; } clearTimeout(flushTimer); flushTimer = null; outbox = new Map(); },
    peers: () => list(),
    // 3.5: say again who this Orb is to every linked Orb on now (after its role changed in Ajustes).
    refresh() { for (const p of peers.values()) if (p.online && !p.rec.revoked) helloAfterConnect(p).catch((e) => log(`enlace: hola: ${e.message}`)); },
    // Link with the QR (its text) or with the short code and the other Orb's address.
    // 3.6: person: whose link it is on this side (the person who links; null = the owner).
    async connect({ qr, code, address, fp, person = null } = {}) {
      if (!started) link.start();
      let urls; let pcPub; let secretCode; let via;
      if (qr) { const q = parseQr(qr); urls = q.urls; pcPub = C.b64.dec(q.pc); secretCode = q.code; via = 'qr'; }
      else if (code) {
        const h = await hello(address, { fetch: f });
        // 3.5.1: only an Orb that ties the code to its key (short ≥ 3); an older one, or an answer changed on the way, is
        // refused (the QR still works). fp: the fingerprint the user read on the other screen, when given.
        if (!(Number(h.short) >= 3)) throw err('ese Orb es de una versión anterior: actualízalo o enlaza con su QR');
        if (fp && String(fp).toLowerCase() !== String(h.fp ?? '').toLowerCase()) throw err('la huella no coincide: no lo enlaces');
        urls = [...new Set([h.base, ...(h.urls ?? []).filter((u) => /^https?:\/\//.test(u)).map(normalAddress)])]; pcPub = C.b64.dec(h.pc); secretCode = code; via = 'code3';
      }
      else throw err('falta el QR o el código');
      if (pcPub.length !== 32) throw err('el QR no es válido');
      let last = null;
      for (const base of urls) {
        try {
          const { rec, key } = await pairAt(base, pcPub, secretCode, via);
          rec.urls = [base, ...urls.filter((u) => u !== base)]; rec.at = 0;
          if (person) rec.person = String(person).slice(0, 40);
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
    // 3.6: ticket: a strong ticket of this device (persons.verifyPin) for a call that needs the PIN.
    async call(id, method, params = {}, { target, ticket } = {}) {
      const p = peerOf(id);
      const r = await request(p, '/api/call', 'call', { method, params: params ?? {}, ...(target ? { target } : {}), ...(ticket ? { ticket } : {}) });
      if (!r.ok) throw err(r.error ?? 'error', { status: r.status, offline: r.offline, lastSeen: r.lastSeen, canWake: r.canWake, reason: r.reason, unknown: r.unknown, queueId: r.queueId, requestId: r.requestId });
      return r.result;
    },
    // 3.6: with what this side speaks (v, min): the other says whom it counts this link as and its own versions.
    async me(id) {
      const p = peerOf(id);
      const r = await request(p, '/api/me', 'me', { v: protocol, min, features: FEATURES });
      if (!r.ok) throw err(r.error, { status: r.status, update: r.update ?? null });
      learn(p, r.result);
      return r.result;
    },
    // Live events of this Orb for the centre it works for (batched every 150 ms).
    // 3.6: reaches(person): whether the event is for that person of this Orb; each centre gets only the events of the
    // person its link belongs to here (the centre filters again by the person of the device).
    relay(event, payload, reaches = null) {
      if (!RELAY_EVENTS.has(event)) return;
      if (!doesDev(identity()?.role ?? 'todo')) return;
      for (const p of peers.values()) {
        if (!p.online || !hostsBots(p.rec.role ?? 'taller') || p.wantsEvents === false) continue;
        if (reaches && !reaches(p.rec.person ?? null)) continue;
        const list = outbox.get(p.rec.id) ?? []; outbox.set(p.rec.id, list);
        list.push({ e: event, p: event === 'config:changed' ? null : payload });
        if (list.length > 200) list.splice(0, list.length - 200);
        flushTimer ??= setTimeout(() => { flushOutbox().catch(() => {}); }, 150);
      }
    },
    // 3.6: a backup of this Orb (an .orbbak, encrypted already) kept on the other one, in pieces of 1.5 MB. → { stored, size }
    async putBackup(id, filePath) {
      const p = peerOf(id);
      const name = path.basename(String(filePath));
      const total = fs.statSync(filePath).size;
      const fh = await fs.promises.open(filePath, 'r');
      try {
        let offset = 0; const piece = Buffer.alloc(1_500_000); let last = null;
        const upload = `${Date.now().toString(36)}${nodeCrypto.randomBytes(4).toString('hex')}`;
        do {
          const { bytesRead } = await fh.read(piece, 0, piece.length, offset);
          const done = offset + bytesRead >= total;
          last = await request(p, '/api/link', 'link', { op: 'backup.put', upload, name, total, offset, data: piece.subarray(0, bytesRead).toString('base64'), done });
          if (!last.ok) throw err(last.error ?? 'error', { status: last.status });
          offset += bytesRead;
        } while (offset < total);
        return last.result;
      } finally { await fh.close(); }
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
