// 3.8: the master password and the secrets Orb keeps for itself. 3.8.1: all of it lives in Rust (the orb-vault crate,
// src-tauri/vault): this is only the engine's side of the channel, with the API the engine, the backups and the tests
// have always used. The engine never holds the data key, this PC's wrap key or a key made from a password: it asks for
// concrete operations (open or seal one secret, check a password, hand a connector's keys to its launcher).
//
// One random data key (32 bytes) encrypts every secret Orb stores (the PC's key for the phones, the connectors' keys).
// The data key is never on disk in clear; it is kept twice, in core\secretos:
//   maestra.json     wrapped by a key made from the master password (scrypt N=2^17 r8 p1, its own salt): opens on any PC
//   maestra-pc.json  wrapped by a key derived from this PC's secret (the approval secret Windows keeps sealed,
//                    core\datos\clave2.enc, opened in Rust: vault/src/machine.rs): Orb starts without asking for the password.
//                    It also says (authenticated) that a password was made, so a deleted maestra.json is noticed.
//   secretos.json    the secrets themselves, one JSON map sealed with the data key (XChaCha20-Poly1305). It holds the
//                    phones' verifier of the password too (Magic Link never sends the password; Rust checks the phone's
//                    key confirmation itself: pairFinish).
//   intentos.json    wrong passwords so far, per channel (this PC's window, the phones' linking, the recovery code):
//                    growing waits. When it cannot be written no password is checked at all (fail closed).
// The password is never stored. Every wrap names the data key it holds (keyId) in its additional data, and a password
// only counts when it opens THE data key this PC already has: a maestra.json from elsewhere opens nothing here.
// Changing the password wraps the same data key again. Forgetting it (with the backups' recovery code) makes a new data key
// and encrypts the secrets again; starting from scratch (without the code) deletes them.
//
// The channel: under Orb.exe a named pipe only the engine may open (ORB_VAULT_PIPE, src-tauri/src/vault_host.rs); with no
// app (the tests, a script) this process starts its own orb-vault (built by scripts/vault-build.mjs, ORB_VAULT_BIN).
// Requests are synchronous (each a few microseconds); scrypt runs as a job polled from here, so the event loop never waits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FILES = { master: 'maestra.json', machine: 'maestra-pc.json', vault: 'secretos.json', tries: 'intentos.json' };
// What a backup and the copy outside core take (the tries are this PC's only).
export const KEPT = [FILES.master, FILES.machine, FILES.vault];
export const MIN_LENGTH = 10;
export const MAX_LENGTH = 256;
export const UNLOCK_MS = 5 * 60_000;
export const FRESH_MS = 2 * 60_000; // a token for one action that asks for the password every time (issue(purpose))
export const FREE_TRIES = 5;
export const CHANNELS = ['pc', 'pair', 'recovery'];
// The vault's own entries (never a connector's key).
export const PAIR_ID = 'master/pair';
const CODES = new Set(['short', 'long', 'exists', 'lost', 'locked', 'damaged']);

export class MasterError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
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
const typed = (password) => (typeof password === 'string' ? password.normalize('NFC') : '');

// ---- the channel to Rust (one per process)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const wipe = (buf) => { try { buf.fill(0); } catch { /* not a buffer */ } };
let channel = null;

function helperPath() {
  if (process.env.ORB_VAULT_BIN) return process.env.ORB_VAULT_BIN;
  return path.join(ROOT, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'orb-vault.exe' : 'orb-vault');
}
// Opens the engine's end (retrying a short while: the helper may still be making it).
function openEnd(name, unix) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (!unix) return { read: fs.openSync(name, 'r+'), write: null };
      const write = fs.openSync(path.join(name, 'req'), 'w');
      return { write, read: fs.openSync(path.join(name, 'res'), 'r') };
    } catch (error) {
      if (Date.now() - t0 > 10_000) throw Object.assign(new Error(`secretos: no se puede abrir la bóveda (${error.code ?? error.message})`), { code: 'noVault' });
      sleep(20);
    }
  }
}
function connect() {
  if (channel) return channel;
  let name = process.env.ORB_VAULT_PIPE;
  const unix = process.platform !== 'win32';
  if (name) delete process.env.ORB_VAULT_PIPE; // nothing this engine starts inherits it
  else {
    const bin = helperPath();
    if (!fs.existsSync(bin)) throw Object.assign(new Error(`secretos: falta ${bin} (node scripts/vault-build.mjs)`), { code: 'noVault' });
    const id = crypto.randomBytes(12).toString('hex');
    const dir = unix ? fs.mkdtempSync(path.join(os.tmpdir(), 'orb-boveda-')) : null;
    name = unix ? path.join(dir, 'c') : `\\\\.\\pipe\\orb-boveda-${id}`;
    const grants = unix ? path.join(dir, 'claves.sock') : `\\\\.\\pipe\\orb-claves-${id}`;
    const args = ['--channel', name, '--grants', grants, ...(process.env.NODE_TEST_CONTEXT ? ['--test'] : [])];
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true });
    child.unref();
  }
  channel = { ...openEnd(name, unix), rest: Buffer.alloc(0) };
  channel.hello = request({ op: 'hello' });
  return channel;
}
// One request, its answer (synchronous).
function request(msg) {
  const c = channel ?? connect();
  const out = Buffer.from(`${JSON.stringify(msg)}\n`);
  try { let off = 0; while (off < out.length) off += fs.writeSync(c.write ?? c.read, out, off); } finally { wipe(out); }
  for (;;) {
    const nl = c.rest.indexOf(10);
    if (nl >= 0) {
      const line = c.rest.subarray(0, nl);
      let reply; try { reply = JSON.parse(line.toString('utf8')); } finally { wipe(line); }
      c.rest = c.rest.subarray(nl + 1);
      return reply;
    }
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(c.read, buf, 0, buf.length, null);
    if (!n) { channel = null; throw Object.assign(new Error('secretos: la bóveda se ha cerrado'), { code: 'noVault' }); }
    const all = Buffer.concat([c.rest, buf.subarray(0, n)]);
    wipe(buf); wipe(c.rest);
    c.rest = all;
  }
}
const failed = (reply) => (CODES.has(reply.code) ? new MasterError(reply.code) : new Error(`secretos: ${reply.code ?? 'error'}`));

// Whether a maestra.json's cost is one Orb accepts (a planted file can neither make it cheap nor hang it).
export function kdfOk(kdf) { const r = request({ op: 'kdfOk', kdf: kdf ?? null }); return r.ok && r.r === true; }

// 3.8.1 (decision 20 d): this PC's secret is opened in Rust (src-tauri/vault/src/machine.rs) from core\datos\clave2.enc
// or its copy outside (copy: claves\<key>.enc; ORB2 beside it as .v2.enc). It stays there, for this PC's wrap of the data
// key (new Master(dir, { secret: IN_VAULT })); the engine gets only the keys made from it. fake, reveal: the tests' vault
// only (its sealing knobs; the secret said back). → { approval, backup, warns: [{ code, detail }] }, or throws with code
// 'busy' (for now), 'unreadable' (sealed keys that do not open) or 'old' (only Orb 3.8.0's key files).
export const IN_VAULT = Symbol('machine secret in the vault');
export function openMachine({ dir, copy, allowNew = false, fake = null, reveal = false }) {
  const r = request({ op: 'machine', dir: path.resolve(dir), copy: path.resolve(copy), allowNew: allowNew === true, ...(fake ? { fake } : {}), ...(reveal ? { reveal: true } : {}) });
  if (!r.ok) throw Object.assign(new Error(`clave: ${r.code}${r.detail ? ` (${r.detail})` : ''}`), { code: r.code, detail: r.detail ?? '' });
  return { approval: Buffer.from(r.r.approval, 'base64'), backup: Buffer.from(r.r.backup, 'base64'), warns: r.r.warns ?? [], ...(r.r.hex ? { hex: r.r.hex } : {}) };
}

// dir: core\secretos. secret: this PC's secret (Buffer, 32 bytes or more; IN_VAULT: the one the vault opened), or null.
export class Master {
  constructor(dir, { secret = null, now = () => Date.now() } = {}) {
    this.dir = dir; this.now = now; this.busy = Promise.resolve();
    this.onChange = () => {};
    this.onFails = () => {}; // (channel, fails): FREE_TRIES wrong ones in a row (the engine tells the owner)
    const s = secret !== IN_VAULT && secret && secret.length >= 32 ? Buffer.from(secret).toString('base64') : null;
    this.h = this.raw({ op: 'open', dir: path.resolve(dir), secret: s, ...(secret === IN_VAULT ? { machine: true } : {}) });
  }
  // What the vault asks after a request: copy the folder outside core (changed), tell the owner (notices).
  after(reply) {
    if (reply.changed) { try { this.onChange(); } catch { /* the next change copies again */ } }
    for (const [channel, n] of reply.notices ?? []) { try { this.onFails(channel, n); } catch { /* only a notice */ } }
    if (!reply.ok) throw failed(reply);
    return reply.r;
  }
  raw(msg) { return this.after(request({ ...msg, now: this.now() })); }
  call(op, extra = {}) { return this.raw({ op, h: this.h, ...extra }); }
  // A slow one (scrypt): a job in Rust, polled without blocking the event loop.
  async job(op, extra) {
    const start = request({ op, h: this.h, ...extra, now: this.now() });
    if (!start.ok) throw failed(start);
    for (let wait = 2; ; wait = Math.min(wait * 2, 25)) {
      await new Promise((r) => setTimeout(r, wait));
      const reply = request({ op: 'job', id: start.job });
      if (!(reply.ok && reply.running)) return this.after(reply);
    }
  }
  // One change at a time (two windows' clicks, a phone linking while the password changes).
  serial(fn) { const run = this.busy.then(fn, fn); this.busy = run.catch(() => {}); return run; }

  file(name) { return path.join(this.dir, name); }
  hasPassword() { return this.call('has'); }
  unlocked() { return this.call('unlocked'); }
  // Which data key is open (an HMAC of it, never the key), or null.
  get keyId() { return this.call('keyId'); }
  hadPassword() { return this.call('had'); }
  state() { return this.call('state'); }
  // At the engine's start: the data key from this PC's wrap; a new workspace gets a new one. → true when it is open.
  openWithMachine() { return this.call('openMachine'); }
  sealForMachine() { return this.call('sealMachine'); }

  // The first password (the welcome, or the first start of 3.8). Never a second time (src/engine/api-master.mjs).
  create(password) { return this.serial(async () => { const p = checkPassword(password); await this.job('create', { password: p }); return true; }); }

  // ---- the waits. channel: 'pc' (this PC's window), 'pair' (a phone linking), 'recovery' (the backups' recovery code).
  waitOf(channel) { return this.call('wait', { channel }); }
  // One try on a channel whose check is the engine's (the recovery code), with the vault's waits: check() → true when
  // right. → { ok: true } | { ok: false, reason: 'wrong', left, until? } | { reason: 'wait', until } | { reason: 'tries' }.
  attempt(channel, check) {
    return this.serial(async () => {
      const refused = this.call('tryBegin', { channel });
      if (refused) return refused;
      let ok = false; try { ok = Boolean(await check()); } catch { ok = false; }
      return this.call('tryEnd', { channel, ok });
    });
  }
  // → { ok: true } | the refusals of attempt() | { ok: false, reason: 'none' } (no password made, or its file is gone).
  // A right password also opens a data key this PC could not open by itself and wraps it for this PC again.
  verify(password, channel = 'pc') { return this.serial(() => this.job('verify', { password: typed(password), channel })); }
  // Whether a value is the master password, with no try counted and nothing kept (an agent's secret card refuses it).
  // → true | false (false too while the data key is closed).
  isPassword(value) { return this.serial(() => this.job('same', { password: typed(value) })); }

  // ---- the window's unlock: a token for 5 minutes (kept in Rust), dropped when the window locks or closes.
  // purpose: a token for ONE action that always asks again (FRESH_UNLOCK in src/core/permissions.mjs): FRESH_MS.
  issue(purpose = null) { return this.call('issue', { purpose: purpose ?? null }); }
  checkToken(token, purpose = null, { consume = false } = {}) {
    if (typeof token !== 'string' || token.length > 200) return false;
    return this.call('check', { token, purpose: purpose ?? null, consume: Boolean(consume) });
  }
  lock() { this.call('lock'); }

  // Changing it: the current one first (the same waits). The data key stays (only wrapped again).
  change(current, next) { return this.serial(async () => { const p = checkPassword(next); return this.job('change', { current: typed(current), next: p }); }); }
  // «He olvidado la contraseña» (the caller checked the recovery code): a NEW data key, the secrets kept (keep(id))
  // encrypted again with it, and the new password.
  forgot(next, { keep = () => true } = {}) {
    return this.serial(async () => {
      const p = checkPassword(next);
      if (!this.unlocked()) throw new MasterError('locked');
      return this.job('forgot', { next: p, keep: this.ids('').filter((id) => keep(id)) });
    });
  }
  // «Borrar secretos y empezar de cero»: the sealed files go, a new data key, an empty vault and the new password.
  reset(next) { return this.serial(async () => { const p = checkPassword(next); return this.job('reset', { next: p }); }); }

  // ---- the secrets (needs the data key open), one at a time
  get(id) { return this.call('get', { id: String(id) }); }
  set(id, value) { this.call('set', { id: String(id), value: value === undefined ? null : value }); }
  ids(prefix = '') { return this.call('ids', { prefix: String(prefix) }); }

  // ---- Magic Link: the verifier stays in Rust. The cost and salt the phone needs, or null without a usable verifier.
  pairInfo() { return this.call('pairInfo'); }
  // The phone's key confirmation, checked in Rust with the 'pair' waits: → attempt()'s answer (+ pcMac when right), or
  // { ok: false, reason: 'noVerifier' | 'bad' }.
  pairFinish(x) { return this.call('pairFinish', x); }
  // A connector's keys for its launcher only: → { grant, pipe } or null (none, or not tied to this program any more).
  grant(bind, binding, vars) { return this.call('grant', { bind, binding, vars }); }
}

// The copy outside core (this app's data folder, next to the copy of clave.enc): what is missing in core\secretos comes
// back from it before anything opens; after every change it is written again. What it brings back proves nothing by
// itself: a password only counts when it opens the data key this PC has.
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
