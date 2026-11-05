// 3.7 (Orb Server, WS6): the one-time codes of a vault item (RFC 6238 TOTP over RFC 4226 HOTP), computed in the vault's
// worker at the moment of filling. The seed never leaves the worker; only the 6–8 digit code of now does, to be typed.
// Accepts what Bitwarden keeps in login.totp: an otpauth://totp/… URI or a bare base32 secret. Steam codes and HOTP
// (counter) URIs are refused: Orb cannot keep a counter in step with the site.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(text) {
  const s = String(text ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!s || /[^A-Z2-7]/.test(s)) throw Object.assign(new Error('bad_totp'), { code: 'bad_totp' });
  let bits = 0; let value = 0; const out = [];
  for (const ch of s) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}

// { key: Buffer, digits, period, algorithm } from what the item keeps.
export function parseTotp(raw) {
  const s = String(raw ?? '').trim();
  const bad = () => { throw Object.assign(new Error('bad_totp'), { code: 'bad_totp' }); };
  if (!s) bad();
  if (/^steam:\/\//i.test(s)) bad();
  if (/^otpauth:/i.test(s)) {
    let u; try { u = new URL(s); } catch { return bad(); }
    if (u.host.toLowerCase() !== 'totp') bad();
    const q = u.searchParams;
    const digits = Number(q.get('digits') ?? 6); const period = Number(q.get('period') ?? 30);
    const algorithm = String(q.get('algorithm') ?? 'SHA1').toUpperCase().replace('-', '');
    if (![6, 7, 8].includes(digits) || !Number.isInteger(period) || period < 10 || period > 300 || !['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) bad();
    return { key: base32(q.get('secret')), digits, period, algorithm };
  }
  return { key: base32(s), digits: 6, period: 30, algorithm: 'SHA1' };
}

// RFC 4226 §5.3 (dynamic truncation) at counter `counter`.
export function hotp(key, counter, { digits = 6, algorithm = 'SHA1' } = {}) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algorithm.toLowerCase(), key).update(c).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// The code for the time `now` (ms). RFC 6238: T = floor((now/1000 - T0) / period), T0 = 0.
export function totp(raw, now = Date.now()) {
  const p = typeof raw === 'string' ? parseTotp(raw) : raw;
  const code = hotp(p.key, Math.floor(now / 1000 / p.period), p);
  return code;
}
// Seconds left for the current code (a code about to expire is not typed: the filler waits for the next one).
export const secondsLeft = (raw, now = Date.now()) => { const p = typeof raw === 'string' ? parseTotp(raw) : raw; return p.period - (Math.floor(now / 1000) % p.period); };
