// 3.8: the master password and the secrets Orb keeps for itself. No engine imports: the engine (src/engine/api-master.mjs),
// the backups and the tests use it directly.
//
// One random data key (32 bytes) encrypts every secret Orb stores (the PC's key for the phones, the connectors' keys).
// The data key is never on disk in clear; it is kept twice, in core\secretos:
//   maestra.json     wrapped by a key made from the master password (scrypt, its own salt): opens on any PC
//   maestra-pc.json  wrapped by a key derived from this PC's secret, the one Windows keeps sealed (DPAPI through Electron's
//                    safeStorage in the main process, core\datos\clave.enc): Orb starts without asking for the password
//   secretos.json    the secrets themselves, one JSON map sealed with the data key
//   intentos.json    wrong passwords so far, per channel (this PC's window, the phones' pairing): growing waits
// The password is never stored. It is checked by an HMAC of the password's key (compared in constant time) and by the
// wrap itself (an authenticated cipher). Changing it wraps the same data key again: nothing else is encrypted again.
// The wraps use XChaCha20-Poly1305 with additional data naming what each one is, so one cannot be passed for another.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

export const FILES = { master: 'maestra.json', machine: 'maestra-pc.json', vault: 'secretos.json', tries: 'intentos.json' };
// What a backup and the copy outside core take (the tries are this PC's only).
export const KEPT = [FILES.master, FILES.machine, FILES.vault];
export const MIN_LENGTH = 8;
export const MAX_LENGTH = 256;
export const UNLOCK_MS = 5 * 60_000;
// Wrong passwords: after five in a row, 30 s of wait, and twice as long after each new one (15 min at most).
export const FREE_TRIES = 5;
const WAIT_FIRST_S = 30;
const WAIT_MAX_S = 15 * 60;
export const CHANNELS = ['pc', 'pair'];
// scrypt: N = 2^17, r = 8 (128 MB, about a third of a second on a modest laptop). A test run uses a cheap one (the cost
// is kept in maestra.json, so a password made either way opens the same way).
export const KDF = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });
const TEST_KDF = Object.freeze({ N: 2 ** 12, r: 8, p: 1 });
export const kdfCost = () => (process.env.NODE_TEST_CONTEXT ? TEST_KDF : KDF);

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

// A password as typed: NFC, nothing trimmed (spaces count). → the string, or a MasterError('short' | 'long').
export function checkPassword(password) {
  if (typeof password !== 'string') throw new MasterError('short');
  const p = password.normalize('NFC');
  const n = [...p].length;
  if (n < MIN_LENGTH) throw new MasterError('short');
  if (n > MAX_LENGTH) throw new MasterError('long');
  return p;
}

// The key made from the password (async: scrypt runs off the engine's main thread).
export function passwordKey(password, kdf) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(new Uint8Array(key))));
  });
}
const checkOf = (kek) => crypto.createHmac('sha256', Buffer.from(kek)).update('orb-master-check-v1').digest();
export const machineKey = (secret) => new Uint8Array(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('orb-master'), Buffer.from('machine-v1'), 32));
const waitSeconds = (fails) => Math.min(WAIT_FIRST_S * 2 ** Math.max(0, fails - FREE_TRIES), WAIT_MAX_S);

// dir: core\secretos. secret: this PC's secret (Buffer, 32 bytes or more), or null when there is none.
export class Master {
  constructor(dir, { secret = null, now = () => Date.now() } = {}) {
    this.dir = dir; this.secret = secret && secret.length >= 32 ? Buffer.from(secret) : null; this.now = now;
    this.dek = null; this.items = null; this.tokens = new Map(); this.busy = Promise.resolve();
    this.onChange = () => {};
  }
  file(name) { return path.join(this.dir, name); }
  hasPassword() { return Boolean(readJson(this.file(FILES.master))?.wrapped); }
  unlocked() { return Boolean(this.dek); }
  state() { const m = readJson(this.file(FILES.master)); return { exists: Boolean(m?.wrapped), locked: !this.dek, changedAt: m?.changed ?? m?.created ?? null }; }

  // At the engine's start: the data key from this PC's wrap. A workspace without any (new, or of 3.7) gets a new one, so
  // its secrets are encrypted from the first start; the password wraps it when it is made. → true when it is open.
  openWithMachine() {
    if (this.dek) return true;
    const pc = readJson(this.file(FILES.machine));
    if (pc?.wrapped && this.secret) {
      try { this.useKey(unseal(machineKey(this.secret), pc.wrapped, 'orb-master:machine')); return true; } catch { /* another PC or another Windows user */ }
    }
    if (this.hasPassword() || fs.existsSync(this.file(FILES.vault))) return false; // the password opens it (unlock)
    this.useKey(crypto.randomBytes(32));
    this.writeVault({});
    this.sealForMachine();
    return true;
  }
  useKey(key) { this.dek = new Uint8Array(key); this.items = null; }
  sealForMachine() {
    if (!this.dek || !this.secret) return false;
    writeFile(this.file(FILES.machine), { v: 1, wrapped: seal(machineKey(this.secret), this.dek, 'orb-master:machine') });
    this.onChange();
    return true;
  }
  async wrapWithPassword(password, { created = null } = {}) {
    const kdf = { alg: 'scrypt', ...kdfCost(), salt: b64(crypto.randomBytes(16)) };
    const kek = await passwordKey(password, kdf);
    const at = new Date(this.now()).toISOString();
    writeFile(this.file(FILES.master), { v: 1, kdf, check: b64(checkOf(kek)), wrapped: seal(kek, this.dek, 'orb-master:password'), created: created ?? at, changed: at });
    this.onChange();
  }
  // One change at a time (two windows' clicks, a phone pairing while the password changes).
  serial(fn) { const run = this.busy.then(fn, fn); this.busy = run.catch(() => {}); return run; }

  // The first password (the welcome, or the first start of 3.8). Needs the data key open (it always is the first time).
  create(password) {
    return this.serial(async () => {
      const p = checkPassword(password);
      if (this.hasPassword()) throw new MasterError('exists');
      if (!this.dek && !this.openWithMachine()) throw new MasterError('locked');
      await this.wrapWithPassword(p);
      return true;
    });
  }

  // ---- checking a password, with the waits. channel: 'pc' (this PC's window) or 'pair' (a phone linking).
  tries() { return readJson(this.file(FILES.tries)) ?? {}; }
  waitOf(channel) { const t = this.tries()[channel]; const until = t?.until ? Date.parse(t.until) : 0; return until > this.now() ? until : 0; }
  noteTry(channel, ok) {
    const all = this.tries();
    if (ok) { if (!all[channel]) return; delete all[channel]; }
    else {
      const fails = Number(all[channel]?.fails ?? 0) + 1;
      all[channel] = { fails, until: fails >= FREE_TRIES ? new Date(this.now() + waitSeconds(fails) * 1000).toISOString() : null };
    }
    try { writeFile(this.file(FILES.tries), all); } catch { /* counted in memory only this time */ }
  }
  // → { ok: true } | { ok: false, reason: 'wrong', left, until? } | { ok: false, reason: 'wait', until } | { ok: false, reason: 'none' }.
  // A right password also opens a data key this PC could not open by itself (another PC, a backup restored) and wraps it
  // for this PC again.
  verify(password, channel = 'pc') {
    return this.serial(async () => {
      const m = readJson(this.file(FILES.master));
      if (!m?.wrapped) return { ok: false, reason: 'none' };
      const until = this.waitOf(channel);
      if (until) return { ok: false, reason: 'wait', until: new Date(until).toISOString() };
      let key = null;
      if (typeof password === 'string' && password.length && password.length <= MAX_LENGTH * 4) {
        try {
          const kek = await passwordKey(password, m.kdf);
          const want = Buffer.from(String(m.check ?? ''), 'base64');
          const got = checkOf(kek);
          if (want.length === got.length && crypto.timingSafeEqual(want, got)) key = unseal(kek, m.wrapped, 'orb-master:password');
        } catch { key = null; }
      }
      if (!key) {
        this.noteTry(channel, false);
        const fails = Number(this.tries()[channel]?.fails ?? 1);
        // This one was wrong (until: the wait it started, if any); the next ones during the wait are 'wait'.
        const wait = this.waitOf(channel);
        return { ok: false, reason: 'wrong', left: Math.max(0, FREE_TRIES - fails), ...(wait ? { until: new Date(wait).toISOString() } : {}) };
      }
      this.noteTry(channel, true);
      if (!this.dek) { this.useKey(key); this.sealForMachine(); }
      return { ok: true };
    });
  }

  // ---- the window's unlock: a token for 5 minutes (memory only), dropped when the window locks or closes.
  issue() {
    for (const [k, until] of this.tokens) if (until <= this.now()) this.tokens.delete(k);
    const token = crypto.randomBytes(24).toString('hex');
    const until = this.now() + UNLOCK_MS;
    this.tokens.set(token, until);
    return { unlock: token, until };
  }
  checkToken(token) { const until = typeof token === 'string' ? this.tokens.get(token) : null; return Boolean(until && until > this.now()); }
  lock() { this.tokens.clear(); }

  // Changing it: the current one first (the same waits as any other check).
  async change(current, next) {
    const p = checkPassword(next);
    const r = await this.verify(current, 'pc');
    if (!r.ok) return r;
    await this.serial(() => this.wrapWithPassword(p, { created: readJson(this.file(FILES.master))?.created ?? null }));
    this.lock();
    return { ok: true };
  }
  // «He olvidado la contraseña», on this PC: the data key this PC opened by itself is wrapped with the new one (the caller
  // unlinks every phone). Without it (another PC, another Windows user) nothing can be opened: the secrets go and a new data
  // key starts. → { ok: true, wiped }.
  forgot(next) {
    return this.serial(async () => {
      const p = checkPassword(next);
      let wiped = false;
      if (!this.dek) {
        for (const f of [FILES.master, FILES.machine, FILES.vault]) fs.rmSync(this.file(f), { force: true });
        this.useKey(crypto.randomBytes(32));
        this.writeVault({});
        this.sealForMachine();
        wiped = true;
      }
      await this.wrapWithPassword(p);
      fs.rmSync(this.file(FILES.tries), { force: true });
      this.lock();
      return { ok: true, wiped };
    });
  }

  // ---- the secrets (needs the data key open)
  readVault() {
    if (!this.dek) throw new MasterError('locked');
    if (this.items) return this.items;
    const v = readJson(this.file(FILES.vault));
    if (!v?.box) { this.items = {}; return this.items; }
    let items; try { items = JSON.parse(Buffer.from(unseal(this.dek, v.box, 'orb-secretos-v1')).toString('utf8')); } catch { throw new MasterError('damaged'); }
    this.items = items && typeof items === 'object' && !Array.isArray(items) ? items : {};
    return this.items;
  }
  writeVault(items) {
    if (!this.dek) throw new MasterError('locked');
    writeFile(this.file(FILES.vault), { v: 1, box: seal(this.dek, Buffer.from(JSON.stringify(items)), 'orb-secretos-v1') });
    this.items = items;
    this.onChange();
  }
  get(id) { const v = this.readVault()[id]; return v === undefined ? null : structuredClone(v); }
  set(id, value) { const items = { ...this.readVault() }; if (value === null || value === undefined) delete items[id]; else items[id] = structuredClone(value); this.writeVault(items); }
  ids(prefix = '') { return Object.keys(this.readVault()).filter((k) => k.startsWith(prefix)); }
}

// The copy outside core (this app's data folder, next to the copy of clave.enc): what is missing in core\secretos comes
// back from it before anything opens; after every change it is written again.
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
