// 3.7 (Orb Server, WS3): a bot runs on ONE Orb (its home) and every other Orb of its person keeps a live, read-only copy
// (a replica), pulled from the home whenever both are on. This file is the data side, shared by the engine
// (src/engine/replica.mjs: the sync, moves, takeovers) and the bots' tools (src/mcp/bot.mjs: isHomeHere):
// - isHomeHere(board, bot): only the home runs a bot (turns, reminders, tools, cards); a replica is never run here.
// - buildIndex / buildPage / buildFile: what the home serves (the bots of the persons it shares with that Orb, the
//   changes after a cursor, a file of the bot's folder in pieces).
// - applyPage / applyFile: what a replica does with them, idempotent by uid (a page applied twice changes nothing).
// Never replicated: browser profiles, agent logins and accounts, vault credentials, Home Assistant's token, live agent
// sessions (bot_sessions). Only the bot's own row, its conversations, reminders, memory history, card requests and the
// files of its folder (memories, per-person memories, attachments) travel.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { botDir, ensureMemory } from './bots.mjs';
import { avatarFor } from './avatar.mjs';
import { uuidv7, isUid } from './replica-db.mjs';
import { oneLine } from './safety.mjs';

export { uuidv7, isUid };
export const REPLICA_V = 1;
// What an Orb of 3.7 says it can do (hello / features).
export const HOME_CAPS = ['bots.home.v1', 'replica.v1'];
export const PAGE_MAX = 200; // changes per page
export const FILE_MAX = 5 * 1024 * 1024; // a file bigger than this is not copied
export const CHUNK = 1024 * 1024; // pieces of a file
const now = () => new Date().toISOString();
const json = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
const err = (message, extra = {}) => Object.assign(new Error(message), extra);

// ---- who runs what
export const selfId = (board) => { try { return board.setting('orb_self') ?? null; } catch { return null; } };
// A bot (a row of bots or a parsed bot) runs here: its home is this Orb (NULL: a row of before 3.7 not migrated yet).
export function isHomeHere(board, bot, self = selfId(board)) {
  if (!bot) return false;
  const home = bot.home ?? null;
  return home == null || (self != null && home === self);
}
// It runs here and takes new turns now (not while it is being handed over to another Orb).
export const takesTurns = (board, bot) => isHomeHere(board, bot) && (bot.home_state ?? 'active') !== 'moving';
export const botByUid = (board, uid) => (uid ? board.one('SELECT * FROM bots WHERE uid = ?', String(uid)) ?? null : null);
export const groupByUid = (board, uid) => (uid ? board.one('SELECT * FROM bot_groups WHERE uid = ?', String(uid)) ?? null : null);
export const botSeq = (board, uid) => board.one('SELECT MAX(seq) AS s FROM bot_changes WHERE bot_uid = ?', String(uid))?.s ?? 0;
// The SQL filter of the bots this Orb runs (reminders, cards…): «b» is the bots table's alias.
export const HOME_SQL = (alias = 'b') => `(${alias}.home IS NULL OR ${alias}.home = (SELECT value FROM settings WHERE key = 'orb_self'))`;

// ---- the files of a bot's folder (memories, per-person memories, attachments): never logins, profiles or databases
const NEVER = /(^|\/)(cookies?|local storage|session storage|indexeddb|login data|web data|\.?credentials?|tokens?|vault|\.ssh|\.gnupg)(\/|$)|\.(sqlite3?|db|ldb|log|key|pem|kdbx)$/i;
export const replicable = (rel) => Boolean(rel) && !rel.split('/').some((p) => p === '..' || p.startsWith('.')) && !NEVER.test(rel);
// Per-person memories of a bot (personas/<person>.md) travel only for the persons the peer may see.
const personFile = (rel) => /^personas\/([\w-]+)\.md$/.exec(rel)?.[1] ?? null;
export function manifest(botId, { persons = null } = {}) {
  const root = botDir(botId); const out = [];
  const walk = (dir, rel) => {
    let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (!replicable(r)) continue;
      if (d.isDirectory()) { if (out.length < 2000) walk(path.join(dir, d.name), r); continue; }
      if (!d.isFile()) continue;
      const pf = personFile(r); if (pf && persons && !persons.has(pf)) continue;
      const file = path.join(dir, d.name);
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (st.size > FILE_MAX) continue;
      let sha; try { sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { continue; }
      out.push({ p: r, sha256: sha, size: st.size });
    }
  };
  walk(root, '');
  return out.sort((a, b) => (a.p < b.p ? -1 : 1));
}
export const manifestDigest = (list) => crypto.createHash('sha256').update(JSON.stringify(list.map((f) => [f.p, f.sha256]))).digest('hex').slice(0, 32);

// ---- the home's side
const BOT_FIELDS = ['uid', 'name', 'icon', 'avatar', 'role_text', 'agent', 'model', 'effort', 'tools', 'accounts', 'exclusive', 'is_chief', 'paused', 'caps', 'created_at', 'updated_at', 'home', 'home_epoch', 'home_state', 'needs'];
// The bot as it travels: its accounts keep only the connectors' names (an account id is a login of this Orb).
export function serializeBot(row) {
  const out = Object.fromEntries(BOT_FIELDS.map((k) => [k, row[k] ?? null]));
  const acc = json(row.accounts, {});
  out.accounts = JSON.stringify(Array.isArray(acc?.mcp) ? { mcp: acc.mcp } : {});
  return out;
}
const personOfRow = (board, row) => row?.person_id ?? board.ownerId?.() ?? null;
const inList = (n) => Array.from({ length: n }, () => '?').join(', ');
// The bots (and groups) of these persons, wherever they run, with their home and epoch; for the ones run here, the last
// change and the digest of their files. forPerson(person): whom that person is on the asking Orb (when known).
export function buildIndex(board, persons, { forPerson = () => null } = {}) {
  const self = selfId(board); const owner = board.ownerId?.();
  const mine = (row) => persons.has(row.person_id ?? owner);
  const bots = board.all('SELECT * FROM bots WHERE uid IS NOT NULL ORDER BY id').filter(mine).filter((b) => b.home_state !== 'pending').map((b) => {
    const here = isHomeHere(board, b, self);
    const person = personOfRow(board, b);
    return { kind: 'bot', uid: b.uid, name: b.name, person, forPerson: forPerson(person), home: b.home ?? self, epoch: Number(b.home_epoch) || 0, state: b.home_state ?? 'active',
      ...(here ? { seq: botSeq(board, b.uid), files: manifestDigest(manifest(b.id, { persons })) } : {}), fork: json(b.home_fork, null) };
  });
  const groups = board.all('SELECT * FROM bot_groups WHERE uid IS NOT NULL ORDER BY id').filter(mine).map((g) => {
    const person = personOfRow(board, g);
    return { kind: 'group', uid: g.uid, name: g.name, person, forPerson: forPerson(person), home: g.home ?? self, epoch: Number(g.home_epoch) || 0, ...(isHomeHere(board, g, self) ? { seq: botSeq(board, g.uid) } : {}) };
  });
  return { v: REPLICA_V, self, bots, groups };
}
// One page of changes of a bot (or a group) run here, after `since`. Each change names a row by uid; the page carries
// that row as it is now (a row changed three times travels once).
export function buildPage(board, uid, since = 0, { persons, forPerson = () => null, limit = PAGE_MAX } = {}) {
  const self = selfId(board);
  const bot = botByUid(board, uid); const group = bot ? null : groupByUid(board, uid);
  const row = bot ?? group;
  if (!row) {
    // Gone: the log says it was deleted here (a replica deletes its copy too).
    const del = board.one("SELECT seq FROM bot_changes WHERE bot_uid = ? AND kind = 'delete' ORDER BY seq DESC LIMIT 1", String(uid));
    if (del) return { v: REPLICA_V, uid, home: self, deleted: true, seq: del.seq, top: del.seq, more: false };
    throw err('no existe', { status: 404 });
  }
  if (!isHomeHere(board, row, self)) throw err('no se ejecuta aquí', { status: 409, notHome: true, home: row.home, epoch: row.home_epoch });
  const owner = board.ownerId?.();
  if (persons && !persons.has(row.person_id ?? owner)) throw err('no es tuyo', { status: 403 });
  const changes = board.all('SELECT seq, kind, ref_uid FROM bot_changes WHERE bot_uid = ? AND seq > ? ORDER BY seq LIMIT ?', String(uid), Number(since) || 0, limit + 1);
  const more = changes.length > limit; if (more) changes.pop();
  const refs = (kind) => [...new Set(changes.filter((c) => c.kind === kind && c.ref_uid).map((c) => c.ref_uid))];
  const pick = (sql, ids) => (ids.length ? board.all(`${sql} IN (${inList(ids.length)}) ORDER BY id`, ...ids) : []);
  const conv = new Map();
  const convOf = (id) => { if (!conv.has(id)) conv.set(id, board.one('SELECT id, bot_id, group_id, person_id FROM conversations WHERE id = ?', id)); return conv.get(id); };
  const reqUid = (id) => (id ? board.one('SELECT uid FROM bot_requests WHERE id = ?', Number(id))?.uid ?? null : null);
  const chat = pick('SELECT * FROM chat WHERE uid', refs('chat')).map((l) => {
    const c = convOf(l.conversation_id); const meta = json(l.meta, null);
    const cp = c ? c.person_id ?? owner : owner;
    if (persons && !persons.has(cp) && !group) return null; // another person's conversation with a shared bot
    const refBot = meta?.bot ? board.one('SELECT uid FROM bots WHERE id = ?', Number(meta.bot))?.uid ?? null : null;
    return { uid: l.uid, role: l.role, body: l.body, meta, at: l.at, author: l.person_id ?? null, authorFor: l.person_id ? forPerson(l.person_id) : null,
      conv: { person: cp, forPerson: forPerson(cp), group: Boolean(c?.group_id) }, refs: { bot: refBot, request: reqUid(meta?.request) } };
  }).filter(Boolean);
  const reminders = bot ? pick('SELECT * FROM bot_reminders WHERE uid', refs('reminder')).filter((r) => !persons || persons.has(r.person_id ?? owner))
    .map((r) => ({ ...r, id: undefined, bot_id: undefined, person: r.person_id ?? owner, forPerson: forPerson(r.person_id ?? owner), person_id: undefined })) : [];
  const memlog = bot ? pick('SELECT * FROM memory_log WHERE uid', refs('memlog')).map((m) => {
    const t = /^bot:\d+(?::(.+))?$/.exec(m.scope ?? ''); if (!t) return null;
    if (t[1] && persons && !persons.has(t[1])) return null;
    return { uid: m.uid, at: m.at, person: m.person_id, forPerson: forPerson(m.person_id), which: t[1] ? 'mine' : 'bot', scopePerson: t[1] ?? null, scopeFor: t[1] ? forPerson(t[1]) : null,
      actor: m.actor, op: m.op, status: m.status, text: m.text, before: m.before };
  }).filter(Boolean) : [];
  const requests = bot ? pick('SELECT * FROM bot_requests WHERE uid', refs('request')).map((r) => ({ uid: r.uid, kind: r.kind, payload: r.payload, status: r.status, result: r.result, created_at: r.created_at, updated_at: r.updated_at,
    person: r.person_id ?? null, forPerson: r.person_id ? forPerson(r.person_id) : null })) : [];
  const out = { v: REPLICA_V, uid, kind: bot ? 'bot' : 'group', home: self, epoch: Number(row.home_epoch) || 0, seq: changes.at(-1)?.seq ?? (Number(since) || 0), top: botSeq(board, uid), more,
    chat, reminders, memlog, requests, who: Object.fromEntries([...(persons ?? [])].map((p) => [p, forPerson(p)])) };
  if (bot) { out.bot = serializeBot(bot); out.person = personOfRow(board, bot); out.forPerson = forPerson(out.person); }
  else { out.group = { uid: group.uid, name: group.name, icon: group.icon, created_at: group.created_at, home_epoch: group.home_epoch, members: board.all('SELECT b.uid FROM bot_group_members m JOIN bots b ON b.id = m.bot_id WHERE m.group_id = ? ORDER BY m.position', group.id).map((x) => x.uid) };
    out.person = personOfRow(board, group); out.forPerson = forPerson(out.person); }
  if (!more && bot) { out.manifest = manifest(bot.id, { persons }); out.files = manifestDigest(out.manifest); }
  return out;
}
// A piece of a file of a bot run here (path as in its manifest).
export function buildFile(board, uid, rel, offset = 0, { persons = null } = {}) {
  const bot = botByUid(board, uid);
  if (!bot || !isHomeHere(board, bot)) throw err('no se ejecuta aquí', { status: 409 });
  const r = String(rel ?? '');
  if (!replicable(r)) throw err('ese archivo no se copia', { status: 403 });
  const pf = personFile(r); if (pf && persons && !persons.has(pf)) throw err('no es tuyo', { status: 403 });
  const file = path.join(botDir(bot.id), ...r.split('/'));
  if (!path.resolve(file).startsWith(path.resolve(botDir(bot.id)) + path.sep)) throw err('ese archivo no se copia', { status: 403 });
  const size = fs.statSync(file).size; if (size > FILE_MAX) throw err('demasiado grande', { status: 413 });
  const start = Math.max(0, Number(offset) || 0);
  const fd = fs.openSync(file, 'r');
  try { const buf = Buffer.alloc(Math.min(CHUNK, Math.max(0, size - start))); fs.readSync(fd, buf, 0, buf.length, start); return { size, offset: start, data: buf.toString('base64'), done: start + buf.length >= size }; }
  finally { fs.closeSync(fd); }
}

// ---- the replica's side
// map(remotePerson, forPerson) → a person here or null (src/core/link-persons.mjs, through the engine).
const uniqueName = (board, person, name, uid) => {
  const owner = board.ownerId?.();
  const taken = (n) => board.one(`SELECT id FROM bots WHERE name = ? COLLATE NOCASE AND ${person === owner ? '(person_id = ? OR person_id IS NULL)' : 'person_id = ?'} AND (uid IS NULL OR uid != ?)`, n, person, uid);
  let n = String(name).slice(0, 40); for (let k = 2; taken(n) && k < 100; k++) n = `${String(name).slice(0, 36)} · ${k}`;
  return n;
};
// The bot's row as the home sent it, here (created when it is new). → { id, created, renamed } or null (not mapped).
export function upsertBot(board, b, { person, home, epoch, state = null }) {
  const local = botByUid(board, b.uid);
  const st = state ?? (b.home_state === 'pending' ? 'active' : b.home_state) ?? 'active';
  const fields = { icon: b.icon ?? '', avatar: b.avatar, role_text: b.role_text ?? '', agent: b.agent ?? 'claude', model: b.model, effort: b.effort ?? 'medium', tools: b.tools ?? '[]', accounts: b.accounts ?? '{}', exclusive: b.exclusive ?? '[]',
    is_chief: Number(b.is_chief) ? 1 : 0, paused: Number(b.paused) ? 1 : 0, caps: b.caps, needs: b.needs, updated_at: b.updated_at ?? now() };
  if (local) {
    if (isHomeHere(board, local)) return { id: local.id, created: false, here: true };
    // A chief is one per person: the copy's flag does not take it from the bots run here.
    const name = uniqueName(board, local.person_id ?? board.ownerId?.(), b.name, b.uid);
    const cols = Object.keys(fields);
    board.run(`UPDATE bots SET ${cols.map((k) => `${k} = ?`).join(', ')}, name = ?, home = ?, home_epoch = ?, home_state = ? WHERE id = ?`, ...cols.map((k) => fields[k] ?? null), name, home, Number(epoch) || 0, st, local.id);
    return { id: local.id, created: false, renamed: name !== b.name ? name : null };
  }
  if (!person) return null;
  const name = uniqueName(board, person, b.name, b.uid);
  const cols = Object.keys(fields);
  const { lastInsertRowid } = board.run(`INSERT INTO bots (uid, name, ${cols.join(', ')}, created_at, person_id, home, home_epoch, home_state) VALUES (?, ?, ${inList(cols.length)}, ?, ?, ?, ?, ?)`,
    b.uid, name, ...cols.map((k) => fields[k] ?? null), b.created_at ?? now(), person === board.ownerId?.() ? person : person, home, Number(epoch) || 0, st);
  const id = Number(lastInsertRowid);
  if (!b.avatar) board.run('UPDATE bots SET avatar = ? WHERE id = ?', JSON.stringify(avatarFor(id)), id);
  ensureMemory(id);
  return { id, created: true, renamed: name !== b.name ? name : null };
}
function convFor(board, botRow, person, groupRow = null) {
  if (groupRow) {
    const c = board.one('SELECT id FROM conversations WHERE group_id = ? ORDER BY id LIMIT 1', groupRow.id)?.id;
    if (c) return c;
    const at = now();
    return Number(board.run('INSERT INTO conversations (title, titled, group_id, created_at, updated_at, person_id) VALUES (?, 1, ?, ?, ?, ?)', groupRow.name, groupRow.id, at, at, groupRow.person_id ?? null).lastInsertRowid);
  }
  const owner = board.ownerId?.();
  const where = person === owner ? '(person_id = ? OR person_id IS NULL)' : 'person_id = ?';
  const c = board.one(`SELECT id FROM conversations WHERE bot_id = ? AND group_id IS NULL AND ${where} ORDER BY id LIMIT 1`, botRow.id, person)?.id;
  if (c) return c;
  const at = now();
  return Number(board.run('INSERT INTO conversations (title, titled, agent, model, reasoning, bot_id, created_at, updated_at, person_id) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)', botRow.name, botRow.agent, botRow.model ?? null, 'medium', botRow.id, at, at, person).lastInsertRowid);
}
// meta of a line here: the bot and the request it names are this Orb's rows of those uids.
function localMeta(board, line) {
  const m = line.meta && typeof line.meta === 'object' ? { ...line.meta } : null;
  if (!m) return null;
  if (line.refs?.bot) { const b = botByUid(board, line.refs.bot); if (b) m.bot = b.id; }
  if (line.refs?.request) { const r = board.one('SELECT id FROM bot_requests WHERE uid = ?', line.refs.request); m.request = r?.id ?? null; m.requestUid = line.refs.request; }
  if (Array.isArray(m.approvers) || m.talker) m.remote = true; // its people are the home's: answered there
  return m;
}
// Insert or update one chat line by uid. → 'new' | 'updated' | 'same' | null (no conversation for it here)
export function upsertLine(board, line, { conv, author = null, mark = null }) {
  if (!conv || !isUid(line.uid)) return null;
  const meta = localMeta(board, line);
  if (mark) Object.assign(meta ?? (line.meta = {}), mark);
  const metaText = meta || mark ? JSON.stringify({ ...(meta ?? {}), ...(mark ?? {}) }) : null;
  const have = board.one('SELECT id, body, meta FROM chat WHERE uid = ?', line.uid);
  if (have) {
    if (have.body === String(line.body) && (have.meta ?? null) === metaText) return 'same';
    board.run('UPDATE chat SET body = ?, meta = ? WHERE id = ?', String(line.body), metaText, have.id);
    return 'updated';
  }
  board.run('INSERT INTO chat (uid, role, body, meta, at, conversation_id, person_id) VALUES (?, ?, ?, ?, ?, ?, ?)', line.uid, line.role, String(line.body), metaText, line.at ?? now(), conv, author);
  if (line.role !== 'notice') board.run('UPDATE conversations SET updated_at = MAX(updated_at, ?) WHERE id = ?', line.at ?? now(), conv);
  return 'new';
}
// A page from the home, here. map(person, forPerson) → a person here or null. → { applied, lines, skipped, id }
export function applyPage(board, page, { map, mark = null } = {}) {
  if (!page || page.v !== REPLICA_V) throw err('versión de copia desconocida', { status: 426 });
  if (page.deleted) {
    const b = botByUid(board, page.uid);
    if (b && !isHomeHere(board, b)) return { deleted: true, id: b.id };
    const g = groupByUid(board, page.uid);
    if (g && !isHomeHere(board, g)) return { deleted: true, group: g.id };
    return { deleted: false };
  }
  const out = { lines: 0, updated: 0, reminders: 0, memlog: 0, requests: 0, skipped: 0 };
  return board.transaction(() => {
    let botRow = null; let groupRow = null;
    if (page.kind === 'group') {
      const g = page.group; let local = groupByUid(board, g.uid);
      const person = local?.person_id ?? map(page.person, page.forPerson);
      if (!local && !person) return { ...out, unmapped: true };
      if (local && isHomeHere(board, local)) return { ...out, here: true };
      if (!local) {
        const at = now();
        const id = Number(board.run('INSERT INTO bot_groups (uid, name, icon, created_at, updated_at, person_id, home, home_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', g.uid, g.name, g.icon ?? '', g.created_at ?? at, at, person, page.home, Number(page.epoch) || 0).lastInsertRowid);
        local = board.one('SELECT * FROM bot_groups WHERE id = ?', id);
      } else board.run('UPDATE bot_groups SET name = ?, icon = ?, home = ?, home_epoch = ?, updated_at = ? WHERE id = ?', g.name, g.icon ?? '', page.home, Number(page.epoch) || 0, now(), local.id);
      board.run('DELETE FROM bot_group_members WHERE group_id = ?', local.id);
      (g.members ?? []).map((u) => botByUid(board, u)).filter(Boolean).forEach((b, i) => board.run('INSERT OR IGNORE INTO bot_group_members (group_id, bot_id, position) VALUES (?, ?, ?)', local.id, b.id, i));
      groupRow = board.one('SELECT * FROM bot_groups WHERE id = ?', local.id);
      out.group = groupRow.id;
    } else {
      const person = botByUid(board, page.uid)?.person_id ?? map(page.person, page.forPerson);
      const r = upsertBot(board, page.bot, { person, home: page.home, epoch: page.epoch });
      if (!r) return { ...out, unmapped: true };
      if (r.here) return { ...out, here: true, id: r.id };
      botRow = board.one('SELECT * FROM bots WHERE id = ?', r.id);
      out.id = r.id; out.created = r.created; out.renamed = r.renamed ?? null;
    }
    for (const req of page.requests ?? []) {
      if (!isUid(req.uid) || !botRow) continue;
      const who = req.person ? map(req.person, req.forPerson) : null;
      const have = board.one('SELECT id FROM bot_requests WHERE uid = ?', req.uid);
      if (have) board.run('UPDATE bot_requests SET status = ?, result = ?, updated_at = ? WHERE id = ?', req.status, req.result ?? null, req.updated_at ?? now(), have.id);
      else board.run('INSERT INTO bot_requests (uid, bot_id, kind, payload, status, result, created_at, updated_at, person_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', req.uid, botRow.id, req.kind, req.payload ?? '{}', req.status, req.result ?? null, req.created_at ?? now(), req.updated_at ?? now(), who);
      out.requests++;
    }
    for (const line of page.chat ?? []) {
      const person = line.conv?.group ? null : map(line.conv?.person, line.conv?.forPerson);
      if (!line.conv?.group && !person) { out.skipped++; continue; }
      const conv = convFor(board, botRow, person, groupRow);
      const author = line.author ? map(line.author, line.authorFor) : null;
      const r = upsertLine(board, line, { conv, author, mark });
      if (r === 'new') out.lines++; else if (r === 'updated') out.updated++;
    }
    for (const rem of page.reminders ?? []) {
      if (!isUid(rem.uid) || !botRow) continue;
      const who = map(rem.person, rem.forPerson); if (!who) { out.skipped++; continue; }
      const have = board.one('SELECT id FROM bot_reminders WHERE uid = ?', rem.uid);
      const vals = [rem.text, rem.every, rem.start_at, rem.weekdays ?? '[]', rem.next_run ?? null, rem.last_run ?? null, Number(rem.enabled) ? 1 : 0, rem.tz ?? null, rem.local_at ?? null, rem.skip_missed == null ? 1 : Number(rem.skip_missed) ? 1 : 0, rem.fired_late_ms ?? null];
      if (have) board.run('UPDATE bot_reminders SET text = ?, every = ?, start_at = ?, weekdays = ?, next_run = ?, last_run = ?, enabled = ?, tz = ?, local_at = ?, skip_missed = ?, fired_late_ms = ? WHERE id = ?', ...vals, have.id);
      else board.run('INSERT INTO bot_reminders (text, every, start_at, weekdays, next_run, last_run, enabled, tz, local_at, skip_missed, fired_late_ms, uid, bot_id, created_by, created_at, person_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ...vals, rem.uid, botRow.id, oneLine(String(rem.created_by ?? 'usuario'), 40), rem.created_at ?? now(), who);
      out.reminders++;
    }
    for (const m of page.memlog ?? []) {
      if (!isUid(m.uid) || !botRow) continue;
      const sp = m.scopePerson ? map(m.scopePerson, m.scopeFor) : null;
      if (m.which === 'mine' && !sp) { out.skipped++; continue; }
      const scope = m.which === 'mine' ? `bot:${botRow.id}:${sp}` : `bot:${botRow.id}`;
      const who = m.person ? map(m.person, m.forPerson) : null;
      const have = board.one('SELECT id FROM memory_log WHERE uid = ?', m.uid);
      if (have) board.run('UPDATE memory_log SET status = ?, text = ?, before = ? WHERE id = ?', m.status, m.text, m.before ?? null, have.id);
      else board.run('INSERT INTO memory_log (uid, at, person_id, scope, actor, op, status, text, before) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', m.uid, m.at ?? now(), who, scope, m.actor ?? '', m.op ?? 'append', m.status, m.text ?? '', m.before ?? null);
      out.memlog++;
    }
    return out;
  });
}
// Which files of the manifest are missing or different here. map(person) for personas/<person>.md. → [{ p, local, sha256, size }]
export function filesToFetch(botId, list, mapPerson) {
  const out = [];
  for (const f of list ?? []) {
    if (!replicable(f.p)) continue;
    let local = f.p;
    const pf = personFile(f.p);
    if (pf) { const here = mapPerson(pf); if (!here) continue; local = `personas/${String(here).replace(/[^\w-]/g, '_')}.md`; }
    const file = path.join(botDir(botId), ...local.split('/'));
    let sha = null; try { sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { /* missing */ }
    if (sha !== f.sha256) out.push({ ...f, local });
  }
  return out;
}
// A whole file fetched (its pieces joined): written here only when its hash is the one the manifest said.
export function writeFetched(botId, f, data) {
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  if (sha !== f.sha256) throw err('el archivo no coincide', { status: 409 });
  const file = path.join(botDir(botId), ...f.local.split('/'));
  if (!path.resolve(file).startsWith(path.resolve(botDir(botId)) + path.sep)) throw err('ese archivo no se copia', { status: 403 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file);
}
// The counts and hashes a move checks on both sides before the home changes.
export function verifyCounts(board, botRow, { persons = null } = {}) {
  const owner = board.ownerId?.();
  const convs = board.all('SELECT id, person_id FROM conversations WHERE bot_id = ? AND group_id IS NULL', botRow.id).filter((c) => !persons || persons.has(c.person_id ?? owner)).map((c) => c.id);
  const lines = convs.length ? board.all(`SELECT uid FROM chat WHERE uid IS NOT NULL AND conversation_id IN (${inList(convs.length)}) ORDER BY uid`, ...convs).map((r) => r.uid) : [];
  const rems = board.all('SELECT uid, enabled, next_run FROM bot_reminders WHERE bot_id = ? AND uid IS NOT NULL ORDER BY uid', botRow.id).filter(Boolean);
  const files = manifest(botRow.id, { persons });
  return { lines: lines.length, linesHash: crypto.createHash('sha256').update(lines.join(',')).digest('hex').slice(0, 24),
    reminders: rems.filter((r) => r.enabled).length, files: manifestDigest(files.filter((f) => !personFile(f.p))) };
}

// After a bot became this Orb's (a move, a takeover): every row of it goes into this Orb's change log, so a copy made
// later on any other Orb gets its whole history from here.
export function relogAll(board, row, { group = false } = {}) {
  const at = now();
  const add = (kind, uids) => { for (const u of uids) board.run('INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) VALUES (?, ?, ?, ?)', row.uid, kind, u, at); };
  const convs = board.all(`SELECT id FROM conversations WHERE ${group ? 'group_id' : 'bot_id'} = ?${group ? '' : ' AND group_id IS NULL'}`, row.id).map((c) => c.id);
  if (convs.length) add('chat', board.all(`SELECT uid FROM chat WHERE uid IS NOT NULL AND conversation_id IN (${inList(convs.length)}) ORDER BY id`, ...convs).map((r) => r.uid));
  if (group) return;
  add('reminder', board.all('SELECT uid FROM bot_reminders WHERE bot_id = ? AND uid IS NOT NULL', row.id).map((r) => r.uid));
  add('request', board.all('SELECT uid FROM bot_requests WHERE bot_id = ? AND uid IS NOT NULL', row.id).map((r) => r.uid));
  add('memlog', board.all("SELECT uid FROM memory_log WHERE uid IS NOT NULL AND (scope = ? OR scope LIKE ?)", `bot:${row.id}`, `bot:${row.id}:%`).map((r) => r.uid));
}
// The old home came back after a forced takeover: what it did meanwhile joins this Orb's (the new home's) bot, never over
// what is here. Its lines are added marked «while it was cut off» (mark), its memory changes become pending proposals for
// the memory's person, the reminders it rang are told in a line. → counts
export function reconcilePage(board, page, botRow, { map, mark, fired = () => {} }) {
  const out = { lines: 0, proposals: 0, rang: 0 };
  board.transaction(() => {
    for (const line of page.chat ?? []) {
      if (!isUid(line.uid) || board.one('SELECT 1 FROM chat WHERE uid = ?', line.uid)) continue;
      const person = map(line.conv?.person, line.conv?.forPerson); if (!person) continue;
      const conv = convFor(board, botRow, person);
      if (upsertLine(board, line, { conv, author: line.author ? map(line.author, line.authorFor) : null, mark }) === 'new') out.lines++;
    }
    for (const m of page.memlog ?? []) {
      if (!isUid(m.uid) || m.status !== 'applied' || board.one('SELECT 1 FROM memory_log WHERE uid = ?', m.uid)) continue;
      const sp = m.scopePerson ? map(m.scopePerson, m.scopeFor) : null;
      if (m.which === 'mine' && !sp) continue;
      const who = m.person ? map(m.person, m.forPerson) : sp;
      board.run("INSERT INTO memory_log (uid, at, person_id, scope, actor, op, status, text) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)", m.uid, m.at ?? now(), who ?? null,
        m.which === 'mine' ? `bot:${botRow.id}:${sp}` : `bot:${botRow.id}`, String(m.actor ?? '').slice(0, 60), m.op === 'replace' ? 'replace' : 'append', m.text ?? '');
      out.proposals++;
    }
    for (const r of page.reminders ?? []) {
      const have = isUid(r.uid) ? board.one('SELECT last_run FROM bot_reminders WHERE uid = ?', r.uid) : null;
      if (r.last_run && (!have || String(have.last_run ?? '') < String(r.last_run))) { const who = map(r.person, r.forPerson); if (who) { fired(r, who); out.rang++; } }
    }
  });
  return out;
}
