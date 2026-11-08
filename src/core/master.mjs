// 3.8: the master password and the secrets Orb keeps for itself. No engine imports: the engine (src/engine/api-master.mjs),
// the backups and the tests use it directly.
//
// One random data key (32 bytes) encrypts every secret Orb stores (the PC's key for the phones, the connectors' keys).
// The data key is never on disk in clear; it is kept twice, in core\secretos:
//   maestra.json     wrapped by a key made from the master password (scrypt, its own salt): opens on any PC
//   maestra-pc.json  wrapped by a key derived from this PC's secret, the one Windows keeps sealed (DPAPI through Electron's
//                    safeStorage in the main process, core\datos\clave.enc): Orb starts without asking for the password.
//                    It also says (authenticated) that a password was made, so a deleted maestra.json is noticed.
//   secretos.json    the secrets themselves, one JSON map sealed with the data key. It holds the phones' verifier of the
//                    password too (Magic Link never sends the password: src/core/mobile-crypto.mjs › linkDevice).
//   intentos.json    wrong passwords so far, per channel (this PC's window, the phones' linking, the recovery code):
//                    growing waits. When it cannot be written no password is checked at all (fail closed).
// The password is never stored. Every wrap names the data key it holds (keyId, an HMAC of the key) in its additional data,
// and a password only counts when it opens THE data key this PC already has (compared in constant time): a maestra.json
// from elsewhere, or made by someone else with their own password, opens nothing here.
// Changing the password wraps the same data key again. Forgetting it (with the backups' recovery code) makes a new data key
// and encrypts the secrets again; starting from scratch (without the code) deletes them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { verifierFromSeed, PAIR_KDF, b64 as b64url } from './mobile-crypto.mjs';

export const FILES = { master: 'maestra.json', machine: 'maestra-pc.json', vault: 'secretos.json', tries: 'intentos.json' };
// What a backup and the copy outside core take (the tries are this PC's only).
export const KEPT = [FILES.master, FILES.machine, FILES.vault];
export const MIN_LENGTH = 10;
export const MAX_LENGTH = 256;
export const UNLOCK_MS = 5 * 60_000;
export const FRESH_MS = 2 * 60_000; // a token for one action that asks for the password every time (issue(purpose))
// Wrong passwords: after five in a row, 30 s of wait, and twice as long after each new one (15 min at most).
export const FREE_TRIES = 5;
const WAIT_FIRST_S = 30;
const WAIT_MAX_S = 15 * 60;
export const CHANNELS = ['pc', 'pair', 'recovery'];
// scrypt: N = 2^17, r = 8 (128 MB, about a third of a second on a modest laptop). A test run uses a cheap one (the cost
// is kept in maestra.json, so a password made either way opens the same way).
export const KDF = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });
const TEST_KDF = Object.freeze({ N: 2 ** 12, r: 8, p: 1 });
const testRun = () => Boolean(process.env.NODE_TEST_CONTEXT);
export const kdfCost = () => (testRun() ? TEST_KDF : KDF);
const pairCost = () => (testRun() ? { N: 2 ** 11, r: 8, p: 1 } : PAIR_KDF);
// The vault's own entries (never a connector's key).
export const PAIR_ID = 'master/pair';
const HAD_ID = 'master/had';

export class MasterError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (text) => new Uint8Array(Buffer.from(String(text ?? ''), 'base64'));
const seal = (key, bytes, aad) => { const nonce = crypto.randomBytes(24); return b64(Buffer.concat([nonce, xchacha20poly1305(key, nonce, Buffer.from(aad)).encrypt(bytes)])); };
const unseal = (key, box, aad) => { const raw = unb64(box); if (raw.length < 24 + 16) throw new Error('box'); return xchacha20poly1305(key, raw.subarray(0, 24), Buffer.from(aad)).decrypt(raw.subarray(24)); };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const same = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// Which data key a wrap holds (never the key itself).
export const keyIdOf = (dek) => crypto.createHmac('sha256', Buffer.from(dek)).update('orb-key-id').digest().subarray(0, 16).toString('base64');
const AAD = {
  password: (keyId) => `orb-master:password|${keyId}`,
  machine: (keyId, had) => `orb-master:machine|${keyId}|${had ? 'password' : 'none'}`,
  vault: (keyId) => `orb-secretos-v2|${keyId}`
};

// A password as typed: NFC, nothing trimmed (spaces count). → the string, or a MasterError('short' | 'long').
export function checkPassword(password) {
  if (typeof password !== 'string') throw new MasterError('short');
  const p = password.normalize('NFC');
  const n = [...p].length;
  if (n < MIN_LENGTH) throw new MasterError('short');
  if (n > MAX_LENGTH) throw new MasterError('long');
  return p;
}

// The cost a maestra.json may ask for: a file someone left there can neither make it cheap nor hang the engine.
export function kdfOk(kdf) {
  if (!kdf || typeof kdf !== 'object') return false;
  const { N, r, p, salt } = kdf;
  const s = Buffer.from(String(salt ?? ''), 'base64');
  return Number.isInteger(N) && N >= (testRun() ? 2 ** 10 : 2 ** 15) && N <= 2 ** 20 && (N & (N - 1)) === 0 && r === 8 && p === 1 && s.length === 16;
}
const scrypt = (password, salt, { N, r, p }) => new Promise((resolve, reject) => {
  crypto.scrypt(String(password).normalize('NFC'), salt, 32, { N, r, p, maxmem: 1200 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(new Uint8Array(key))));
});
// The key made from the password (async: scrypt runs off the engine's main thread).
export function passwordKey(password, kdf) {
  if (!kdfOk(kdf)) return Promise.reject(new MasterError('damaged'));
  return scrypt(password, Buffer.from(kdf.salt, 'base64'), kdf);
}
// The phones' verifier of a password: { kdf, pub } (the private half is never kept).
export async function pairVerifier(password, kdf = { ...pairCost(), salt: b64url.enc(crypto.randomBytes(16)) }) {
  const seed = await scrypt(password, b64url.dec(kdf.salt), kdf);
  return { kdf, pub: b64url.enc(verifierFromSeed(seed).pub) };
}
const checkOf = (kek) => crypto.createHmac('sha256', Buffer.from(kek)).update('orb-master-check-v1').digest();
export const machineKey = (secret) => new Uint8Array(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('orb-master'), Buffer.from('machine-v1'), 32));
const waitSeconds = (fails) => Math.min(WAIT_FIRST_S * 2 ** Math.max(0, fails - FREE_TRIES), WAIT_MAX_S);

// dir: core\secretos. secret: this PC's secret (Buffer, 32 bytes or more), or null when there is none.
export class Master {
  constructor(dir, { secret = null, now = () => Date.now() } = {}) {
    this.dir = dir; this.secret = secret && secret.length >= 32 ? Buffer.from(secret) : null; this.now = now;
    this.dek = null; this.keyId = null; this.items = null; this.tokens = new Map(); this.busy = Promise.resolve();
    this.fails = {}; // per channel, in memory too: a tries file put back or emptied does not give tries back
    this.hadMachine = false; // the machine wrap said a password had been made
    this.onChange = () => {};
    this.onFails = () => {}; // (channel, fails): FREE_TRIES wrong ones in a row (the engine tells the owner)
  }
  file(name) { return path.join(this.dir, name); }
  hasPassword() { return Boolean(readJson(this.file(FILES.master))?.wrapped); }
  unlocked() { return Boolean(this.dek); }
  // Whether a password was ever made in this workspace (its file may be gone): the vault and the machine wrap say so.
  hadPassword() {
    if (this.hadMachine) return true;
    if (!this.dek) return false;
    try { return Boolean(this.readVault()[HAD_ID]); } catch { return true; } // a vault that does not open: assume so
  }
  state() {
    const m = readJson(this.file(FILES.master));
    const file = Boolean(m?.wrapped);
    const had = file || this.hadPassword() || readJson(this.file(FILES.machine))?.password === true;
    return { exists: had, lost: had && !file, locked: !this.dek, changedAt: m?.changed ?? m?.created ?? null };
  }

  // At the engine's start: the data key from this PC's wrap. A workspace without any (new, or of 3.7) gets a new one, so
  // its secrets are encrypted from the first start; the password wraps it when it is made. → true when it is open.
  openWithMachine() {
    if (this.dek) return true;
    const pc = readJson(this.file(FILES.machine));
    if (pc?.wrapped && this.secret) {
      try {
        const key = unseal(machineKey(this.secret), pc.wrapped, AAD.machine(pc.keyId, pc.password === true));
        if (keyIdOf(key) === pc.keyId) { this.useKey(key); this.hadMachine = pc.password === true; return true; }
      } catch { /* another PC or another Windows user */ }
    }
    // Something to open with the password, or this PC's wrap that did not open (never replaced by a new key in silence).
    if (pc || this.hasPassword() || fs.existsSync(this.file(FILES.vault))) return false;
    this.useKey(crypto.randomBytes(32));
    this.writeVault({});
    this.sealForMachine();
    return true;
  }
  useKey(key) { this.dek = new Uint8Array(key); this.keyId = keyIdOf(this.dek); this.items = null; }
  sealForMachine() {
    if (!this.dek || !this.secret) return false;
    const had = this.hadPassword();
    writeFile(this.file(FILES.machine), { v: 2, keyId: this.keyId, password: had, wrapped: seal(machineKey(this.secret), this.dek, AAD.machine(this.keyId, had)) });
    this.hadMachine = had;
    this.onChange();
    return true;
  }
  // The password's wrap, the phones' verifier and the mark «there is a password» (in the vault and the machine wrap).
  async wrapWithPassword(password, { created = null } = {}) {
    const kdf = { alg: 'scrypt', ...kdfCost(), salt: b64(crypto.randomBytes(16)) };
    const kek = await passwordKey(password, kdf);
    const verifier = await pairVerifier(password);
    const at = new Date(this.now()).toISOString();
    this.writeVault({ ...this.readVault(), [PAIR_ID]: verifier, [HAD_ID]: { at } });
    writeFile(this.file(FILES.master), { v: 2, keyId: this.keyId, kdf, check: b64(checkOf(kek)), wrapped: seal(kek, this.dek, AAD.password(this.keyId)), created: created ?? at, changed: at });
    this.sealForMachine();
    this.onChange();
  }
  // One change at a time (two windows' clicks, a phone linking while the password changes).
  serial(fn) { const run = this.busy.then(fn, fn); this.busy = run.catch(() => {}); return run; }

  // The first password (the welcome, or the first start of 3.8). Needs the data key open (it always is the first time).
  // Never a second time: when maestra.json is gone but a password was made, it comes back from the copy outside core or
  // through «He olvidado la contraseña» (the recovery code) or «Borrar secretos y empezar de cero».
  create(password) {
    return this.serial(async () => {
      const p = checkPassword(password);
      if (this.hasPassword()) throw new MasterError('exists');
      if (!this.dek && !this.openWithMachine()) throw new MasterError('locked');
      if (this.hadPassword()) throw new MasterError('lost');
      await this.wrapWithPassword(p);
      return true;
    });
  }

  // ---- the waits. channel: 'pc' (this PC's window), 'pair' (a phone linking), 'recovery' (the backups' recovery code).
  // An unreadable tries file counts as the most fails there can be (someone put it there).
  tries() {
    let raw; try { raw = fs.readFileSync(this.file(FILES.tries), 'utf8'); } catch (error) { return error.code === 'ENOENT' ? {} : null; }
    try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
  }
  failsOf(channel) { const t = this.tries(); return Math.max(this.fails[channel] ?? 0, t ? Number(t[channel]?.fails ?? 0) || 0 : FREE_TRIES + 5); }
  waitOf(channel) {
    const t = this.tries();
    let until = t?.[channel]?.until ? Date.parse(t[channel].until) : 0;
    if (!t) { try { until = fs.statSync(this.file(FILES.tries)).mtimeMs + WAIT_MAX_S * 1000; } catch { until = this.now() + WAIT_MAX_S * 1000; } }
    if (this.fails[`${channel}:until`] > until) until = this.fails[`${channel}:until`];
    return until > this.now() ? until : 0;
  }
  // → false when it could not be written (the caller refuses the try: fail closed).
  noteTry(channel, ok) {
    const all = this.tries() ?? {};
    if (ok) { delete all[channel]; this.fails[channel] = 0; this.fails[`${channel}:until`] = 0; }
    else {
      const fails = this.failsOf(channel) + 1;
      const until = fails >= FREE_TRIES ? this.now() + waitSeconds(fails) * 1000 : 0;
      this.fails[channel] = fails; this.fails[`${channel}:until`] = until;
      all[channel] = { fails, until: until ? new Date(until).toISOString() : null };
      if (fails % FREE_TRIES === 0) { try { this.onFails(channel, fails); } catch { /* only a notice */ } }
    }
    try { writeFile(this.file(FILES.tries), all); return true; } catch { return false; }
  }
  // Whether the tries file can be written right now (it is written again as it is).
  canCount() { const t = this.tries(); if (!t) return false; try { writeFile(this.file(FILES.tries), t); return true; } catch { return false; } }
  // One try on a channel, with its waits: check() → true when right. → { ok: true } | { ok: false, reason: 'wrong', left,
  // until? } | { ok: false, reason: 'wait', until } | { ok: false, reason: 'tries' } (the count cannot be kept: refused).
  attempt(channel, check) {
    return this.serial(async () => {
      const until = this.waitOf(channel);
      if (until) return { ok: false, reason: 'wait', until: new Date(until).toISOString() };
      if (!this.canCount()) return { ok: false, reason: 'tries' };
      let ok = false; try { ok = Boolean(await check()); } catch { ok = false; }
      if (!this.noteTry(channel, ok) && !ok) return { ok: false, reason: 'tries' };
      if (ok) return { ok: true };
      const fails = this.failsOf(channel);
      const wait = this.waitOf(channel);
      return { ok: false, reason: 'wrong', left: Math.max(0, FREE_TRIES - fails), ...(wait ? { until: new Date(wait).toISOString() } : {}) };
    });
  }

  // The data key in maestra.json for this password, or null. Only THE data key counts: one this PC has already (compared
  // in constant time), or, on a PC that has none open yet, one whose id matches its wrap.
  async keyFor(password) {
    const m = readJson(this.file(FILES.master));
    if (!m?.wrapped || typeof m.keyId !== 'string' || typeof password !== 'string' || !password.length || password.length > MAX_LENGTH * 4) return null;
    const kek = await passwordKey(password, m.kdf);
    if (!same(Buffer.from(String(m.check ?? ''), 'base64'), checkOf(kek))) return null;
    const key = unseal(kek, m.wrapped, AAD.password(m.keyId));
    if (keyIdOf(key) !== m.keyId) return null;
    if (this.dek) return same(key, this.dek) ? key : null;
    // Nothing open yet: the key must open the secrets that are here (a maestra.json brought from elsewhere does not).
    const v = readJson(this.file(FILES.vault));
    if (v?.box) { try { unseal(key, v.box, AAD.vault(keyIdOf(key))); } catch { return null; } }
    return key;
  }
  // → { ok: true } | the refusals of attempt() | { ok: false, reason: 'none' } (no password made, or its file is gone).
  // A right password also opens a data key this PC could not open by itself (another PC, a backup restored) and wraps it
  // for this PC again.
  async verify(password, channel = 'pc') {
    if (!this.hasPassword()) return { ok: false, reason: 'none' };
    let key = null;
    const r = await this.attempt(channel, async () => { key = await this.keyFor(password); return Boolean(key); });
    if (!r.ok) return r;
    await this.serial(async () => {
      if (!this.dek) { this.useKey(key); this.hadMachine = true; this.sealForMachine(); }
      // A password made before the phones' verifier existed gets it now.
      try { if (!this.readVault()[PAIR_ID]) this.writeVault({ ...this.readVault(), [PAIR_ID]: await pairVerifier(password.normalize('NFC')) }); } catch { /* a damaged vault says so where it is read */ }
    });
    return { ok: true };
  }

  // ---- the window's unlock: a token for 5 minutes (memory only), dropped when the window locks or closes.
  // 3.8.1: purpose: a token for ONE action that always asks for the password again (FRESH_UNLOCK in
  // src/core/permissions.mjs, e.g. deleting a project): it lasts FRESH_MS and opens nothing else, and a token of the
  // usual 5 minutes does not open that action.
  issue(purpose = null) {
    for (const [k, t] of this.tokens) if (t.until <= this.now()) this.tokens.delete(k);
    const token = crypto.randomBytes(24).toString('hex');
    const until = this.now() + (purpose ? FRESH_MS : UNLOCK_MS);
    this.tokens.set(token, { until, purpose: purpose ?? null });
    return { unlock: token, until };
  }
  checkToken(token, purpose = null) {
    const t = typeof token === 'string' ? this.tokens.get(token) : null;
    return Boolean(t && t.until > this.now() && t.purpose === (purpose ?? null));
  }
  lock() { this.tokens.clear(); }

  // Changing it: the current one first (the same waits as any other check). The data key stays (only wrapped again).
  async change(current, next) {
    const p = checkPassword(next);
    const r = await this.verify(current, 'pc');
    if (!r.ok) return r;
    await this.serial(() => this.wrapWithPassword(p, { created: readJson(this.file(FILES.master))?.created ?? null }));
    this.lock();
    return { ok: true };
  }
  // «He olvidado la contraseña» (the caller checked the backups' recovery code): a NEW data key, the secrets encrypted
  // again with it (keep: which ones stay; the caller drops this PC's keys for the phones), and the new password. Old
  // copies of maestra.json (in backups, in old copies of the folder) no longer open anything current.
  forgot(next, { keep = () => true } = {}) {
    return this.serial(async () => {
      const p = checkPassword(next);
      if (!this.dek) throw new MasterError('locked');
      const items = Object.fromEntries(Object.entries(this.readVault()).filter(([id]) => keep(id)));
      this.useKey(crypto.randomBytes(32));
      this.writeVault(items);
      await this.wrapWithPassword(p);
      fs.rmSync(this.file(FILES.tries), { force: true }); this.fails = {};
      this.lock();
      return { ok: true };
    });
  }
  // «Borrar secretos y empezar de cero» (without the recovery code): the sealed files go (here; the caller's onChange takes
  // them out of the copy outside core too; backups are never touched), a new data key, an empty vault and the new password.
  reset(next) {
    return this.serial(async () => {
      const p = checkPassword(next);
      for (const f of KEPT) fs.rmSync(this.file(f), { force: true });
      this.hadMachine = false;
      this.useKey(crypto.randomBytes(32));
      this.writeVault({});
      await this.wrapWithPassword(p);
      fs.rmSync(this.file(FILES.tries), { force: true }); this.fails = {};
      this.lock();
      return { ok: true };
    });
  }

  // ---- the secrets (needs the data key open)
  readVault() {
    if (!this.dek) throw new MasterError('locked');
    if (this.items) return this.items;
    const v = readJson(this.file(FILES.vault));
    if (!v?.box) { this.items = {}; return this.items; }
    let items; try { items = JSON.parse(Buffer.from(unseal(this.dek, v.box, AAD.vault(this.keyId))).toString('utf8')); } catch { throw new MasterError('damaged'); }
    this.items = items && typeof items === 'object' && !Array.isArray(items) ? items : {};
    return this.items;
  }
  writeVault(items) {
    if (!this.dek) throw new MasterError('locked');
    writeFile(this.file(FILES.vault), { v: 2, keyId: this.keyId, box: seal(this.dek, Buffer.from(JSON.stringify(items)), AAD.vault(this.keyId)) });
    this.items = items;
    this.onChange();
  }
  get(id) { const v = this.readVault()[id]; return v === undefined ? null : structuredClone(v); }
  set(id, value) { const items = { ...this.readVault() }; if (value === null || value === undefined) delete items[id]; else items[id] = structuredClone(value); this.writeVault(items); }
  ids(prefix = '') { return Object.keys(this.readVault()).filter((k) => k.startsWith(prefix)); }
}

// The copy outside core (this app's data folder, next to the copy of clave.enc): what is missing in core\secretos comes
// back from it before anything opens; after every change it is written again. What it brings back proves nothing by
// itself: a password only counts when it opens the data key this PC has (Master › keyFor).
export function mirrorTo(dir, mirror) {
  if (!mirror) return 0;
  let n = 0;
  fs.mkdirSync(mirror, { recursive: true });
  for (const name of KEPT) {
    const from = path.join(dir, name); const to = path.join(mirror, name);
    if (fs.existsSync(from)) { fs.copyFileSync(from, `${to}.tmp`); fs.renameSync(`${to}.tmp`, to); n++; }
    else fs.rmSync(to, { force: true });
  }
  return n;
}
export function restoreMissing(dir, mirror) {
  if (!mirror || !fs.existsSync(mirror)) return [];
  const back = [];
  for (const name of KEPT) {
    const from = path.join(mirror, name); const to = path.join(dir, name);
    if (fs.existsSync(from) && !fs.existsSync(to)) { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(from, to); back.push(name); }
  }
  return back;
}
