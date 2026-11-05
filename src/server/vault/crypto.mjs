// 3.7 (Orb Server, WS6): the cryptography of a Bitwarden-compatible vault (Bitwarden or Vaultwarden), read only, plus
// the sealing of what Orb Server keeps on disk with its own key. Pure functions on Buffers: no network, no files, no
// engine imports (the vault's worker process loads it; the tests check it against RFC vectors and recorded fixtures).
//
// What Bitwarden does (and so what this file does), in short:
//   master key   = PBKDF2-SHA256(password, lower(email), iterations, 32)              (kdf 0)
//                | Argon2id(password, SHA-256(lower(email)), passes, memory MiB, lanes, 32)   (kdf 1)
//   stretched    = HKDF-Expand-SHA256(master key, "enc", 32) ‖ HKDF-Expand-SHA256(master key, "mac", 32)
//   user key     = decrypt(profile.key, stretched)            → 64 bytes: AES key ‖ HMAC key
//   private key  = decrypt(profile.privateKey, user key)      → PKCS#8 DER (RSA-2048)
//   org key      = RSA-OAEP(organization.key, private key)    → 64 bytes (type 4: SHA-1, type 3: SHA-256)
//   item fields  = decrypt(field, item key ?? org key)
// An EncString of type 2 is "2.<iv>|<data>|<mac>" (base64): AES-256-CBC with PKCS#7, and an HMAC-SHA256 over iv ‖ data
// that is checked (in constant time) BEFORE anything is decrypted. Types 0 and 1 (no MAC, or AES-128) are refused.
import crypto from 'node:crypto';

export class VaultCryptoError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new VaultCryptoError(code); };

export const KDF = Object.freeze({ PBKDF2: 0, ARGON2ID: 1 });
// Bitwarden's own limits for a KDF (anything outside them is refused: a hostile server could ask for 1 iteration).
const LIMITS = { pbkdf2Min: 5000, pbkdf2Max: 2_000_000, argonPassesMin: 2, argonPassesMax: 10, argonMemMin: 15, argonMemMax: 1024, argonLanesMin: 1, argonLanesMax: 16 };

// ---- Argon2id needs Node 24.7 or later (node:crypto argon2Sync). With an older Node, a clear refusal.
export const argon2Available = () => typeof crypto.argon2Sync === 'function';

export const normEmail = (email) => String(email ?? '').trim().toLowerCase();

// The KDF settings of an account, from the token response (Kdf, KdfIterations…) or prelogin (kdf, kdfIterations…).
export function kdfOf(o = {}) {
  const pick = (a, b) => (o[a] ?? o[b]);
  const type = Number(pick('Kdf', 'kdf') ?? 0);
  const iterations = Number(pick('KdfIterations', 'kdfIterations') ?? 0);
  const memory = pick('KdfMemory', 'kdfMemory'); const parallelism = pick('KdfParallelism', 'kdfParallelism');
  return { type, iterations, memory: memory == null ? null : Number(memory), parallelism: parallelism == null ? null : Number(parallelism) };
}

export function checkKdf(kdf) {
  const { type, iterations, memory, parallelism } = kdf ?? {};
  const intIn = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
  if (type === KDF.PBKDF2) { if (!intIn(iterations, LIMITS.pbkdf2Min, LIMITS.pbkdf2Max)) fail('bad_kdf'); return; }
  if (type === KDF.ARGON2ID) {
    if (!intIn(iterations, LIMITS.argonPassesMin, LIMITS.argonPassesMax) || !intIn(memory, LIMITS.argonMemMin, LIMITS.argonMemMax) || !intIn(parallelism, LIMITS.argonLanesMin, LIMITS.argonLanesMax)) fail('bad_kdf');
    if (!argon2Available()) fail('argon2_unsupported');
    return;
  }
  fail('bad_kdf');
}

// The master key (32 bytes). password: string; email: the account's e-mail (the salt).
export function masterKey(password, email, kdf) {
  checkKdf(kdf);
  const pw = Buffer.from(String(password ?? ''), 'utf8');
  if (!pw.length) fail('no_password');
  const salt = normEmail(email);
  if (!salt) fail('no_email');
  if (kdf.type === KDF.PBKDF2) return crypto.pbkdf2Sync(pw, Buffer.from(salt, 'utf8'), kdf.iterations, 32, 'sha256');
  return Buffer.from(crypto.argon2Sync('argon2id', {
    message: pw, nonce: crypto.createHash('sha256').update(salt, 'utf8').digest(),
    parallelism: kdf.parallelism, tagLength: 32, memory: kdf.memory * 1024, passes: kdf.iterations
  }));
}

// HKDF-Expand (RFC 5869 §2.3) with SHA-256: Bitwarden uses the master key directly as the PRK (no extract step).
export function hkdfExpand(prk, info, length) {
  const out = []; let prev = Buffer.alloc(0); let total = 0;
  for (let i = 1; total < length; i++) {
    prev = crypto.createHmac('sha256', prk).update(Buffer.concat([prev, Buffer.isBuffer(info) ? info : Buffer.from(String(info), 'utf8'), Buffer.from([i])])).digest();
    out.push(prev); total += prev.length;
  }
  return Buffer.concat(out).subarray(0, length);
}

// A symmetric key as Bitwarden keeps it: 32 bytes for AES-256 and 32 for HMAC-SHA256.
export const symKey = (buf64) => {
  const b = Buffer.from(buf64);
  if (b.length !== 64) fail('bad_key');
  return { enc: b.subarray(0, 32), mac: b.subarray(32, 64) };
};
export const stretch = (master) => ({ enc: hkdfExpand(master, 'enc', 32), mac: hkdfExpand(master, 'mac', 32) });
export const keyBytes = (k) => Buffer.concat([k.enc, k.mac]);

const b64 = (s) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) fail('bad_encstring');
  return Buffer.from(s, 'base64');
};

// "2.iv|data|mac" → { type, iv, data, mac }; "4.data" → { type, data }.
export function parseEncString(s) {
  const m = /^(\d+)\.(.+)$/s.exec(String(s ?? ''));
  if (!m) fail('bad_encstring'); // the old form with no type (type 0 without MAC) is never accepted
  const type = Number(m[1]); const parts = m[2].split('|');
  if (type === 2) {
    if (parts.length !== 3) fail('bad_encstring');
    const [iv, data, mac] = parts.map(b64);
    if (iv.length !== 16 || mac.length !== 32 || !data.length || data.length % 16) fail('bad_encstring');
    return { type, iv, data, mac };
  }
  if (type === 3 || type === 4) { if (parts.length !== 1) fail('bad_encstring'); return { type, data: b64(parts[0]) }; }
  return fail('unsupported_encstring');
}

// Decrypts a type-2 EncString with a symmetric key { enc, mac }. The MAC is checked first; a wrong one throws bad_mac.
export function decrypt(s, key) {
  const e = typeof s === 'string' ? parseEncString(s) : s;
  if (e.type !== 2) fail('unsupported_encstring');
  if (!key?.enc || !key?.mac) fail('bad_key');
  const want = crypto.createHmac('sha256', key.mac).update(Buffer.concat([e.iv, e.data])).digest();
  if (!crypto.timingSafeEqual(want, e.mac)) fail('bad_mac');
  try {
    const d = crypto.createDecipheriv('aes-256-cbc', key.enc, e.iv);
    return Buffer.concat([d.update(e.data), d.final()]);
  } catch { return fail('bad_padding'); }
}
export const decryptText = (s, key) => (s == null || s === '' ? null : decrypt(s, key).toString('utf8'));

// The other way (fixtures and tests only: Orb never writes to a vault).
export function encrypt(plain, key, iv = crypto.randomBytes(16)) {
  const c = crypto.createCipheriv('aes-256-cbc', key.enc, iv);
  const data = Buffer.concat([c.update(Buffer.from(plain)), c.final()]);
  const mac = crypto.createHmac('sha256', key.mac).update(Buffer.concat([iv, data])).digest();
  return `2.${iv.toString('base64')}|${data.toString('base64')}|${mac.toString('base64')}`;
}

// RSA-OAEP (type 4: SHA-1, Bitwarden's org keys; type 3: SHA-256) with the user's private key (PKCS#8 DER).
export function rsaDecrypt(s, privateKeyDer) {
  const e = typeof s === 'string' ? parseEncString(s) : s;
  if (e.type !== 3 && e.type !== 4) fail('unsupported_encstring');
  let key; try { key = crypto.createPrivateKey({ key: Buffer.from(privateKeyDer), format: 'der', type: 'pkcs8' }); } catch { return fail('bad_private_key'); }
  try { return crypto.privateDecrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: e.type === 4 ? 'sha1' : 'sha256' }, e.data); } catch { return fail('bad_rsa'); }
}
export function rsaEncrypt(plain, publicKeyDer, type = 4) {
  const key = crypto.createPublicKey({ key: Buffer.from(publicKeyDer), format: 'der', type: 'spki' });
  return `${type}.${crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: type === 4 ? 'sha1' : 'sha256' }, Buffer.from(plain)).toString('base64')}`;
}

// The whole unlock: master password + account data → the user key, the private key and the organizations' keys.
// account: { email, kdf, key (profile.key), privateKey (profile.privateKey), organizations: [{ id, key }] }.
export function unlock(password, account) {
  const master = masterKey(password, account.email, account.kdf);
  let userKey;
  try { userKey = symKey(decrypt(account.key, stretch(master))); } catch (error) { throw error?.code === 'bad_mac' ? new VaultCryptoError('wrong_password') : error; } finally { master.fill(0); }
  const priv = account.privateKey ? decrypt(account.privateKey, userKey) : null;
  const orgs = new Map();
  for (const o of account.organizations ?? []) {
    if (!o?.id || !o?.key || !priv) continue;
    try { orgs.set(String(o.id), symKey(rsaDecrypt(o.key, priv))); } catch { /* an org whose key does not open is skipped */ }
  }
  if (priv) priv.fill(0);
  return { userKey, orgs };
}

// ---- sealing what Orb Server keeps (the vault's sign-in and the sync cache) with the server's own key.
// The worker never gets the server key itself: only this key, derived from it for the vault alone.
export const vaultSealKey = (serverSecret) => crypto.createHmac('sha256', Buffer.from(serverSecret)).update('orb-vault-v1').digest();
// 3.7: with the vault's own key file (keyfile.mjs, outside the data folder) mixed in: both are needed to open the seal.
// The v1 key (server key alone) is only used to read, once, what an earlier build sealed, which is sealed again with this.
export const vaultSealKeyV2 = (serverSecret, fileKey) => crypto.createHmac('sha256', Buffer.from(serverSecret)).update('orb-vault-v2').update(Buffer.from(fileKey)).digest();
export function seal(key, value, aad) {
  const n = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, n); c.setAAD(Buffer.from(String(aad)));
  const data = Buffer.concat([c.update(Buffer.from(JSON.stringify(value), 'utf8')), c.final()]);
  return { v: 1, n: n.toString('base64'), c: data.toString('base64'), t: c.getAuthTag().toString('base64') };
}
export function open(key, box, aad) {
  if (box?.v !== 1) fail('bad_seal');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.n, 'base64')); d.setAAD(Buffer.from(String(aad))); d.setAuthTag(Buffer.from(box.t, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(box.c, 'base64')), d.final()]).toString('utf8'));
  } catch { return fail('bad_seal'); }
}
