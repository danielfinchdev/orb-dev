// 3.6: encrypted backups of an Orb (.orbbak), their check, their restore and their retention. No engine imports: the
// engine (backup.* calls and the 03:00 copy) and the tests use it directly.
//
// File format (.orbbak, format 1):
//   'ORBBAK1\n' · u32 header length · header JSON (plain: what it is, never what it holds)
//   then chunks until the one marked last: u32 length · u8 last · 24-byte nonce · XChaCha20-Poly1305(ciphertext + tag)
// header: { format, id, orbId, incarnation, version, created, kind, move, cipher, chunk, kdf:{alg:'scrypt',N,r,p,salt},
//   wrapped:{ machine?, passphrase? }, manifest_hash, counts }
// The body key is random. It is wrapped by this machine's backup key (made from this PC's secret, which never goes into
// a backup: 3.8.1, decision 20 d) and, when the
// user set a recovery code, by that code through scrypt; with the code a backup opens on a clean machine. Every chunk's
// additional data names the header (its sha256), the chunk's index and whether it is the last one: a changed, swapped,
// cut or extended chunk does not open. The body is a plain stream of entries (u32 length · {p,s} · bytes); the first
// entry is manifest.json (sha256 of every file), whose own hash is in the header.
//
// What goes in: the database (VACUUM INTO, so it is consistent while the engine runs), orb.json, the logs (general and
// project), the MCP servers and the skills (core\mcp, core\skills, without their dependencies), the whiteboards of the projects, the app's
// secret, the recovery wrap, the master password's sealed files (core/secretos, 3.8), the archives of 3.7 (core/archivo-3.7 and dated ones, src/core/migrate-38.mjs; never sign-in
// folders). Optional: the project folders and the agents' login folders (off). 3.8: the names inside are relative to the
// workspace (core/datos/orb.db, core/bitacora/…); a copy made by 3.7 (.orb/…, orb.json, bitacora/… at the top) restores
// into core (legacyName) and the paths of its orb.json and database are pointed into core (src/core/core-folder.mjs ›
// rewritePaths).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { paths, homeKey, oldHomeKey, INTERNAL_DIR, BOTS_DIR, LEGACY } from './home.mjs';
import { rewritePaths, coreHealth, inside } from './core-folder.mjs';
import { tr } from './context.mjs';
import { ARCHIVE_DIR, forgetRun } from './migrate-38.mjs';
import { KEPT as SECRET_FILES } from './master.mjs';
import { LIVE_DIR, OLD_DIR } from './extensions.mjs';

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
// `secret` in this file: this PC's backup key (src/core/machine-keys.mjs › backupKeyOf, from the vault with the app).
const machineKek = (key) => new Uint8Array(Buffer.from(key));
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
// 3.8: whether a code is this machine's recovery code (what «He olvidado la contraseña» asks for). → true | false, or
// null when this machine has none set.
export function isRecoveryCode(home, secret, code) {
  const rec = recoveryOf(home, secret);
  if (!rec) return null;
  let kek; try { kek = passKek(code, rec.kdf); } catch { return false; }
  return kek.length === rec.kek.length && crypto.timingSafeEqual(Buffer.from(kek), Buffer.from(rec.kek));
}

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

// This workspace's id without making one (a core that lost its data folder has none): from core, or else from the note
// kept beside the backups (ultima.json).
export function knownOrbId(home) {
  try { const x = JSON.parse(fs.readFileSync(identityFile(home), 'utf8')); if (/^[0-9a-f]{32}$/.test(x.orbId)) return x.orbId; } catch { /* below */ }
  const last = readLast(home);
  return /^[0-9a-f]{32}$/.test(last.orbId ?? '') ? last.orbId : null;
}

// ---- where the copies go
// 3.8: outside the workspace, so that deleting core (or the whole workspace) does not take its copies with it:
// %LOCALAPPDATA%\Orb\copias\<workspace> on Windows (per user, never roaming: copies can be big; no administrator; the
// uninstaller leaves it), ~/.local/share/Orb/copias/<workspace> elsewhere. The user may pick another folder (Ajustes ›
// Datos), never inside the workspace. Wherever they go, the newest copy is noted in the default folder (ultima.json), which is
// how Orb finds it again when core is gone. ORB_BACKUP_ROOT moves the default (tests); under node --test without it, a
// temporary folder: tests never touch this PC's real one.
export function backupRoot() {
  if (process.env.ORB_BACKUP_ROOT) return process.env.ORB_BACKUP_ROOT;
  if (process.env.NODE_TEST_CONTEXT) return path.join(os.tmpdir(), 'orb-pruebas-copias');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Orb', 'copias');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Orb', 'copias');
}
export const defaultBackupDir = (home) => path.join(backupRoot(), homeKey(home));
// A chosen folder inside the workspace (3.7 allowed one) is not used: deleting the workspace would take the copies.
export const backupDir = (home, config = null) => (config?.backup?.folder && path.isAbsolute(config.backup.folder) && !inside(home, config.backup.folder) ? config.backup.folder : defaultBackupDir(home));
// Up to 3.7 the copies lived inside the data folder (now core\copias-seguridad).
export const oldBackupDir = (home) => path.join(paths(home).core, 'copias-seguridad');
const LAST = 'ultima.json';
function readLast(home) { try { return JSON.parse(fs.readFileSync(path.join(defaultBackupDir(home), LAST), 'utf8')) ?? {}; } catch { return {}; } }
const sameDir = (a, b) => path.resolve(a).toLowerCase().replace(/[\\/]+$/, '') === path.resolve(b).toLowerCase().replace(/[\\/]+$/, '');
const isNetwork = (p) => /^(\\\\|\/\/)/.test(String(p));
// The newest copy is noted in the default folder, with this workspace's id and the folders copies went to, so that Orb
// finds them with core gone.
export function rememberBackup(home, file, header) {
  const dir = defaultBackupDir(home);
  fs.mkdirSync(dir, { recursive: true });
  const before = readLast(home);
  const all = [path.dirname(file), ...(Array.isArray(before.folders) ? before.folders : [])].filter((f) => typeof f === 'string');
  const folders = all.filter((f, i) => all.findIndex((g) => sameDir(f, g)) === i).slice(0, 10);
  const tmp = path.join(dir, `${LAST}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({ file, created: header.created, kind: header.kind, orbId: header.orbId, folders }, null, 2)}\n`);
  fs.renameSync(tmp, path.join(dir, LAST));
}
// Where this workspace's copies may be: the default folder, the chosen one, and the folders noted in ultima.json (never
// a network path the settings do not name: listing it would hand this user's Windows sign-in to that machine).
export function knownBackupDirs(home, config = null) {
  const dirs = [defaultBackupDir(home), backupDir(home, config)];
  const last = readLast(home);
  for (const f of [...(Array.isArray(last.folders) ? last.folders : []), typeof last.file === 'string' ? path.dirname(last.file) : null]) {
    if (typeof f === 'string' && path.isAbsolute(f) && !isNetwork(f)) dirs.push(f);
  }
  return dirs.filter((d, i) => dirs.findIndex((e) => sameDir(d, e)) === i);
}
// The copies of this workspace, newest first (by the date in their header): a copy of another workspace (another orbId)
// is never one of them. → entries of listBackups.
export async function backupCandidates(home, config = null) {
  const want = knownOrbId(home);
  const found = new Map();
  for (const dir of knownBackupDirs(home, config)) for (const b of await listBackups(dir)) found.set(b.file.toLowerCase(), b);
  return [...found.values()].filter((b) => !b.damaged && b.created && (!want || b.orbId === want)).sort((a, b) => b.created.localeCompare(a.created));
}
export const latestBackup = async (home, config = null) => (await backupCandidates(home, config))[0] ?? null;
// «Seguir sin copia» (the window, core gone): the copies there were are put aside in a folder of their own, where
// nothing deletes them (the retention looks at the folder itself only) and nothing restores them by itself. → how many.
export function setAsideBackups(home, config = null) {
  let n = 0;
  for (const dir of knownBackupDirs(home, config)) {
    let names; try { names = fs.readdirSync(dir).filter((x) => x.endsWith(EXT)); } catch { continue; }
    if (!names.length) continue;
    const to = path.join(dir, `antes-de-empezar-de-nuevo-${stamp()}`);
    fs.mkdirSync(to, { recursive: true });
    for (const name of names) { try { fs.renameSync(path.join(dir, name), path.join(to, name)); n++; } catch { /* left where it is */ } }
  }
  fs.rmSync(path.join(defaultBackupDir(home), LAST), { force: true });
  return n;
}
// The first 3.8 builds named this workspace's folder after its whole path (home.mjs › oldHomeKey): taken over once.
export function adoptOldBackupRoot(home) {
  const from = path.join(backupRoot(), oldHomeKey(home)); const to = defaultBackupDir(home);
  if (sameDir(from, to) || !fs.existsSync(from) || fs.existsSync(to)) return false;
  try { fs.renameSync(from, to); } catch { return false; }
  const last = readLast(home);
  if (typeof last.file === 'string' && last.file.toLowerCase().startsWith(from.toLowerCase() + path.sep)) {
    last.file = path.join(to, last.file.slice(from.length + 1));
    last.folders = (last.folders ?? []).map((f) => (sameDir(f, from) ? to : f));
    fs.writeFileSync(path.join(to, LAST), `${JSON.stringify(last, null, 2)}\n`);
  }
  return true;
}
// The copies 3.7 left inside core move to where copies go now (renamed; copied, checked and deleted across volumes).
// → how many moved.
export function adoptOldBackups(home, config = null) {
  const from = oldBackupDir(home);
  let names; try { names = fs.readdirSync(from).filter((n) => n.endsWith(EXT)); } catch { return 0; }
  // A chosen folder inside the workspace (3.7 allowed it) is not where they go; one that is this very folder, nothing.
  const chosen = backupDir(home, config);
  const to = inside(home, chosen) ? defaultBackupDir(home) : chosen;
  if (inside(from, to) || inside(to, from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  let n = 0;
  for (const name of names) {
    const src = path.join(from, name); let dst = path.join(to, name);
    if (fs.existsSync(dst)) { if (fs.statSync(dst).size === fs.statSync(src).size && hash(dst) === hash(src)) { fs.rmSync(src, { force: true }); continue; } dst = path.join(to, name.replace(EXT, `-3.7${EXT}`)); }
    try { fs.renameSync(src, dst); } catch {
      // Another volume: copied, checked byte for byte (sha256), switched in, and only then the old one deleted.
      fs.copyFileSync(src, `${dst}.tmp`);
      if (fs.statSync(`${dst}.tmp`).size !== fs.statSync(src).size || hash(`${dst}.tmp`) !== hash(src)) { fs.rmSync(`${dst}.tmp`, { force: true }); continue; }
      fs.renameSync(`${dst}.tmp`, dst); fs.rmSync(src, { force: true });
    }
    n++;
  }
  try { fs.rmdirSync(from); } catch { /* something else in it: left */ }
  return n;
}
const stamp =(d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');

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
const DATA_FILES = ['copia-clave.json', 'orb-id.json'];
// Backups made before 3.8.1 carry this PC's secret in clear (core/datos/clave.bin): they are not restored any more (the
// engine never holds that secret: decision 20 d). Their names, as 3.8 and 3.7 wrote them.
const OLD_KEYS = new Set([`${INTERNAL_DIR}/datos/clave.bin`, `${LEGACY.internal}/datos/clave.bin`]);
export const oldKeyEntry = (name) => OLD_KEYS.has(String(name));
const rel = (home, file) => path.relative(home, file).split(path.sep).join('/');
// The names inside a backup are relative to the workspace (core/…, web/<project>/pizarra/…).
export const archiveName = (home, file) => rel(home, file);
// A name written by Orb 3.7 (its folders at the top of the workspace) → where it goes now; others as they are.
export function legacyName(name) {
  const s = String(name).split('/');
  if (s[0] === LEGACY.internal) return [INTERNAL_DIR, ...s.slice(1)].join('/');
  if (s.length === 1 && s[0] === LEGACY.config) return `${INTERNAL_DIR}/${LEGACY.config}`;
  if (s[0] === LEGACY.logs && s.length > 1) return [INTERNAL_DIR, 'bitacora', ...s.slice(1)].join('/');
  if (s[0] === LEGACY.mcp && s.length > 1) return [INTERNAL_DIR, 'mcp', ...s.slice(1)].join('/');
  return name;
}
export const homePath = (home, name) => path.join(home, ...String(name).split('/'));
const insideOf = (root, p) => { const r = path.relative(root, p); return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r); };

// Copies what goes in to `stage` (a mini Orb folder) and returns the manifest.
const archiveDirs = (internal) => { try { return fs.readdirSync(internal).filter((n) => n === ARCHIVE_DIR || n.startsWith(`${ARCHIVE_DIR}-`)).map((n) => path.join(internal, n)); } catch { return []; } };
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
  if (fs.existsSync(p.config)) await put(p.config, archiveName(home, p.config));
  for (const name of DATA_FILES) { const f = path.join(p.data, name); if (fs.existsSync(f)) await put(f, `${INTERNAL_DIR}/datos/${name}`); }
  // 3.8: the master password's files (core\secretos): the secrets stay sealed with the data key, which opens with the
  // master password (any PC) or this PC's secret. The count of wrong passwords stays on this PC.
  for (const name of SECRET_FILES) { const f = path.join(p.secrets, name); if (fs.existsSync(f)) await put(f, archiveName(home, f)); }
  for (const f of walkFiles(p.logs)) await put(f, archiveName(home, f));
  // 3.8.1: every server and every skill of core (not the links the agents load, core\skills\.activas, nor the versions
  // before the last change, .anterior: made again or not needed).
  for (const dir of [p.mcp, p.skills]) for (const f of walkFiles(dir, (n) => NO_COPY.has(n) || n === LIVE_DIR || n === OLD_DIR)) await put(f, archiveName(home, f));
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
  // 3.8: the archives of 3.7 (one per migration), never with sign-in folders (an archive of an early 3.8 build may have some).
  for (const dir of archiveDirs(p.internal)) for (const f of walkFiles(dir, (n) => n === 'cuentas')) await put(f, archiveName(home, f));
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
    try { rememberBackup(home, file, header); } catch (error) { log(`copia: no se pudo anotar la última: ${error.message}`); }
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
  let manifest = null; let want = null; const seen = new Set(); let bytes = 0; let legacy = false; let made37 = false;
  const header = await readBody(file, keys, async (name, size, pieces) => {
    if (name === 'manifest.json') {
      if (manifest) throw new BackupError('damaged');
      const parts = []; await pieces((p) => { parts.push(Buffer.from(p)); });
      const raw = Buffer.concat(parts);
      manifest = JSON.parse(raw.toString('utf8')); manifest.hash = sha256(raw);
      want = new Map(manifest.files.map((f) => [f.p, f]));
      if (manifest.files.some((f) => oldKeyEntry(f.p))) throw new BackupError('oldKey');
      // Made by 3.7 (its own folders at the top): its names are read as 3.7 wrote them. A 3.8 copy may hold a log folder
      // the user kept at the top (bitacora/…): that one stays there.
      made37 = manifest.files.some((f) => f.p === LEGACY.config || f.p.startsWith(`${LEGACY.internal}/`));
      return;
    }
    const entry = want?.get(name);
    if (!entry || seen.has(name) || entry.s !== size || !safeName(name)) throw new BackupError('damaged');
    const hash = crypto.createHash('sha256');
    let out = null;
    const to = made37 ? legacyName(name) : name; if (to !== name) legacy = true;
    if (into) { const dest = path.join(into, ...to.split('/')); await fsp.mkdir(path.dirname(dest), { recursive: true }); out = await fsp.open(dest, 'w', 0o600); }
    try { await pieces(async (p) => { hash.update(p); if (out) await out.write(p); }); } finally { await out?.close(); }
    if (hash.digest('hex') !== entry.h) throw new BackupError('damaged');
    seen.add(name); bytes += size;
  });
  if (!manifest || manifest.hash !== header.manifest_hash || seen.size !== want.size) throw new BackupError('damaged');
  return { header, files: seen.size, bytes, legacy };
}
export const verifyBackup = (file, keys = {}) => walkBackup(file, keys);

// ---- the list and the retention
export async function listBackups(dir) {
  let names; try { names = fs.readdirSync(dir).filter((n) => n.endsWith(EXT)); } catch { return []; }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try { const { header } = await readHeader(file); out.push({ file, name, size: fs.statSync(file).size, created: header.created, kind: header.kind, orbId: header.orbId ?? null, version: header.version, move: Boolean(header.move), recovery: Boolean(header.wrapped?.passphrase), files: header.counts?.files ?? null }); }
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
    fs.writeFileSync(path.join(tmp, 'listo.json'), JSON.stringify({ from: path.basename(file), legacy: r.legacy, header: { id: r.header.id, orbId: r.header.orbId, incarnation: r.header.incarnation, created: r.header.created, version: r.header.version, move: r.header.move }, at: new Date().toISOString() }));
    await fsp.rm(ready, { recursive: true, force: true });
    await fsp.rename(tmp, ready);
    return { files: r.files, bytes: r.bytes, header: r.header };
  } catch (error) { await fsp.rm(tmp, { recursive: true, force: true }); throw error; }
}

// The swap units: what is replaced as a whole (a folder of core such as the logs, a whiteboard, a project; the bots'
// folder of a 3.7 copy) or one file (orb.json and each file of core/datos).
function unitOf(name) {
  const s = name.split('/');
  if (s[0] === INTERNAL_DIR) return s.slice(0, s[1] === 'datos' ? 3 : 2).join('/');
  if (s[0] === BOTS_DIR || s.length === 1) return s[0];
  const i = s.indexOf('pizarra');
  return i > 0 ? s.slice(0, i + 1).join('/') : s.slice(0, Math.min(2, s.length - 1)).join('/');
}

// Called by the engine before the database is opened: a restore that is ready replaces what it holds;
// what was there before goes to core/antes-de-restaurar-<fecha>. → null, or { from, header, aside, units }.
// onlyMissing (3.8, a core deleted or damaged: repairCore): only what is not there any more is put back; what is still
// there (a newer database, the logs) stays as it is. This PC's sealed secret is never part of a backup (3.8.1): the one
// on disk stays.
export function applyPendingRestore(home, { onlyMissing = false } = {}) {
  const ready = pendingDir(home);
  let info; try { info = JSON.parse(fs.readFileSync(path.join(ready, 'listo.json'), 'utf8')); } catch { return null; }
  fs.rmSync(path.join(ready, 'listo.json'), { force: true });
  const aside = path.join(paths(home).internal, `antes-de-restaurar-${stamp()}`);
  const units = new Set();
  for (const f of walkFiles(ready)) units.add(unitOf(rel(ready, f)));
  // A unit inside another one (a whiteboard inside a whole project) travels with it.
  for (const u of [...units]) if ([...units].some((o) => o !== u && u.startsWith(`${o}/`))) units.delete(u);
  // Only core: a project or a whiteboard the user deleted stays deleted.
  if (onlyMissing) for (const u of [...units]) if (!u.startsWith(`${INTERNAL_DIR}/`) || fs.existsSync(homePath(home, u))) units.delete(u);
  const move = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); } };
  // The database's journal files go with the old database.
  for (const extra of units.has(`${INTERNAL_DIR}/datos/orb.db`) || !onlyMissing ? ['orb.db-wal', 'orb.db-shm'] : []) {
    const f = path.join(paths(home).data, extra); if (fs.existsSync(f)) move(f, path.join(aside, INTERNAL_DIR, 'datos', extra));
  }
  for (const u of [...units].sort()) {
    const target = homePath(home, u);
    if (fs.existsSync(target)) move(target, path.join(aside, ...u.split('/')));
    move(path.join(ready, ...u.split('/')), target);
  }
  fs.rmSync(ready, { recursive: true, force: true });
  // 3.8: a database of 3.7 restored now is migrated again with an archive and a copy of its own.
  if (units.has(`${INTERNAL_DIR}/datos/orb.db`)) forgetRun(home);
  // A copy made by 3.7: the paths of its orb.json and database point into core.
  if (info.legacy) rewritePaths(home);
  return { from: info.from, header: info.header, aside, units: [...units] };
}

// ---- 3.8: core missing or damaged (src/engine/engine.mjs, before the database opens)
// What is missing is put back from the newest copy of this workspace that opens (backupCandidates, newest first: one
// that this PC cannot open by itself, or a damaged one, gives way to the next), or from `file`. Without core's orb.json
// and no copy, Orb cannot go on by itself (the window offers to start again or to pick a copy); a database that is not
// there and no copy at all is a workspace made a moment ago. → { ok, restored?, fresh?, reason?, backup?, missing }
// reason: 'noBackup' | 'needsPassphrase' (the newest copy that needs its recovery code) | 'damaged' (none usable).
export async function repairCore(home, { secret = null, passphrase = null, file = null, config = null } = {}) {
  const health = coreHealth(home);
  if (health.ok) return { ok: true, missing: [] };
  const lostConfig = health.missing.includes('core') || health.missing.includes('config');
  const list = file ? [{ file, created: null }] : await backupCandidates(home, config);
  if (!list.length) return lostConfig ? { ok: false, reason: 'noBackup', missing: health.missing } : { ok: true, fresh: true, missing: health.missing };
  let failed = null;
  for (const backup of list) {
    try { await stageRestore(home, backup.file, { secret, passphrase }); } catch (error) {
      const reason = ['needsPassphrase', 'otherMachine', 'wrongPassphrase', 'noKey'].includes(error?.code) ? 'needsPassphrase' : 'damaged';
      // What the window says: the newest copy that only needs its code, else the newest damaged one.
      if (!failed || (reason === 'needsPassphrase' && failed.reason !== 'needsPassphrase')) failed = { reason, error: error.message, backup: { file: backup.file, created: backup.created } };
      continue;
    }
    const applied = applyPendingRestore(home, { onlyMissing: true });
    return { ok: true, restored: { from: applied?.from, created: applied?.header?.created ?? backup.created, units: applied?.units ?? [] }, missing: health.missing };
  }
  return { ok: false, ...failed, missing: health.missing };
}

// Restore into a folder that is not an Orb yet (a clean machine, or «Mover»): unpack and swap at once.
export async function restoreInto(target, file, keys = {}) {
  await fsp.mkdir(target, { recursive: true });
  const r = await stageRestore(target, file, keys);
  const applied = applyPendingRestore(target);
  return { ...r, aside: applied?.aside ?? null };
}

