// A phone or a browser linked with the PC, for the tests: it pairs with the QR (or the short code), calls the API and
// listens to the live events, all sealed with its own key, as the page does (src/ui/lib/web-bridge.js). Kept in memory.
// createPhone({ name, kind, password }) → { connect({ qr } | { code, address }), call(id, method, params), on(event, fn),
// peers(), raw(id), stop() }; id null: the first link. 3.8: password, the PC's master password it links with (the PC of a
// test makes it with TEST_MASTER). onFetch: the fetch its linking goes through (a test records the exchange).
import * as C from '../../src/shared/mobile-crypto.mjs';
import { parseLinkPayload, normalAddress, normalCode, PROTOCOL, MIN_PROTOCOL } from '../../src/shared/link-payload.mjs';

const err = (message, extra = {}) => Object.assign(new Error(message), extra);
export const TEST_MASTER = 'contraseña maestra de prueba';

export function createPhone({ name = 'Móvil de prueba', kind = 'phone', password = TEST_MASTER, onFetch = null } = {}) {
  const peers = new Map(); // id -> { id, key, base, skew, online, ctrl }
  const listeners = new Map();
  let stopped = false;
  const fire = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) fn(payload);
    for (const fn of listeners.get('*') ?? []) fn(event, payload);
  };
  const peerOf = (id) => {
    const p = id ? peers.get(String(id)) : [...peers.values()][0];
    if (!p) throw err('ese enlace no existe');
    return p;
  };
  const stamp = (p) => Date.now() + p.skew;
  const box = (p, m, b) => C.seal(p.key, { t: stamp(p), m, b }, C.AAD.request(p.id));
  const post = (p, pathname, b) => fetch(`${p.base}${pathname}`, { method: 'POST', headers: { 'X-Orb-Device': p.id, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const clockFixed = async (p, res) => {
    if (res.status !== 409) return false;
    const d = await res.clone().json().catch(() => ({}));
    if (!Number.isFinite(d.now)) return false;
    p.skew = d.now - Date.now(); return true;
  };
  async function request(p, pathname, m, body, retry = true) {
    const b = box(p, m, body);
    let res; try { res = await post(p, pathname, b); } catch (e) { throw err(`el PC no responde (${e.message})`, { status: 0, offline: true }); }
    if (retry && await clockFixed(p, res)) return request(p, pathname, m, body, false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw err(data.error ?? `error ${res.status}`, { status: res.status });
    const msg = C.open(p.key, data, C.AAD.response(p.id));
    if (msg.r !== b.n) throw err('respuesta no válida');
    return msg;
  }
  async function stream(p) {
    if (stopped) return;
    const ctrl = new AbortController(); p.ctrl = ctrl;
    try {
      const auth = C.sealText(p.key, { t: stamp(p), m: 'events' }, C.AAD.request(p.id));
      const res = await fetch(`${p.base}/api/events`, { headers: { 'X-Orb-Device': p.id, 'X-Orb-Auth': auth }, signal: ctrl.signal });
      if (!res.ok) { res.body?.cancel().catch(() => {}); return; }
      p.online = true;
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
          if (!data) continue;
          let ev; try { ev = C.openText(p.key, data, C.AAD.event(p.id)); } catch { continue; }
          fire(ev.e, ev.p);
        }
      }
    } catch { /* closed */ }
    p.online = false;
  }
  // The same exchange as the page (src/shared/mobile-crypto.mjs › linkDevice): the password never leaves this phone.
  async function pairAt(base, pcPub, code, via) {
    const secret = via === 'code3' ? await C.shortSecretAsync(normalCode(code), C.b64.enc(pcPub)) : code;
    let r;
    try { r = await C.linkDevice({ base, pcPub, secret, via, name, kind, v: PROTOCOL, min: MIN_PROTOCOL, password, fetch: onFetch ?? fetch }); }
    catch (e) {
      if (e.code === 'badAnswer') throw err('el PC no es el del código', { code: 'badAnswer' });
      if (e.code === 'offline') throw err('el PC no responde', { status: 0, offline: true });
      throw err(e.message, { status: e.status, reason: e.reason });
    }
    return { id: r.id, key: r.key, base, skew: r.skew, online: false, ctrl: null, pc: r.info?.pc ?? r.pc };
  }
  return {
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
    // fp: the fingerprint the person read on the PC's screen (the short code only).
    async connect({ qr, code, address, fp = null } = {}) {
      let urls; let pcPub; let secret; let via;
      if (qr) { const q = parseLinkPayload(qr); urls = q.urls; pcPub = C.b64.dec(q.pc); secret = q.code; via = 'qr'; }
      else {
        const base = normalAddress(address);
        const res = await fetch(`${base}/api/hello`);
        const h = await res.json().catch(() => ({}));
        if (!res.ok) throw err(h.error ?? `error ${res.status}`, { status: res.status });
        // The short code tied to the PC's key (3.5.1): an older answer, or one changed on the way, only with the QR.
        if (!(Number(h.short) >= 3)) throw err('ese Orb es de una versión anterior: enlaza con su QR');
        urls = [base]; pcPub = C.b64.dec(h.pc); secret = code; via = 'code3';
        // The fingerprint is worked out from the key received (never the other side's word) and compared with the PC's.
        if (fp && String(fp).toLowerCase() !== C.fingerprint(pcPub)) throw err('la huella no coincide: no lo enlaces');
      }
      const p = await pairAt(urls[0], pcPub, secret, via);
      peers.set(p.id, p);
      stream(p);
      return { id: p.id, fp: p.pc };
    },
    async call(id, method, params = {}) {
      const r = await request(peerOf(id), '/api/call', 'call', { method, params: params ?? {} });
      if (!r.ok) throw err(r.error ?? 'error', { status: r.status, reason: r.reason });
      return r.result;
    },
    peers: () => [...peers.values()].map((p) => ({ id: p.id, online: p.online })),
    // Low level: seal and post a request exactly as this phone does.
    raw(id) { const p = peerOf(id); return { id: p.id, key: p.key, base: p.base, box: (m, b) => box(p, m, b), post: (pathname, b) => post(p, pathname, b) }; },
    stop() { stopped = true; for (const p of peers.values()) { p.ctrl?.abort(); p.online = false; } }
  };
}
