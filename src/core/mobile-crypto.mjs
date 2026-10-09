// End-to-end encryption between the PC and a paired phone, the same code on both sides (the engine and the phone's page).
// It works on plain http too (same Wi-Fi), where the browser's own WebCrypto is not available: small audited libraries.
//
// - The PC has a fixed X25519 key; its public half travels in the pairing QR, so the phone knows it is talking to that PC.
// - Pairing: the phone makes its own X25519 key and proves it read the QR (one-time code + PC key) without sending the code.
// - Every message afterwards is sealed with XChaCha20-Poly1305 under a key only that phone and the PC can derive. The
//   additional data names the device and the direction, so a message cannot be replayed as another kind or for another
//   phone; requests carry a timestamp and the PC refuses a nonce it has already seen.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
export const PROTOCOL = 1;
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

const derive = (priv, peerPub, salt, info) => hkdf(sha256, x25519.getSharedSecret(priv, peerPub), enc.encode(salt), enc.encode(info), 32);
// The key that only proves the phone read this QR (one-time code + both keys).
export const pairingKey = (priv, peerPub, code) => derive(priv, peerPub, `orb-vincular:${code}`, 'orb movil vincular v1');
// The key of every later message between this phone and this PC.
export const sessionKey = (priv, peerPub) => derive(priv, peerPub, 'orb-movil', 'orb movil sesion v1');

// A short, readable fingerprint of a public key (shown on the PC and the phone to compare by eye).
export const fingerprint = (pub) => Array.from(sha256(pub).slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('').match(/.{4}/g).join('-');

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
  paired: (id) => `orb:vinculado:${id}`,
  request: (id) => `orb:peticion:${id}`,
  response: (id) => `orb:respuesta:${id}`,
  event: (id) => `orb:evento:${id}`,
  upload: (id) => `orb:imagen:${id}`
};
