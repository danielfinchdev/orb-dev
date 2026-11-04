// 3.6: moving an Orb to another machine, and (with persons) exporting or deleting one person's data.
//   moveExport: a .orbbak marked move:true that opens only with a passphrase; this Orb is then marked «moved» (it stops
//               serving phones and linked Orbs until the user chooses «mantener ambos» or undoes the move).
//   moveImport: on the new machine, into a folder that is not an Orb: the same orbId with incarnation + 1.
//   cloneVerdict: what a peer makes of an Orb it sees (same orbId: the newer incarnation wins; two at once is a clone).
//   personFiles / exportPerson: one person's data (a .zip, or sealed with a passphrase); deletePerson: everything of them
//               goes (rows and files) into a 30-day trash, their lines in shared groups become «(mensaje borrado)».
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { isHome, paths } from './home.mjs';
import { tr } from './context.mjs';
import { createBackup, restoreInto, orbIdOf, setOrbId, readHeader, openKey, walkFiles, sealFiles } from './backup.mjs';

const fail = (key, vars) => { const e = new Error(tr(key, vars)); e.userFacing = true; throw e; };

export async function moveExport({ home, secret, passphrase, version = null, folder = null, log = () => {} }) {
  if (!passphrase || String(passphrase).length < 12) fail('data.backup.err.shortPassphrase');
  const r = await createBackup({ home, secret, kind: 'move', version, folder, passphrase, move: true, log });
  setOrbId(home, { moved: { at: new Date().toISOString(), file: r.file.split(/[\\/]/).pop() } });
  return r;
}
// The user changed their mind (the copy was not imported anywhere): this Orb serves again, as before.
export const moveUndo = (home) => setOrbId(home, { moved: null });
// Both Orbs stay: this one becomes a new Orb (new orbId), so nobody takes it for the one that moved.
export const moveKeepBoth = (home) => setOrbId(home, { orbId: crypto.randomBytes(16).toString('hex'), incarnation: 1, moved: null });
export const movedAway = (home) => orbIdOf(home).moved ?? null;

export async function moveImport({ target, file, passphrase }) {
  if (fs.existsSync(target) && (isHome(target) || fs.readdirSync(target).length)) fail('data.nucleo.notEmpty');
  const { header } = await readHeader(file);
  if (!header.move) fail('data.move.notMove');
  openKey(header, { passphrase }); // a wrong passphrase leaves nothing behind
  const fresh = !fs.existsSync(target);
  let r;
  try { r = await restoreInto(target, file, { passphrase }); }
  catch (error) { if (fresh) fs.rmSync(target, { recursive: true, force: true }); throw error; }
  const id = setOrbId(target, { orbId: header.orbId, incarnation: (Number(header.incarnation) || 1) + 1, moved: null });
  return { ...r, orbId: id.orbId, incarnation: id.incarnation };
}

// known: what a peer remembers of this orbId ({ incarnation, host }); seen: what just said hello. →
//   'new' (never seen), 'same', 'moved' (a newer incarnation: the peer follows it), 'clone' (an older incarnation, or the
//   same incarnation from another machine: two Orbs claim to be one; the peer refuses it and tells the user).
export function cloneVerdict(known, seen) {
  if (!known?.orbId || !seen?.orbId || known.orbId !== seen.orbId) return 'new';
  const [a, b] = [Number(known.incarnation) || 1, Number(seen.incarnation) || 1];
  if (b > a) return 'moved';
  if (b < a) return 'clone';
  return known.host && seen.host && known.host !== seen.host ? 'clone' : 'same';
}

// ---- one person's data (3.6, persons). Export: a folder (zip) with everything that is theirs and nothing of anyone
// else; delete: their rows and files go (into a 30-day trash), their lines in shared groups say «(mensaje borrado)».
const has = (board, table) => Boolean(board.one("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table));
const cols = (board, table) => new Set(board.all(`PRAGMA table_info(${table})`).map((c) => c.name));
const ownRows = (board, table, pid) => (has(board, table) && cols(board, table).has('person_id') ? board.all(`SELECT * FROM ${table} WHERE person_id = ?`, pid) : []);
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
const csv = (rows) => { if (!rows.length) return ''; const keys = Object.keys(rows[0]); const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)); return [keys.join(','), ...rows.map((r) => keys.map((k) => q(r[k])).join(','))].join('\n') + '\n'; };
const readOr = (file) => { try { return fs.readFileSync(file); } catch { return null; } };

// The files of a person's export: [{ name, data }] (names with /).
export function personFiles(board, pid, { home }) {
  const p = paths(home);
  const out = [];
  const add = (name, data) => out.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(String(data)) });
  const person = board.one('SELECT id, name, role, language, tz, color, caps, created_at FROM persons WHERE id = ?', pid);
  if (!person) fail('msg.persons.noPerson');
  add('person.json', JSON.stringify(person, null, 2));
  add('settings.json', JSON.stringify(Object.fromEntries((has(board, 'person_settings') ? board.all('SELECT key, value FROM person_settings WHERE person_id = ?', pid) : []).map((r) => [r.key, r.value])), null, 2));
  // Conversations: their own whole; in a group of someone else, only their lines and the bots' answers right after them.
  for (const c of ownRows(board, 'conversations', pid)) add(`conversations/${c.id}.jsonl`, jsonl([{ conversation: c }, ...board.all('SELECT id, role, body, meta, at, person_id FROM chat WHERE conversation_id = ? ORDER BY id', c.id)]));
  if (cols(board, 'chat').has('person_id')) {
    const theirs = board.all('SELECT DISTINCT c.id FROM chat l JOIN conversations c ON c.id = l.conversation_id WHERE l.person_id = ? AND (c.person_id IS NULL OR c.person_id != ?)', pid, pid);
    for (const { id } of theirs) {
      const lines = board.all('SELECT id, role, body, at, person_id FROM chat WHERE conversation_id = ? ORDER BY id', id);
      const keep = []; let after = false;
      for (const l of lines) { if (l.role === 'usuario') after = l.person_id === pid; if (l.person_id === pid || (after && l.role !== 'usuario')) keep.push(l); }
      add(`conversations/grupo-${id}.jsonl`, jsonl(keep));
    }
  }
  // Their bots: settings, bot-wide memory, every per-person file, reminders.
  for (const b of ownRows(board, 'bots', pid)) {
    add(`bots/${b.id}/bot.json`, JSON.stringify(b, null, 2));
    // Not the files other people keep in this bot (their own memory of it).
    for (const f of walkFiles(path.join(p.bots, String(b.id)), (n, full) => path.basename(path.dirname(full)) === 'personas' && n !== `${pid}.md`)) add(`bots/${b.id}/${path.relative(path.join(p.bots, String(b.id)), f).split(path.sep).join('/')}`, fs.readFileSync(f));
    add(`bots/${b.id}/reminders.json`, JSON.stringify(board.all('SELECT * FROM bot_reminders WHERE bot_id = ?', b.id), null, 2));
  }
  // Bots of others they talk to: only their own memory file there.
  for (const dir of (() => { try { return fs.readdirSync(p.bots); } catch { return []; } })()) {
    if (!/^\d+$/.test(dir) || ownRows(board, 'bots', pid).some((b) => String(b.id) === dir)) continue;
    const mine = readOr(path.join(p.bots, dir, 'personas', `${pid}.md`));
    if (mine) add(`bots-shared/${dir}/my-memory.md`, mine);
  }
  const global = readOr(path.join(p.bots, 'personas', pid, 'memoria-global.md'));
  if (global) add('memoria-global.md', global);
  add('groups.json', JSON.stringify(ownRows(board, 'bot_groups', pid), null, 2));
  const projects = ownRows(board, 'projects', pid);
  add('projects.json', JSON.stringify(projects.map((pr) => ({ ...pr, tasks: board.all('SELECT id, title, description, status, agent, created_at FROM tasks WHERE project = ? AND person_id = ?', pr.name, pid), schedules: board.all('SELECT * FROM schedules WHERE project = ? AND person_id = ?', pr.name, pid) })), null, 2));
  add('usage.csv', csv(has(board, 'usage_ledger') ? board.all('SELECT at, day, account_id, bot_id, turns, tokens_in, tokens_out, usd FROM usage_ledger WHERE person_id = ? ORDER BY id', pid) : []));
  return out;
}

// A plain .zip (deflate, no dependencies): every program opens it.
export function zipFiles(files, at = new Date()) {
  const dosTime = ((at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()) & 0xffff;
  const locals = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'); const raw = f.data; const crc = zlib.crc32(raw) >>> 0;
    const packed = zlib.deflateRawSync(raw); const useDeflate = packed.length < raw.length; const body = useDeflate ? packed : raw;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(useDeflate ? 8 : 0, 8);
    h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    locals.push(h, name, body);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(useDeflate ? 8 : 0, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
// Reads a .zip made by zipFiles (tests, and the import of an export).
export function unzipFiles(buf) {
  const out = []; let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8); const size = buf.readUInt32LE(at + 18); const n = buf.readUInt16LE(at + 26); const x = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + n).toString('utf8'); const body = buf.subarray(at + 30 + n + x, at + 30 + n + x + size);
    out.push({ name, data: method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body) });
    at += 30 + n + x + size;
  }
  return out;
}

// ---- deleting a person: their export is kept in the trash for 30 days with their files; nothing of them stays elsewhere.
export const PERSON_TRASH_DAYS = 30;
export const personsTrash = (home) => path.join(paths(home).internal, 'personas-borradas');
export function deletePerson(board, pid, { home, onBot = () => {} } = {}) {
  const person = board.one('SELECT * FROM persons WHERE id = ? AND deleted_at IS NULL', pid);
  if (!person) fail('msg.persons.noPerson');
  if (person.role === 'owner') fail('msg.persons.ownerStays');
  const p = paths(home);
  const trash = path.join(personsTrash(home), `${pid}-${Date.now()}`);
  fs.mkdirSync(trash, { recursive: true });
  fs.writeFileSync(path.join(trash, 'export.zip'), zipFiles(personFiles(board, pid, { home })));
  const keep = (src, name) => { if (!fs.existsSync(src)) return; const to = path.join(trash, name); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(src, to); };
  const bots = ownRows(board, 'bots', pid).map((b) => b.id);
  // Their files: their bots' folders, their memory in others' bots, their global memory, phone uploads, account folders.
  for (const id of bots) keep(path.join(p.bots, String(id)), `bots/${id}`);
  for (const dir of (() => { try { return fs.readdirSync(p.bots); } catch { return []; } })()) if (/^\d+$/.test(dir)) keep(path.join(p.bots, dir, 'personas', `${pid}.md`), `bots-shared/${dir}.md`);
  keep(path.join(p.bots, 'personas', pid), 'personas');
  keep(path.join(p.internal, 'adjuntos-movil', pid), 'adjuntos-movil');
  keep(path.join(p.internal, 'cuentas', pid), 'cuentas');
  const T = (t) => has(board, t);
  board.transaction(() => {
    for (const id of bots) {
      if (T('bot_group_members')) board.run('DELETE FROM bot_group_members WHERE bot_id = ?', id);
      board.run('DELETE FROM bot_reminders WHERE bot_id = ?', id);
      board.run('DELETE FROM bot_requests WHERE bot_id = ?', id);
      if (T('bot_sessions')) board.run('DELETE FROM bot_sessions WHERE bot_id = ?', id);
      for (const c of board.all('SELECT id FROM conversations WHERE bot_id = ?', id)) { board.run('DELETE FROM chat WHERE conversation_id = ?', c.id); board.run('DELETE FROM conversations WHERE id = ?', c.id); }
      if (T('shares')) board.run("DELETE FROM shares WHERE resource_type = 'bot' AND resource_id = ?", String(id));
      board.run('DELETE FROM bots WHERE id = ?', id);
    }
    for (const g of ownRows(board, 'bot_groups', pid)) {
      for (const c of board.all('SELECT id FROM conversations WHERE group_id = ?', g.id)) { board.run('DELETE FROM chat WHERE conversation_id = ?', c.id); board.run('DELETE FROM conversations WHERE id = ?', c.id); }
      board.run('DELETE FROM bot_group_members WHERE group_id = ?', g.id);
      if (T('shares')) board.run("DELETE FROM shares WHERE resource_type = 'group' AND resource_id = ?", String(g.id));
      board.run('DELETE FROM bot_groups WHERE id = ?', g.id);
    }
    // Their lines in groups of others: the line stays (the talk makes sense), its words do not.
    if (cols(board, 'chat').has('person_id')) board.run("UPDATE chat SET body = ?, meta = NULL, person_id = NULL WHERE person_id = ?", tr('data.person.deletedLine'), pid);
    for (const c of ownRows(board, 'conversations', pid)) { board.run('DELETE FROM chat WHERE conversation_id = ?', c.id); board.run('DELETE FROM conversations WHERE id = ?', c.id); }
    for (const s of ownRows(board, 'sessions', pid)) { for (const t of ['session_items', 'session_queue']) if (T(t)) board.run(`DELETE FROM ${t} WHERE session_id = ?`, s.id); board.run('DELETE FROM sessions WHERE id = ?', s.id); }
    for (const t of ownRows(board, 'tasks', pid)) { if (T('messages')) board.run('DELETE FROM messages WHERE task_id = ?', t.id); board.run('DELETE FROM events WHERE task_id = ?', t.id); board.run('DELETE FROM tasks WHERE id = ?', t.id); }
    for (const pr of ownRows(board, 'projects', pid)) { if (T('shares')) board.run("DELETE FROM shares WHERE resource_type = 'project' AND resource_id = ?", pr.name); board.run('DELETE FROM projects WHERE name = ?', pr.name); }
    for (const t of ['schedules', 'link_queue', 'events', 'devices', 'bot_reminders', 'bot_requests']) if (T(t) && cols(board, t).has('person_id')) board.run(`DELETE FROM ${t} WHERE person_id = ?`, pid);
    for (const t of ['person_settings', 'bot_sessions', 'memory_log']) if (T(t)) board.run(`DELETE FROM ${t} WHERE person_id = ?`, pid);
    if (T('shares')) board.run('DELETE FROM shares WHERE person_id = ? OR granted_by = ?', pid, pid);
    if (T('account_loans')) board.run('DELETE FROM account_loans WHERE person_id = ? OR lender = ?', pid, pid);
    // The spending stays in the totals, without who.
    if (T('usage_ledger')) board.run("UPDATE usage_ledger SET person_id = 'deleted' WHERE person_id = ?", pid);
    if (T('audit')) board.run("UPDATE audit SET person_id = 'deleted' WHERE person_id = ?", pid);
    board.run('DELETE FROM persons WHERE id = ?', pid); // their export in the trash keeps who they were
  });
  for (const id of bots) onBot(id);
  return { id: pid, deleted: true, trash, bots: bots.length };
}
export function purgePersonsTrash(home, now = Date.now()) {
  const dir = personsTrash(home); let gone = 0;
  for (const name of (() => { try { return fs.readdirSync(dir); } catch { return []; } })()) {
    const at = Number(name.split('-').pop());
    if (Number.isFinite(at) && now - at > PERSON_TRASH_DAYS * 86_400_000) { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); gone++; }
  }
  return gone;
}

// The export of a person: a .zip in `folder` (or, with a passphrase, sealed like a backup). → { file, files }
export async function exportPerson(board, pid, { home, folder, passphrase = null } = {}) {
  const files = personFiles(board, pid, { home });
  fs.mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
  if (passphrase) {
    if (String(passphrase).length < 12) fail('data.backup.err.shortPassphrase');
    const file = path.join(folder, `persona-${pid}-${stamp}.orbbak`);
    await sealFiles(file, files, { passphrase, meta: { person: pid } });
    return { file, files: files.length };
  }
  const file = path.join(folder, `persona-${pid}-${stamp}.zip`);
  fs.writeFileSync(file, zipFiles(files), { mode: 0o600 });
  return { file, files: files.length };
}
