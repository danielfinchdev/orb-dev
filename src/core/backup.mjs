// 3.6: encrypted backups of an Orb (.orbbak), their check, their restore and their retention. No engine imports: the
// engine (backup.* calls and the 03:00 copy) and the tests use it directly.
//
// File format (.orbbak, format 1):
//   'ORBBAK1\n' · u32 header length · header JSON (plain: what it is, never what it holds)
//   then chunks until the one marked last: u32 length · u8 last · 24-byte nonce · XChaCha20-Poly1305(ciphertext + tag)
// header: { format, id, orbId, incarnation, version, created, kind, move, cipher, chunk, kdf:{alg:'scrypt',N,r,p,salt},
//   wrapped:{ machine?, passphrase? }, manifest_hash, counts }
// The body key is random. It is wrapped by this machine's secret (the app's secret: DPAPI or clave.bin) and, when the
// user set a recovery code, by that code through scrypt; with the code a backup opens on a clean machine. Every chunk's
// additional data names the header (its sha256), the chunk's index and whether it is the last one: a changed, swapped,
// cut or extended chunk does not open. The body is a plain stream of entries (u32 length · {p,s} · bytes); the first
// entry is manifest.json (sha256 of every file), whose own hash is in the header.
//
// What goes in: the database (VACUUM INTO, so it is consistent while the engine runs), orb.json, bitacora/ (general and
// project logs), the whiteboards of the projects, the app's secret, the recovery wrap, the archive of 3.7 (.orb/archivo-3.7,
// src/core/migrate-38.mjs; the other users' account folders in it only with the accounts). Optional: the project folders and the agents' login folders (off).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { paths, INTERNAL_DIR, BOTS_DIR, LOGS_DIR, CONFIG_FILE } from './home.mjs';
import { tr } from './context.mjs';
import { ARCHIVE_DIR } from './migrate-38.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

export const MAGIC = Buffer.from('ORBBAK1\n');
export const FORMAT = 1;
export const CHUNK = 1 << 20;
export const EXT = '.orbbak';
// (A copy of kind «move», made by Orb 3.7's «Mover a otro PC», still lists and restores; none is made any more.)
export const KINDS = ['manual', 'daily', 'preupdate', 'premigration'];
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 };
const MAX_HEADER = 64 * 1024;

export class BackupError extends Error {
  constructor(code) { super(tr(`data.backup.err.${code}`)); this.code = code; this.userFacing = true; }
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (text) => new Uint8Array(Buffer.from(String(text ?? ''), 'base64'));
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const tick = () => new Promise((r) => setImmediate(r));

// ---- keys
export const machineKek = (secret) => new Uint8Array(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('orb-backup'), Buffer.from('machine-v1'), 32));
// A recovery code typed with or without dashes and spaces, in any case, gives the same key; any other passphrase is used
// as written (NFKC, trimmed).
export function normalizePassphrase(text) {
  const s = String(text ?? '').normalize('NFKC').trim();
  const compact = s.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z2-9]{32}$/.test(compact) && /^[A-Za-z2-9\s-]+$/.test(s) ? compact : s;
}
export const passKek = (passphrase, kdf) => {
  const pass = normalizePassphrase(passphrase);
  if (!pass) throw new BackupError('needsPassphrase');
  return new Uint8Array(crypto.scryptSync(pass, Buffer.from(kdf.salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 }));
};
const wrap = (kek, key, aad) => { const nonce = crypto.randomBytes(24); return b64(Buffer.concat([nonce, xchacha20poly1305(kek, nonce, Buffer.from(aad)).encrypt(key)])); };
const unwrap = (kek, box, aad) => { const raw = unb64(box); return xchacha20poly1305(kek, raw.subarray(0, 24), Buffer.from(aad)).decrypt(raw.subarray(24)); };

// 32 characters without look-alikes, shown as 8 groups of 4 (160 bits): the code the user writes down.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRecoveryCode() {
  const bytes = crypto.randomBytes(32);
  const chars = [...bytes].map((b) => ALPHABET[b % 32]).join('');
  return chars.match(/.{4}/g).join('-');
}

// The recovery wrap kept on this machine (sealed with its secret): the scheduled copies use it without asking for the code.
const recoveryFile = (home) => path.join(paths(home).data, 'copia-clave.json');
export function setRecovery(home, secret, passphrase, { kdf: params = SCRYPT } = {}) {
  const kdf = { alg: 'scrypt', ...params, salt: b64(crypto.randomBytes(16)) };
  const kek = passKek(passphrase, kdf);
  const sealed = wrap(machineKek(secret), kek, 'orbbak:recovery');
  const file = recoveryFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ v: 1, kdf, kek: sealed, at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  return { kdf, at: new Date().toISOString() };
}
export function recoveryOf(home, secret) {
  let raw; try { raw = JSON.parse(fs.readFileSync(recoveryFile(home), 'utf8')); } catch { return null; }
  try { return { kdf: raw.kdf, kek: unwrap(machineKek(secret), raw.kek, 'orbbak:recovery'), at: raw.at }; } catch { return null; }
}
export const hasRecovery = (home, secret) => Boolean(recoveryOf(home, secret));

// ---- this Orb's identity (the same orbId on two machines is a clone)
const identityFile = (home) => path.join(paths(home).data, 'orb-id.json');
export function orbIdOf(home) {
  const file = identityFile(home);
  try { const x = JSON.parse(fs.readFileSync(file, 'utf8')); if (/^[0-9a-f]{32}$/.test(x.orbId)) return { orbId: x.orbId, incarnation: Number(x.incarnation) || 1 }; } catch { /* made below */ }
  const id = { orbId: crypto.randomBytes(16).toString('hex'), incarnation: 1 };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(id, null, 2)}\n`);
  return id;
}

// ---- where the copies go
export const backupDir = (home, config = null) => (config?.backup?.folder && path.isAbsolute(config.backup.folder) ? config.backup.folder : path.join(paths(home).internal, 'copias-seguridad'));
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');

// ---- what goes in (archive paths are relative to the Orb folder, with /)
export const walkFiles = (dir, skip = () => false) => {
  const out = [];
  const go = (d) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const full = path.join(d, e.name);
      if (skip(e.name, full)) continue;
      if (e.isDirectory()) go(full); else if (e.isFile()) out.push(full);
    }
  };
  go(dir);
  return out;
};
const NO_COPY = new Set(['node_modules', '.git', '.venv', '__pycache__', 'dist', 'build', '.next', '.cache']);
const DATA_FILES = ['clave.bin', 'copia-clave.json', 'orb-id.json'];
const rel = (home, file) => path.relative(home, file).split(path.sep).join('/');
// The names inside a backup are relative to the Orb folder (.orb/…, bitacora/…).
export const archiveName = (home, file) => rel(home, file);
export const homePath = (home, name) => path.join(home, ...String(name).split('/'));
const insideOf = (root, p) => { const r = path.relative(root, p); return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r); };

// Copies what goes in to `stage` (a mini Orb folder) and returns the manifest.
async function stageFiles(home, stage, { secret, includeProjects = false, includeAccounts = false, log = () => {} }) {
  const p = paths(home);
  const files = [];
  const put = async (src, archive) => {
    const dest = path.join(stage, ...archive.split('/'));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    files.push(archive);
  };
  // The database, consistent while the engine writes (VACUUM INTO from its own connection).
  const dbOut = path.join(stage, INTERNAL_DIR, 'datos', 'orb.db');
  await fsp.mkdir(path.dirname(dbOut), { recursive: true });
  if (fs.existsSync(p.db)) {
    const db = new DatabaseSync(p.db);
    try { db.exec('PRAGMA busy_timeout = 8000'); db.prepare('VACUUM INTO ?').run(dbOut); } finally { db.close(); }
    files.push(`${INTERNAL_DIR}/datos/orb.db`);
  }
  if (fs.existsSync(p.config)) await put(p.config, CONFIG_FILE);
  // The secret that seals the approvals and the recovery wrap: on a new machine they keep working.
  if (secret) { await fsp.writeFile(path.join(stage, INTERNAL_DIR, 'datos', 'clave.bin'), Buffer.from(secret), { mode: 0o600 }); files.push(`${INTERNAL_DIR}/datos/clave.bin`); }
  for (const name of DATA_FILES.filter((n) => n !== 'clave.bin')) { const f = path.join(p.data, name); if (fs.existsSync(f)) await put(f, `${INTERNAL_DIR}/datos/${name}`); }
  for (const f of walkFiles(p.logs)) await put(f, archiveName(home, f));
  // The projects: their whiteboards always, the whole folder only if asked (without dependencies and build output).
  let projects = [];
  if (fs.existsSync(dbOut)) {
    const db = new DatabaseSync(dbOut, { readOnly: true });
    try { projects = db.prepare('SELECT name, path FROM projects').all(); } catch { projects = []; } finally { db.close(); }
  }
  for (const pr of projects) {
    const inside = insideOf(home, pr.path);
    if (includeProjects && inside) { for (const f of walkFiles(pr.path, (n) => NO_COPY.has(n))) await put(f, rel(home, f)); continue; }
    const board = path.join(pr.path, 'pizarra');
    if (!fs.existsSync(board)) continue;
    for (const f of walkFiles(board)) await put(f, inside ? rel(home, f) : `${INTERNAL_DIR}/pizarras-de-fuera/${String(pr.name).replace(/[^\w.-]+/g, '_')}/${path.relative(board, f).split(path.sep).join('/')}`);
  }
  if (includeAccounts) for (const f of walkFiles(path.join(p.internal, 'cuentas'))) await put(f, archiveName(home, f));
  for (const f of walkFiles(path.join(p.internal, ARCHIVE_DIR), (n) => n === 'cuentas' && !includeAccounts)) await put(f, archiveName(home, f));
  const manifest = { format: FORMAT, files: [] };
  let bytes = 0;
  for (const name of files) {
    const full = path.join(stage, ...name.split('/'));
    const data = await fsp.readFile(full);
    bytes += data.length;
    manifest.files.push({ p: name, s: data.length, h: sha256(data) });
    await tick();
  }
  log(`copia: ${files.length} archivos, ${bytes} bytes`);
  return { manifest, bytes };
}

// ---- the encrypted stream
class Sealer {
  constructor(fh, key, headerHash) { this.fh = fh; this.key = key; this.hh = headerHash; this.parts = []; this.size = 0; this.index = 0; }
  aad(index, last) { return Buffer.from(`ORBBAK1|${this.hh}|${index}|${last ? 1 : 0}`); }
  async emit(plain, last) {
    const nonce = crypto.randomBytes(24);
    const ct = xchacha20poly1305(this.key, nonce, this.aad(this.index, last)).encrypt(plain);
    await this.fh.write(Buffer.concat([u32(1 + 24 + ct.length), Buffer.from([last ? 1 : 0]), nonce, ct]));
    this.index++;
    await tick();
  }
  async push(bytes) {
    this.parts.push(Buffer.from(bytes)); this.size += bytes.length;
    while (this.size >= CHUNK) {
      const all = Buffer.concat(this.parts);
      await this.emit(all.subarray(0, CHUNK), false);
      const rest = all.subarray(CHUNK); this.parts = [rest]; this.size = rest.length;
    }
  }
  async end() { await this.emit(Buffer.concat(this.parts), true); this.parts = []; this.size = 0; }
}

// Writes the .orbbak of a staged folder. keys: { secret (machine), recovery ({kdf, kek}) or passphrase }.
async function writeOrbbak(out, stage, manifest, { secret, recovery = null, passphrase = null, meta }) {
  const bodyKey = crypto.randomBytes(32);
  const id = crypto.randomBytes(16).toString('hex');
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  let kdf = null; let passWrap = null;
  if (passphrase) { kdf = { alg: 'scrypt', ...SCRYPT, salt: b64(crypto.randomBytes(16)) }; passWrap = wrap(passKek(passphrase, kdf), bodyKey, `orbbak:wrap:passphrase:${id}`); }
  else if (recovery) { kdf = recovery.kdf; passWrap = wrap(recovery.kek, bodyKey, `orbbak:wrap:passphrase:${id}`); }
  const header = {
    format: FORMAT, id, ...meta, cipher: 'xchacha20poly1305', chunk: CHUNK, kdf,
    wrapped: { ...(secret ? { machine: wrap(machineKek(secret), bodyKey, `orbbak:wrap:machine:${id}`) } : {}), ...(passWrap ? { passphrase: passWrap } : {}) },
    manifest_hash: sha256(manifestBytes), counts: { files: manifest.files.length, bytes: manifest.files.reduce((n, f) => n + f.s, 0) }
  };
  if (!header.wrapped.machine && !header.wrapped.passphrase) throw new BackupError('noKey');
  const headerBytes = Buffer.from(JSON.stringify(header));
  const tmp = `${out}.${process.pid}.tmp`;
  const fh = await fsp.open(tmp, 'w', 0o600);
  try {
    await fh.write(Buffer.concat([MAGIC, u32(headerBytes.length), headerBytes]));
    const s = new Sealer(fh, new Uint8Array(bodyKey), sha256(headerBytes));
    const entry = async (name, size) => { const h = Buffer.from(JSON.stringify({ p: name, s: size })); await s.push(Buffer.concat([u32(h.length), h])); };
    await entry('manifest.json', manifestBytes.length); await s.push(manifestBytes);
    for (const f of manifest.files) {
      await entry(f.p, f.s);
      const rh = await fsp.open(path.join(stage, ...f.p.split('/')), 'r');
      try { const buf = Buffer.alloc(CHUNK); let pos = 0; for (;;) { const { bytesRead } = await rh.read(buf, 0, CHUNK, pos); if (!bytesRead) break; pos += bytesRead; await s.push(buf.subarray(0, bytesRead)); } }
      finally { await rh.close(); }
    }
    await entry('', 0); // the end
    await s.end();
    await fh.sync?.();
  } finally { await fh.close(); }
  await fsp.rename(tmp, out);
  return header;
}

// A backup now. → { file, header }. kind: manual | daily | preupdate | premigration.
export async function createBackup({ home, secret = null, kind = 'manual', version = null, folder = null, passphrase = null, includeProjects = false, includeAccounts = false, log = () => {}, now = new Date() } = {}) {
  if (!KINDS.includes(kind)) throw new BackupError('badKind');
  const dir = folder ?? backupDir(home);
  await fsp.mkdir(dir, { recursive: true });
  const id = orbIdOf(home);
  const stage = await fsp.mkdtemp(path.join(dir, '.preparando-'));
  try {
    const { manifest } = await stageFiles(home, stage, { secret, includeProjects, includeAccounts, log });
    const recovery = passphrase ? null : (secret ? recoveryOf(home, secret) : null);
    const file = path.join(dir, `orb-${stamp(now)}-${kind}${EXT}`);
    const header = await writeOrbbak(file, stage, manifest, { secret, recovery, passphrase,
      meta: { orbId: id.orbId, incarnation: id.incarnation, version, created: now.toISOString(), kind, move: false } });
    log(`copia hecha: ${path.basename(file)}`);
    return { file, header };
  } finally { await fsp.rm(stage, { recursive: true, force: true, maxRetries: 5 }); }
}

// ---- reading
export async function readHeader(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const head = Buffer.alloc(12); await fh.read(head, 0, 12, 0);
    if (!head.subarray(0, 8).equals(MAGIC)) throw new BackupError('notBackup');
    const len = head.readUInt32BE(8); if (len > MAX_HEADER) throw new BackupError('notBackup');
    const bytes = Buffer.alloc(len); await fh.read(bytes, 0, len, 12);
    let header; try { header = JSON.parse(bytes.toString('utf8')); } catch { throw new BackupError('notBackup'); }
    if (header.format !== FORMAT) throw new BackupError('newerFormat');
    return { header, headerHash: sha256(bytes), bodyAt: 12 + len };
  } finally { await fh.close(); }
}

// The body key, with this machine's secret or with the recovery code.
export function openKey(header, { secret = null, passphrase = null } = {}) {
  if (secret && header.wrapped?.machine) { try { return unwrap(machineKek(secret), header.wrapped.machine, `orbbak:wrap:machine:${header.id}`); } catch { /* another machine */ } }
  if (!header.wrapped?.passphrase) throw new BackupError(header.wrapped?.machine ? 'otherMachine' : 'noKey');
  if (!passphrase) throw new BackupError('needsPassphrase');
  try { return unwrap(passKek(passphrase, header.kdf), header.wrapped.passphrase, `orbbak:wrap:passphrase:${header.id}`); } catch { throw new BackupError('wrongPassphrase'); }
}

// Opens the body chunk by chunk; onEntry(name, size, readBytes) for every entry, in order. Any tampering throws.
async function readBody(file, keys, onEntry) {
  const { header, headerHash, bodyAt } = await readHeader(file);
  const key = openKey(header, keys);
  const fh = await fsp.open(file, 'r');
  const size = (await fh.stat()).size;
  let pos = bodyAt; let index = 0; let last = false;
  let buf = Buffer.alloc(0);
  const nextChunk = async () => {
    if (last) return false;
    if (pos + 4 > size) throw new BackupError('damaged');
    const lb = Buffer.alloc(4); await fh.read(lb, 0, 4, pos);
    const len = lb.readUInt32BE(0);
    if (len < 1 + 24 + 16 || len > CHUNK + 1 + 24 + 16 || pos + 4 + len > size) throw new BackupError('damaged');
    const frame = Buffer.alloc(len); await fh.read(frame, 0, len, pos + 4);
    pos += 4 + len;
    const isLast = frame[0] === 1;
    let plain;
    try { plain = xchacha20poly1305(key, frame.subarray(1, 25), Buffer.from(`ORBBAK1|${headerHash}|${index}|${isLast ? 1 : 0}`)).decrypt(frame.subarray(25)); }
    catch { throw new BackupError('damaged'); }
    index++; last = isLast;
    if (last && pos !== size) throw new BackupError('damaged');
    buf = buf.length ? Buffer.concat([buf, Buffer.from(plain)]) : Buffer.from(plain);
    await tick();
    return true;
  };
  const need = async (n) => { while (buf.length < n) if (!(await nextChunk())) throw new BackupError('damaged'); };
  const take = async (n) => { await need(n); const out = buf.subarray(0, n); buf = buf.subarray(n); return out; };
  try {
    for (;;) {
      const hl = (await take(4)).readUInt32BE(0);
      if (hl > 64 * 1024) throw new BackupError('damaged');
      const h = JSON.parse((await take(hl)).toString('utf8'));
      if (!h.p) break;
      let left = h.s;
      // The entry's bytes in pieces (a big database never sits whole in memory).
      const pieces = async (fn) => { while (left > 0) { if (!buf.length) { if (!(await nextChunk())) throw new BackupError('damaged'); continue; } const n = Math.min(left, buf.length); const part = buf.subarray(0, n); buf = buf.subarray(n); left -= n; await fn(part); } };
      await onEntry(h.p, h.s, pieces);
      if (left > 0) await pieces(() => {});
    }
    if (buf.length || !last) { while (await nextChunk()) { /* must be empty */ } if (buf.length) throw new BackupError('damaged'); }
  } finally { await fh.close(); }
  return header;
}

const safeName = (name) => typeof name === 'string' && name.length < 1000 && !name.startsWith('/') && !/^[a-zA-Z]:/.test(name) && !name.includes('\\') && name.split('/').every((s) => s && s !== '.' && s !== '..');

// Decrypts everything and checks every file against the manifest. With `into`, also writes the files there.
async function walkBackup(file, keys, into = null) {
  let manifest = null; let want = null; const seen = new Set(); let bytes = 0;
  const header = await readBody(file, keys, async (name, size, pieces) => {
    if (name === 'manifest.json') {
      if (manifest) throw new BackupError('damaged');
      const parts = []; await pieces((p) => { parts.push(Buffer.from(p)); });
      const raw = Buffer.concat(parts);
      manifest = JSON.parse(raw.toString('utf8')); manifest.hash = sha256(raw);
      want = new Map(manifest.files.map((f) => [f.p, f]));
      return;
    }
    const entry = want?.get(name);
    if (!entry || seen.has(name) || entry.s !== size || !safeName(name)) throw new BackupError('damaged');
    const hash = crypto.createHash('sha256');
    let out = null;
    if (into) { const dest = path.join(into, ...name.split('/')); await fsp.mkdir(path.dirname(dest), { recursive: true }); out = await fsp.open(dest, 'w', 0o600); }
    try { await pieces(async (p) => { hash.update(p); if (out) await out.write(p); }); } finally { await out?.close(); }
    if (hash.digest('hex') !== entry.h) throw new BackupError('damaged');
    seen.add(name); bytes += size;
  });
  if (!manifest || manifest.hash !== header.manifest_hash || seen.size !== want.size) throw new BackupError('damaged');
  return { header, files: seen.size, bytes };
}
export const verifyBackup = (file, keys = {}) => walkBackup(file, keys);

// ---- the list and the retention
export async function listBackups(dir) {
  let names; try { names = fs.readdirSync(dir).filter((n) => n.endsWith(EXT)); } catch { return []; }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try { const { header } = await readHeader(file); out.push({ file, name, size: fs.statSync(file).size, created: header.created, kind: header.kind, version: header.version, move: Boolean(header.move), recovery: Boolean(header.wrapped?.passphrase), files: header.counts?.files ?? null }); }
    catch { out.push({ file, name, size: fs.statSync(file).size, created: null, kind: 'unknown', damaged: true }); }
  }
  return out.sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
}

// What to keep: the newest copy of each of the last 7 days, of the last 4 weeks and of the last 6 months (daily and
// manual copies); the last 3 made before an update or a migration. Moves are never deleted here. → files to delete.
export function toPrune(list, { daily = 7, weekly = 4, monthly = 6, special = 3 } = {}) {
  const keep = new Set();
  const regular = list.filter((b) => ['daily', 'manual'].includes(b.kind) && b.created).sort((a, b) => b.created.localeCompare(a.created));
  const bucket = (key, n) => { const seen = []; for (const b of regular) { const k = key(new Date(b.created)); if (seen.includes(k)) continue; if (seen.length >= n) break; seen.push(k); keep.add(b.file); } };
  bucket((d) => d.toISOString().slice(0, 10), daily);
  bucket((d) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day); return t.toISOString().slice(0, 10); }, weekly);
  bucket((d) => d.toISOString().slice(0, 7), monthly);
  for (const kind of ['preupdate', 'premigration']) list.filter((b) => b.kind === kind).sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, special).forEach((b) => keep.add(b.file));
  return list.filter((b) => !keep.has(b.file) && !b.move && !b.damaged && b.kind !== 'move').map((b) => b.file);
}
export async function pruneBackups(dir, opts) {
  const gone = toPrune(await listBackups(dir), opts);
  for (const f of gone) await fsp.rm(f, { force: true });
  return gone;
}

// ---- restore: verify, unpack into a fresh folder, test-open the database, then swap at the next start
export const pendingDir = (home) => path.join(paths(home).internal, 'restaurar-pendiente');
export async function stageRestore(home, file, keys = {}) {
  const ready = pendingDir(home);
  await fsp.mkdir(paths(home).internal, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(paths(home).internal, 'restaurar-'));
  try {
    const r = await walkBackup(file, keys, tmp);
    const db = path.join(tmp, INTERNAL_DIR, 'datos', 'orb.db');
    if (fs.existsSync(db)) {
      const d = new DatabaseSync(db);
      try { const ok = d.prepare('PRAGMA integrity_check').get(); if (Object.values(ok)[0] !== 'ok') throw new BackupError('damaged'); d.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get(); } finally { d.close(); }
    }
    fs.writeFileSync(path.join(tmp, 'listo.json'), JSON.stringify({ from: path.basename(file), header: { id: r.header.id, orbId: r.header.orbId, incarnation: r.header.incarnation, created: r.header.created, version: r.header.version, move: r.header.move }, at: new Date().toISOString() }));
    await fsp.rm(ready, { recursive: true, force: true });
    await fsp.rename(tmp, ready);
    return { files: r.files, bytes: r.bytes, header: r.header };
  } catch (error) { await fsp.rm(tmp, { recursive: true, force: true }); throw error; }
}

// The swap units: what is replaced as a whole (a log folder, a whiteboard, a project; the bots' folder of a 3.7 copy) or
// one file.
function unitOf(name) {
  const s = name.split('/');
  if (s[0] === INTERNAL_DIR) return s.slice(0, s[1] === 'datos' ? 3 : 2).join('/');
  if (s[0] === BOTS_DIR || s[0] === LOGS_DIR || s.length === 1) return s[0];
  const i = s.indexOf('pizarra');
  return i > 0 ? s.slice(0, i + 1).join('/') : s.slice(0, Math.min(2, s.length - 1)).join('/');
}

// Called by the engine before the database is opened: a restore that is ready replaces what it holds;
// what was there before goes to .orb/antes-de-restaurar-<fecha>. → null, or { from, header, secretChanged }.
export function applyPendingRestore(home) {
  const ready = pendingDir(home);
  let info; try { info = JSON.parse(fs.readFileSync(path.join(ready, 'listo.json'), 'utf8')); } catch { return null; }
  fs.rmSync(path.join(ready, 'listo.json'), { force: true });
  const aside = path.join(paths(home).internal, `antes-de-restaurar-${stamp()}`);
  const units = new Set();
  for (const f of walkFiles(ready)) units.add(unitOf(rel(ready, f)));
  // A unit inside another one (a whiteboard inside a whole project) travels with it.
  for (const u of [...units]) if ([...units].some((o) => o !== u && u.startsWith(`${o}/`))) units.delete(u);
  const move = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); } };
  const oldKey = (() => { try { return fs.readFileSync(path.join(paths(home).data, 'clave.bin')); } catch { return null; } })();
  // The database's journal files and the Windows-sealed secret go with the old database.
  for (const extra of ['orb.db-wal', 'orb.db-shm', ...(units.has(`${INTERNAL_DIR}/datos/clave.bin`) ? ['clave.enc'] : [])]) {
    const f = path.join(paths(home).data, extra); if (fs.existsSync(f)) move(f, path.join(aside, INTERNAL_DIR, 'datos', extra));
  }
  for (const u of [...units].sort()) {
    const target = homePath(home, u);
    if (fs.existsSync(target)) move(target, path.join(aside, ...u.split('/')));
    move(path.join(ready, ...u.split('/')), target);
  }
  fs.rmSync(ready, { recursive: true, force: true });
  let newKey = null; try { newKey = fs.readFileSync(path.join(paths(home).data, 'clave.bin')); } catch { /* none */ }
  return { from: info.from, header: info.header, aside, secretChanged: Boolean(newKey && !(oldKey && oldKey.equals(newKey))), secret: newKey };
}

// Restore into a folder that is not an Orb yet (a clean machine, or «Mover»): unpack and swap at once.
export async function restoreInto(target, file, keys = {}) {
  await fsp.mkdir(target, { recursive: true });
  const r = await stageRestore(target, file, keys);
  const applied = applyPendingRestore(target);
  return { ...r, aside: applied?.aside ?? null };
}

