// 3.6 «Personas»: the people who use one Orb. Two roles only: «owner» (manages the Orb; sees names and usage numbers of
// the others, never their content) and «user» (their own things and what is shared with them). One owner per Orb.
// Every function takes a board-like object ({ one, all, run }): the engine's Board, or the raw database during the
// migration (see dbLike). No engine imports: the MCP processes use it too.
import crypto from 'node:crypto';
import { ctx, tr } from './context.mjs';
import { oneLine } from './safety.mjs';

export const ROLES = ['owner', 'user'];
// 3.7 (WS6): vault: may use a password vault on Orb Server (vault_fill). The owner always may; others when the owner allows.
export const CAPS = ['dev', 'house', 'approveHouse', 'vault'];
// PIN: 4 to 12 digits, kept as scrypt(pin, salt). 5 wrong tries lock it; each further wrong try doubles the wait.
export const PIN_TRIES = 5;
const LOCK_FIRST_S = 30; const LOCK_MAX_S = 3600;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
// Strong tickets: a correct PIN gives one for 5 minutes, bound to the device it was typed on.
export const TICKET_MS = 5 * 60_000;

const now = () => new Date().toISOString();
const bad = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });
export const dbLike = (db) => ({ one: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), run: (s, ...p) => db.prepare(s).run(...p) });
const newId = () => `p-${crypto.randomBytes(6).toString('hex')}`;
export const systemTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const validTz = (tz) => { try { Intl.DateTimeFormat('en', { timeZone: String(tz) }); return true; } catch { return false; } };
const cleanName = (name) => { const n = oneLine(String(name ?? ''), 40).trim(); if (!n) throw bad('msg.persons.needName'); return n; };
const parseCaps = (s) => { try { const c = JSON.parse(s || '{}'); return Object.fromEntries(CAPS.map((k) => [k, c?.[k] === true])); } catch { return Object.fromEntries(CAPS.map((k) => [k, false])); } };

// A person as the code sees it (never the PIN's hash or salt).
export function publicPerson(r) {
  if (!r) return null;
  return { id: r.id, name: r.name, role: r.role, language: r.language ?? null, tz: r.tz ?? null, color: r.color ?? null, caps: parseCaps(r.caps),
    hasPin: Boolean(r.pin_hash), locked: Boolean(r.pin_locked_until && Date.parse(r.pin_locked_until) > Date.now()), created_at: r.created_at, deleted_at: r.deleted_at ?? null };
}

// ---- the owner
// The owner's id, made on the first call when there is none (name from the settings' userName, else «Owner» in the
// app's language; language and time zone of this PC). Callers that may race (several processes) run it inside
// BEGIN IMMEDIATE; the unique index persons_owner keeps one owner anyway.
export function ensureOwner(board) {
  const found = board.one("SELECT id FROM persons WHERE role = 'owner' AND deleted_at IS NULL LIMIT 1")?.id;
  if (found) return found;
  const id = newId();
  const name = oneLine(String(ctx.config?.userName ?? '').trim(), 40) || tr('msg.persons.ownerName');
  board.run("INSERT INTO persons (id, name, role, language, tz, caps, created_at) VALUES (?, ?, 'owner', ?, ?, ?, ?)", id, name,
    ctx.config?.language ?? 'es', systemTz(), JSON.stringify({ dev: true, house: true, approveHouse: true }), now());
  return id;
}
// The owner's id without creating one (null on a database before 3.6).
export function ownerId(board) {
  try { return board.one("SELECT id FROM persons WHERE role = 'owner' AND deleted_at IS NULL LIMIT 1")?.id ?? null; } catch { return null; }
}

// ---- people
export const getPerson = (board, id) => publicPerson(board.one('SELECT * FROM persons WHERE id = ?', String(id ?? '')));
export const listPersons = (board, { deleted = false } = {}) => board.all(`SELECT * FROM persons ${deleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at, id`).map(publicPerson);
export const personsCount = (board) => { try { return board.one('SELECT COUNT(*) AS n FROM persons WHERE deleted_at IS NULL').n; } catch { return 1; } };
export function mustPerson(board, id) { const p = getPerson(board, id); if (!p || p.deleted_at) throw bad('msg.persons.noPerson'); return p; }
// The name a person is called by (the owner: the settings' userName first, as before 3.6).
export function personName(board, id) {
  const p = id ? getPerson(board, id) : null;
  if (p?.role === 'owner' || (!p && !id)) return ctx.config?.userName?.trim() || p?.name || tr('msg.board.theUser');
  return p?.name ?? tr('msg.board.theUser');
}

// A new person (always a «user»: there is one owner). Names are unique among the people of this Orb (case-insensitive).
export function createPerson(board, { name, language = null, tz = null, color = null, caps = {} } = {}) {
  const n = cleanName(name);
  if (board.one('SELECT 1 AS x FROM persons WHERE deleted_at IS NULL AND lower(name) = lower(?)', n)) throw bad('msg.persons.nameTaken');
  if (tz != null && !validTz(tz)) throw bad('msg.persons.badTz');
  const id = newId();
  board.run("INSERT INTO persons (id, name, role, language, tz, caps, color, created_at) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)", id, n,
    ['es', 'en'].includes(language) ? language : (ctx.config?.language ?? 'es'), tz ?? systemTz(), JSON.stringify(cleanCaps(caps)), color ? oneLine(String(color), 20) : null, now());
  return getPerson(board, id);
}
const cleanCaps = (caps) => Object.fromEntries(CAPS.map((k) => [k, caps?.[k] === true]));
export function renamePerson(board, id, name) {
  const p = mustPerson(board, id); const n = cleanName(name);
  if (board.one('SELECT 1 AS x FROM persons WHERE deleted_at IS NULL AND lower(name) = lower(?) AND id <> ?', n, p.id)) throw bad('msg.persons.nameTaken');
  board.run('UPDATE persons SET name = ? WHERE id = ?', n, p.id);
  return getPerson(board, p.id);
}
export function updatePerson(board, id, { language, tz, color } = {}) {
  const p = mustPerson(board, id);
  if (language !== undefined && !['es', 'en'].includes(language)) throw bad('msg.persons.badLanguage');
  if (tz !== undefined && tz !== null && !validTz(tz)) throw bad('msg.persons.badTz');
  if (language !== undefined) board.run('UPDATE persons SET language = ? WHERE id = ?', language, p.id);
  if (tz !== undefined) board.run('UPDATE persons SET tz = ? WHERE id = ?', tz ?? systemTz(), p.id);
  if (color !== undefined) board.run('UPDATE persons SET color = ? WHERE id = ?', color ? oneLine(String(color), 20) : null, p.id);
  return getPerson(board, p.id);
}
export function setCaps(board, id, caps) {
  const p = mustPerson(board, id);
  board.run('UPDATE persons SET caps = ? WHERE id = ?', JSON.stringify({ ...p.caps, ...cleanCaps({ ...p.caps, ...caps }) }), p.id);
  return getPerson(board, p.id);
}
// 3.6 (WS1): a soft delete only (deleted_at); the full removal of a person's data (export first, devices, shares, files…)
// is persons.remove's job in WS5. The owner cannot be removed.
export function removePerson(board, id) {
  const p = mustPerson(board, id);
  if (p.role === 'owner') throw bad('msg.persons.ownerStays');
  board.run('UPDATE persons SET deleted_at = ? WHERE id = ?', now(), p.id);
  return { id: p.id, deleted: true };
}

// ---- PIN
const checkPinFormat = (pin) => { if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) throw bad('msg.persons.badPin'); return pin; };
const hashPin = (pin, salt) => crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32, SCRYPT).toString('hex');
// pin null: no PIN any more (the owner's reset, orb-server pin-reset).
export function setPin(board, id, pin) {
  const p = mustPerson(board, id);
  if (pin == null || pin === '') { board.run('UPDATE persons SET pin_hash = NULL, pin_salt = NULL, pin_fails = 0, pin_locked_until = NULL WHERE id = ?', p.id); return { hasPin: false }; }
  const salt = crypto.randomBytes(16).toString('hex');
  board.run('UPDATE persons SET pin_hash = ?, pin_salt = ?, pin_fails = 0, pin_locked_until = NULL WHERE id = ?', hashPin(checkPinFormat(pin), salt), salt, p.id);
  return { hasPin: true };
}
const lockSeconds = (fails) => Math.min(LOCK_FIRST_S * 2 ** Math.max(0, fails - PIN_TRIES), LOCK_MAX_S);
// → { ok: true, ticket, until } | { ok: false, reason: 'noPin' | 'wrong' | 'locked', triesLeft?, lockedUntil? }. A person
// without a PIN has nothing to check (ok, with a ticket: the PIN is the only proof there is).
export function verifyPin(board, id, pin, { device = null } = {}) {
  const r = board.one('SELECT * FROM persons WHERE id = ? AND deleted_at IS NULL', String(id ?? ''));
  if (!r) throw bad('msg.persons.noPerson');
  if (!r.pin_hash) return { ok: true, noPin: true, ...issueTicket(r.id, device) };
  if (r.pin_locked_until && Date.parse(r.pin_locked_until) > Date.now()) return { ok: false, reason: 'locked', lockedUntil: r.pin_locked_until };
  const given = typeof pin === 'string' && /^\d{4,12}$/.test(pin) ? hashPin(pin, r.pin_salt) : null;
  const right = given && crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(r.pin_hash, 'hex'));
  if (right) { board.run('UPDATE persons SET pin_fails = 0, pin_locked_until = NULL WHERE id = ?', r.id); return { ok: true, ...issueTicket(r.id, device) }; }
  const fails = Number(r.pin_fails ?? 0) + 1;
  const lockedUntil = fails >= PIN_TRIES ? new Date(Date.now() + lockSeconds(fails) * 1000).toISOString() : null;
  board.run('UPDATE persons SET pin_fails = ?, pin_locked_until = ? WHERE id = ?', fails, lockedUntil, r.id);
  return lockedUntil ? { ok: false, reason: 'locked', lockedUntil } : { ok: false, reason: 'wrong', triesLeft: PIN_TRIES - fails };
}

// ---- strong tickets (memory only: a restart asks for the PIN again)
const tickets = new Map(); // token → { person, device, until }
export function issueTicket(person, device = null) {
  for (const [k, t] of tickets) if (t.until <= Date.now()) tickets.delete(k);
  const ticket = crypto.randomBytes(24).toString('hex'); const until = Date.now() + TICKET_MS;
  tickets.set(ticket, { person: String(person), device: device == null ? null : String(device), until });
  return { ticket, until };
}
// The ticket's end time when it is valid for that person on that device, else 0.
export function checkTicket(ticket, person, device = null) {
  const t = typeof ticket === 'string' ? tickets.get(ticket) : null;
  if (!t || t.until <= Date.now() || t.person !== String(person) || t.device !== (device == null ? null : String(device))) return 0;
  return t.until;
}
export const dropTickets = (person) => { for (const [k, t] of tickets) if (t.person === String(person)) tickets.delete(k); };

// ---- the owner's overview: numbers only, never titles, names of things or content.
export function overview(board) {
  const day = new Date().toISOString().slice(0, 10);
  const count = (table, pid, extra = '') => { try { return board.one(`SELECT COUNT(*) AS n FROM ${table} WHERE person_id = ?${extra}`, pid).n; } catch { return 0; } };
  const owner = ownerId(board);
  return listPersons(board).map((p) => {
    // Rows from before 3.6 code stamped them (person_id NULL) are the owner's.
    const c = (table, extra = '') => count(table, p.id, extra) + (p.id === owner ? (board.one(`SELECT COUNT(*) AS n FROM ${table} WHERE person_id IS NULL${extra}`)?.n ?? 0) : 0);
    const usage = board.one('SELECT COALESCE(SUM(turns), 0) AS turns, COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS tokens, COALESCE(SUM(usd), 0) AS usd FROM usage_ledger WHERE person_id = ? AND day = ?', p.id, day);
    const seen = board.one('SELECT MAX(last_seen) AS at FROM devices WHERE person_id = ?', p.id)?.at ?? null;
    return { id: p.id, name: p.name, role: p.role, hasPin: p.hasPin, caps: p.caps, devices: c('devices'), lastSeen: seen,
      counts: { bots: c('bots'), botsPaused: c('bots', ' AND paused = 1'), groups: c('bot_groups'), conversations: c('conversations', ' AND bot_id IS NULL AND group_id IS NULL'), tasks: c('tasks'), schedules: c('schedules'), projects: c('projects'), reminders: c('bot_reminders', ' AND enabled = 1') },
      today: { turns: Number(usage?.turns ?? 0), tokens: Number(usage?.tokens ?? 0), usd: Number(usage?.usd ?? 0) } };
  });
}

// 3.7 (Orb Server, WS6): who may connect a password vault and let bots sign in with it: the owner, or a person the owner
// gave the «vault» capability.
export function mayUseVault(board, person) {
  if (!person) return false;
  const r = board.one('SELECT role, caps FROM persons WHERE id = ? AND deleted_at IS NULL', String(person));
  if (!r) return false;
  return r.role === 'owner' || parseCaps(r.caps).vault === true;
}
