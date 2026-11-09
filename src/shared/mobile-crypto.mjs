// End-to-end encryption between the PC and a paired phone, the same code on both sides (the engine and the phone's page).
// It works on plain http too (same Wi-Fi), where the browser's own WebCrypto is not available: small audited libraries.
//
// - The PC has a fixed X25519 key; its public half travels in the pairing QR, so the phone knows it is talking to that PC.
// - Pairing: the phone makes its own X25519 key and proves it read the QR (one-time code + PC key) without sending the code.
//   3.8: and that its owner knows the PC's master password, without sending that either (linkDevice below).
// - Every message afterwards is sealed with XChaCha20-Poly1305 under a key only that phone and the PC can derive. The
//   additional data names the device and the direction, so a message cannot be replayed as another kind or for another
//   phone; requests carry a timestamp and the PC refuses a nonce it has already seen.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { scrypt, scryptAsync } from '@noble/hashes/scrypt.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
export const CLOCK_SKEW_MS = 5 * 60_000; // a phone's clock may be a few minutes off

export const b64 = {
  enc(bytes) {
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(text) {
    const s = String(text ?? '').replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*$/.test(s)) throw new Error('base64 no válido');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
};

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function newKeyPair() {
  const priv = x25519.utils.randomSecretKey();
  return { priv, pub: x25519.getPublicKey(priv) };
}
export const publicKeyOf = (priv) => x25519.getPublicKey(priv);
export const sharedSecret = (priv, peerPub) => x25519.getSharedSecret(priv, peerPub);

const derive = (priv, peerPub, salt, info) => hkdf(sha256, x25519.getSharedSecret(priv, peerPub), enc.encode(salt), enc.encode(info), 32);
// The key that only proves the phone read this QR (one-time code + both keys).
export const pairingKey = (priv, peerPub, code) => derive(priv, peerPub, `orb-vincular:${code}`, 'orb movil vincular v1');
// The key of every later message between this phone and this PC.
export const sessionKey = (priv, peerPub) => derive(priv, peerPub, 'orb-movil', 'orb movil sesion v1');

// 3.5.1: the short code typed by hand is stretched with scrypt and tied to the key the other side says it has, so a
// stranger in the middle who swaps the key cannot try every code fast enough. Both sides derive the same secret; the
// answer to the pairing is sealed with it too, so the device knows the other side really had the code.
const SHORT_KDF = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 };
const shortSalt = (pcPubB64) => `orb-corto-v3:${pcPubB64}`;
export const shortSecret = (code, pcPubB64) => `corto3:${b64.enc(scrypt(String(code), shortSalt(pcPubB64), SHORT_KDF))}`;
export const shortSecretAsync = async (code, pcPubB64) => `corto3:${b64.enc(await scryptAsync(String(code), shortSalt(pcPubB64), SHORT_KDF))}`;

// A short, readable fingerprint of a public key (shown on the PC and the phone to compare by eye).
export const fingerprint = (pub) => Array.from(sha256(pub).slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('').match(/.{4}/g).join('-');

// ---- 3.8: linking needs the PC's master password, and the password never leaves the phone.
// The PC keeps a verifier: the public half of an X25519 key whose private half comes from the password (scrypt with the
// verifier's own salt, then HKDF). Linking is two steps on /api/pair:
//   start   the phone proves it has the code (as before) and gets back, sealed with the code's key, a session id and the
//           verifier's salt and cost;
//   finish  both sides derive K = HKDF(code ‖ ECDH(phone, PC) ‖ ECDH(password key, PC)) bound to the whole exchange (its
//           transcript) and each proves it with a MAC: the phone first (a wrong password fails here, and only the PC can
//           tell), then the PC (only the real PC, which has its private key and the verifier, can answer).
// A passive observer (even one who saw the QR) cannot compute ECDH(phone, PC), so the exchange tells it nothing about the
// password. A fake PC (a forged QR, or someone in the middle of a typed short code who also breaks the code) gets one MAC
// to attack offline, slowed by scrypt; it never sees the password (docs/ARCHITECTURE.md §37: OPAQUE would close that too).
export const PAIR_KDF = Object.freeze({ N: 2 ** 16, r: 8, p: 1 });
const TEST_RUN = () => Boolean(globalThis.process?.env?.NODE_TEST_CONTEXT);
// The cost a PC may ask for: never cheaper than 2^15 (a fake PC could make the offline attack cheap) and never one that
// would hang the phone. A test run allows its own cheap cost.
export function pairKdfOk(kdf) {
  if (!kdf || typeof kdf !== 'object') return false;
  const { N, r, p, salt } = kdf;
  let s; try { s = b64.dec(salt); } catch { return false; }
  return Number.isInteger(N) && N >= (TEST_RUN() ? 2 ** 10 : 2 ** 15) && N <= 2 ** 18 && (N & (N - 1)) === 0 && r === 8 && p === 1 && s.length === 16;
}
// The verifier's key from scrypt's output (the PC runs Node's own scrypt; the phone, verifierOf).
export function verifierFromSeed(seed) {
  const priv = hkdf(sha256, seed, enc.encode('orb-verificador'), enc.encode('orb pake v1'), 32);
  return { priv, pub: x25519.getPublicKey(priv) };
}
export async function verifierOf(password, kdf) {
  if (!pairKdfOk(kdf)) throw Object.assign(new Error('badAnswer'), { code: 'badAnswer' });
  return verifierFromSeed(await scryptAsync(String(password ?? '').normalize('NFC'), b64.dec(kdf.salt), { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32, maxmem: 2 ** 29 }));
}
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of parts) { out.set(x, i); i += x.length; } return out; };
const field = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; return cat(new Uint8Array([b.length >> 8, b.length & 255]), b); };
// Everything both sides agreed on, hashed: a MAC of one exchange is worth nothing in another.
export const pakeTranscript = ({ via, devPub, pcPub, sid, kdf }) => sha256(cat(field('orb-pake-v1'), field(String(via)), field(devPub), field(pcPub), field(String(sid)), field(`${kdf.N}/${kdf.r}/${kdf.p}`), field(String(kdf.salt))));
export const pakeKey = ({ secret, dhDevice, dhPassword, transcript }) => hkdf(sha256, cat(field(String(secret)), field(dhDevice), field(dhPassword)), transcript, enc.encode('orb pake clave v1'), 32);
export const pakeMac = (key, label) => hmac(sha256, key, enc.encode(String(label)));
export const MAC_PHONE = 'orb-pake:movil';
export const macPc = (id) => `orb-pake:pc:${id}`;
export function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// The phone's side of linking (the page, the Android app and the tests all use this one). → { id, priv, key (the session
// key), pc (the PC's fingerprint), info (what the PC said, sealed with the session key), skew }. Errors: { status, reason,
// left } from the PC (message: its words), or code 'offline' (not reachable at base) / 'badAnswer' (not the PC of the code).
export async function linkDevice({ base, pcPub, secret, via, name, kind, v, min, password, fetch: get = globalThis.fetch, now = Date.now }) {
  const { priv, pub } = newKeyPair();
  const pubB = b64.enc(pub);
  const codeKey = pairingKey(priv, pcPub, secret);
  const fail = (code) => Object.assign(new Error(code), { code });
  const post = async (body) => {
    try { return await get(`${base}/api/pair`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw fail('offline'); }
  };
  const answer = async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `error ${res.status}`), { status: res.status, reason: data.reason ?? null, left: data.left ?? null });
    return data;
  };
  let skew = 0;
  const start = () => post({ step: 'start', via, pub: pubB, proof: seal(codeKey, { pub: pubB, name, kind, t: now() + skew, v, min }, AAD.pair) });
  let res = await start();
  // The phone's clock is off: once more with the PC's time.
  if (res.status === 409) { const d = await res.clone().json().catch(() => ({})); if (Number.isFinite(d.now)) { skew = d.now - now(); res = await start(); } }
  const challenge = await answer(res);
  let ch; try { ch = open(codeKey, challenge.box, AAD.pairChallenge); } catch { throw fail('badAnswer'); }
  if (!ch || ch.sid !== challenge.sid || !pairKdfOk(ch.kdf)) throw fail('badAnswer');
  const verifier = await verifierOf(password, ch.kdf);
  const transcript = pakeTranscript({ via, devPub: pub, pcPub, sid: ch.sid, kdf: ch.kdf });
  const K = pakeKey({ secret, dhDevice: x25519.getSharedSecret(priv, pcPub), dhPassword: x25519.getSharedSecret(verifier.priv, pcPub), transcript });
  const done = await answer(await post({ step: 'finish', sid: ch.sid, pub: pubB, mac: b64.enc(pakeMac(K, MAC_PHONE)) }));
  // The PC proves it too: only the real one can.
  let mac; try { mac = b64.dec(done.mac); } catch { mac = null; }
  if (typeof done.id !== 'string' || !sameBytes(mac, pakeMac(K, macPc(done.id)))) throw fail('badAnswer');
  const key = sessionKey(priv, pcPub);
  let info; try { info = open(key, done.box, AAD.paired(done.id)); } catch { info = null; }
  if (info?.id !== done.id) throw fail('badAnswer');
  return { id: done.id, priv, key, pc: fingerprint(pcPub), info, skew };
}

const aadOf = (aad) => enc.encode(String(aad ?? ''));

// Seals a JSON value: { n, c } (nonce and ciphertext, base64url).
export function seal(key, value, aad) {
  const nonce = randomBytes(24);
  const c = xchacha20poly1305(key, nonce, aadOf(aad)).encrypt(enc.encode(JSON.stringify(value)));
  return { n: b64.enc(nonce), c: b64.enc(c) };
}
// Opens what seal() made; throws if it was changed, sealed with another key or for another purpose.
export function open(key, box, aad) {
  if (!box || typeof box.n !== 'string' || typeof box.c !== 'string') throw new Error('mensaje no válido');
  const nonce = b64.dec(box.n); if (nonce.length !== 24) throw new Error('mensaje no válido');
  return JSON.parse(dec.decode(xchacha20poly1305(key, nonce, aadOf(aad)).decrypt(b64.dec(box.c))));
}
// The same as one string ("nonce.ciphertext"), for a header or one line of the live stream.
export const sealText = (key, value, aad) => { const b = seal(key, value, aad); return `${b.n}.${b.c}`; };
export const openText = (key, text, aad) => { const [n, c] = String(text ?? '').split('.'); return open(key, { n, c }, aad); };

// Raw bytes (pictures): nonce (24) + ciphertext.
export function sealBytes(key, bytes, aad) {
  const nonce = randomBytes(24);
  const c = xchacha20poly1305(key, nonce, aadOf(aad)).encrypt(bytes);
  const out = new Uint8Array(24 + c.length); out.set(nonce); out.set(c, 24);
  return out;
}
export function openBytes(key, bytes, aad) {
  if (!bytes || bytes.length < 24 + 16) throw new Error('mensaje no válido');
  return xchacha20poly1305(key, bytes.subarray(0, 24), aadOf(aad)).decrypt(bytes.subarray(24));
}

// What each message is for: the device id plus the direction (request, answer, live event, picture).
export const AAD = {
  pair: 'orb:vincular',
  pairChallenge: 'orb:vincular:reto',
  paired: (id) => `orb:vinculado:${id}`,
  request: (id) => `orb:peticion:${id}`,
  response: (id) => `orb:respuesta:${id}`,
  event: (id) => `orb:evento:${id}`,
  upload: (id) => `orb:imagen:${id}`
};
