// (3.5: moved from src/ui/lib/link-payload.js, which re-exports it.) What the Android app (and the phone's browser) reads to link with an Orb: the QR's text or what is typed by hand.
// Pure functions, no browser or crypto: kept in one small file so a change of the Magic Link format only touches this
// (test/android.test.mjs). The formats:
// - v1 QR: «http://ip:port/#vincular=<one-time code>&pc=<the Orb's public key>»
// - v2 QR: the same plus «&v=2&n=<name>&a=<other addresses, comma separated>» (an Orb before 3.8 also sent r=<role>)
// - JSON: { v, urls | url, pc, code, name, role }
// - typed by hand: the short code (8 letters and digits) and the Orb's address; its key comes from GET /api/hello.

export const DEFAULT_PORT = '3131';

// The short code: letters and digits that cannot be confused (as link.mjs › normalCode).
export const normalCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').slice(0, 16);

const fail = (key) => Object.assign(new Error(key), { key });

// The base URL of an address: «100.64.1.2:3131», «casa.tail.ts.net», «http://…» or «https://…» → «http://100.64.1.2:3131».
export function normalAddress(address) {
  let a = String(address ?? '').trim();
  if (!a) throw fail('app.linkNoAddress');
  if (!/^https?:\/\//i.test(a)) a = `http://${a}`;
  let u; try { u = new URL(a); } catch { throw fail('app.linkBadAddress'); }
  if (!u.hostname) throw fail('app.linkBadAddress');
  if (!u.port && u.protocol === 'http:') u.port = DEFAULT_PORT;
  return `${u.protocol}//${u.host}`;
}

// Private addresses only travel in plain http: Tailscale (100.64.0.0/10, *.ts.net, a MagicDNS short name such as
// «home-server»), the home network (10/8, 172.16/12, 192.168/16, *.local, *.lan, *.home.arpa) and this device.
// Anything else must be https.
export function isPrivateHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || /\.(ts\.net|local|lan|home\.arpa)$/.test(h) || (/^[a-z0-9-]+$/.test(h) && !/^\d+$/.test(h))) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
  }
  return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h); // IPv6: loopback, unique local, link-local
}
export const allowedBase = (base) => { try { const u = new URL(base); return u.protocol === 'https:' || (u.protocol === 'http:' && isPrivateHost(u.hostname)); } catch { return false; } };

// The order to try an Orb's addresses: https first (tailscale serve), then Tailscale, then the home network; the rest
// keeps its order. Addresses the app may not use (plain http to a public address) are dropped.
export function orderBases(list) {
  const rank = (b) => { const u = new URL(b); if (u.protocol === 'https:') return 0; const h = u.hostname; return /^100\./.test(h) || /\.ts\.net$/.test(h) ? 1 : 2; };
  const seen = new Set(); const out = [];
  for (const x of list ?? []) { let b; try { b = normalAddress(x); } catch { continue; } if (!seen.has(b) && allowedBase(b)) { seen.add(b); out.push(b); } }
  return out.map((b, i) => [rank(b), i, b]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
}

// The QR's text (or a pasted link) → { v, urls, pc, code, name, role, via: 'qr' }.
export function parseLinkPayload(input) {
  let q = input;
  if (typeof q === 'string') q = q.trim();
  if (typeof q === 'string' && q.startsWith('{')) { try { q = JSON.parse(q); } catch { throw fail('app.linkBadQr'); } }
  let out;
  if (q && typeof q === 'object') {
    const urls = (Array.isArray(q.urls) ? q.urls : [q.url]).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
    if (!urls.length || typeof q.pc !== 'string' || typeof q.code !== 'string') throw fail('app.linkBadQr');
    out = { v: Number(q.v ?? 2), urls, pc: q.pc, code: q.code, name: q.name ?? null, role: q.role ?? null };
  } else {
    let u; try { u = new URL(String(q ?? '')); } catch { throw fail('app.linkBadQr'); }
    if (!/^https?:$/.test(u.protocol)) throw fail('app.linkBadQr');
    const h = new URLSearchParams(u.hash.slice(1));
    const code = h.get('vincular'); const pc = h.get('pc');
    if (!code) throw fail('app.linkBadQr');
    if (!pc) throw fail('app.oldQr');
    const others = (h.get('a') ?? '').split(',').filter((x) => /^https?:\/\//i.test(x));
    out = { v: Number(h.get('v') ?? 1), urls: [`${u.protocol}//${u.host}`, ...others], pc, code, name: h.get('n'), role: h.get('r') };
  }
  out.urls = orderBases(out.urls);
  if (!out.urls.length) throw fail('app.linkInsecure');
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(out.pc)) throw fail('app.oldQr'); // a 32-byte key in base64
  return { ...out, via: 'qr' };
}

// What the person typed in the «by hand» form: a pasted link (or JSON) or the short code plus the address.
export function parseManual({ text, code, address } = {}) {
  if (text && String(text).trim()) return parseLinkPayload(text);
  const c = normalCode(code);
  if (c.length < 6) throw fail('app.linkNoCode');
  const base = normalAddress(address);
  if (!allowedBase(base)) throw fail('app.linkInsecure');
  return { v: 2, urls: [base], pc: null, code: c, name: null, role: null, via: 'code' };
}

// The secret both sides derive the pairing key from (link.mjs › pairAt): the QR's code as is, the short one marked.
export const pairingSecret = (p) => (p.via === 'code' ? `corto:${normalCode(p.code)}` : p.code);

// Which window.orb the page gets: Electron's preload (already there), the Android app (Capacitor) or the browser's.
export function pickBridge({ hasOrb = false, native = false } = {}) {
  if (hasOrb) return 'electron';
  return native ? 'app' : 'web';
}

// 3.6: the protocol of the link (this PC, the page and the Android app). Each side says { v, min } (hello, /api/me): v what
// it speaks, min the oldest it still accepts. A page or an app older than the PC's min is asked to update; phones of
// protocol 2 keep working (MIN_PROTOCOL).
export const PROTOCOL = 3;
export const MIN_PROTOCOL = 2;
// The app version a side of a protocol has at least (for «tiene 3.5, hace falta 3.6»).
export const versionOfProtocol = (v) => (Number(v) >= 3 ? '3.6' : Number(v) === 2 ? '3.5' : '3.4');
// The short code typed by hand: 8 letters and digits that cannot be confused (no 0/O, 1/I/L, U), shown as «ABCD-EFGH».
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const shortCodeLabel = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16).replace(/(.{4})(?=.)/g, '$1-');
// → null (fine) or { has, need } (the protocols: this client's and the one the Orb needs).
export function updateNeeded(me, mine = PROTOCOL) {
  const need = Number(me?.min);
  return Number.isFinite(need) && need > mine ? { has: mine, need } : null;
}
