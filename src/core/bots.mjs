// 3.5: the user's bots, shared by the engine (src/engine/bots.mjs) and the bots' tools (src/mcp/bot.mjs). Orb ships no bot
// of anybody's: only the system, and an empty «Asistente» on the first run that the user renames or deletes. Everything
// here reads and writes the database and the bots' memory files; nothing runs an agent.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from './context.mjs';
import { AGENT_IDS } from './home.mjs';
import { oneLine, looksPrivateText } from './safety.mjs';
import { protectedHit } from './guard.mjs';

// The tool groups a bot can have (casillas). Memory, messages to other bots, the list of bots and questions to the user
// are always there. gestion: create, change and pause bots (always with the user's approval); the chief has it.
export const TOOL_GROUPS = ['internet', 'recordatorios', 'correo', 'calendario', 'navegador', 'casa', 'servidor', 'gestion'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
export const EVERY = ['once', 'daily', 'weekly', 'monthly', 'yearly'];
const STARTER_TOOLS = ['internet', 'recordatorios'];
const MEMORY_MAX = 64 * 1024;
const now = () => new Date().toISOString();
const json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const bad = (key, vars) => { const e = new Error(tr(key, vars)); e.userFacing = true; return e; };

export function parseBot(r) {
  if (!r) return null;
  return { ...r, tools: json(r.tools, []), accounts: json(r.accounts, {}), exclusive: json(r.exclusive, []), is_chief: Boolean(r.is_chief), paused: Boolean(r.paused) };
}
export const listBots = (board) => board.all('SELECT * FROM bots ORDER BY is_chief DESC, id').map(parseBot);
export function getBot(board, idOrName) {
  if (idOrName == null || idOrName === '') return null;
  const n = Number(idOrName);
  const row = Number.isInteger(n) && String(idOrName).trim() === String(n) ? board.one('SELECT * FROM bots WHERE id = ?', n) : board.one('SELECT * FROM bots WHERE name = ? COLLATE NOCASE', String(idOrName).trim());
  return parseBot(row);
}
export function mustBot(board, idOrName) { const b = getBot(board, idOrName); if (!b) throw bad('msg.bots.noBot', { name: String(idOrName ?? '') }); return b; }

// The fields of a bot, checked (partial: only the ones given). Throws a message for the user.
export function checkBotFields(board, f, { partial = false, id = null } = {}) {
  const out = {};
  const has = (k) => f[k] !== undefined;
  if (!partial || has('name')) {
    const name = oneLine(String(f.name ?? ''), 60).trim();
    if (!name || name.length > 40) throw bad('msg.bots.badName');
    if (/^\d+$/.test(name)) throw bad('msg.bots.badName');
    const other = board.one('SELECT id FROM bots WHERE name = ? COLLATE NOCASE', name);
    if (other && other.id !== id) throw bad('msg.bots.nameTaken', { name });
    out.name = name;
  }
  if (has('icon')) { const icon = String(f.icon ?? '').trim(); if (icon.length > 16) throw bad('msg.bots.badField', { name: 'icon' }); out.icon = icon; }
  if (has('role_text')) { const role = String(f.role_text ?? '').trim(); if (role.length > 4000) throw bad('msg.bots.badField', { name: 'role_text' }); out.role_text = role; }
  if (!partial || has('agent')) {
    const agent = f.agent ?? ctx.config.orchestrator?.agent ?? 'claude';
    if (!AGENT_IDS.includes(agent)) throw bad('msg.bots.badField', { name: 'agent' });
    out.agent = agent;
  }
  if (has('model')) {
    const model = f.model ? String(f.model) : null;
    if (model && !/^[A-Za-z0-9][\w.:\-/[\]=,@]{0,79}$/.test(model)) throw bad('msg.bots.badField', { name: 'model' });
    out.model = model;
  }
  if (!partial || has('effort')) { const effort = f.effort ?? 'medium'; if (!EFFORTS.includes(effort)) throw bad('msg.bots.badField', { name: 'effort' }); out.effort = effort; }
  if (!partial || has('tools')) {
    const tools = f.tools ?? STARTER_TOOLS;
    if (!Array.isArray(tools) || tools.some((t) => !TOOL_GROUPS.includes(t))) throw bad('msg.bots.badTools', { list: TOOL_GROUPS.join(', ') });
    out.tools = [...new Set(tools)];
  }
  if (has('accounts')) {
    const a = f.accounts ?? {};
    if (!a || typeof a !== 'object' || Array.isArray(a) || JSON.stringify(a).length > 4000) throw bad('msg.bots.badField', { name: 'accounts' });
    if (a.mcp !== undefined && (!Array.isArray(a.mcp) || a.mcp.some((n) => typeof n !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(n) || n.toLowerCase() === 'orb' || n.toLowerCase() === 'bot'))) throw bad('msg.bots.badField', { name: 'accounts.mcp' });
    if (looksPrivateText(JSON.stringify(a))) throw bad('msg.bots.secretInAccounts');
    out.accounts = a;
  }
  if (has('exclusive')) {
    const list = f.exclusive ?? [];
    if (!Array.isArray(list) || list.length > 20 || list.some((x) => typeof x !== 'string' || !x.trim() || x.length > 40)) throw bad('msg.bots.badField', { name: 'exclusive' });
    out.exclusive = [...new Set(list.map(topicKey))];
  }
  if (has('is_chief')) out.is_chief = Boolean(f.is_chief);
  if (has('paused')) out.paused = Boolean(f.paused);
  return out;
}
export const topicKey = (s) => oneLine(String(s ?? ''), 40).trim().toLowerCase();

const COLUMNS = ['name', 'icon', 'role_text', 'agent', 'model', 'effort', 'tools', 'accounts', 'exclusive', 'is_chief', 'paused'];
const dbValue = (k, v) => (['tools', 'accounts', 'exclusive'].includes(k) ? JSON.stringify(v) : ['is_chief', 'paused'].includes(k) ? Number(Boolean(v)) : v ?? null);

export function createBot(board, fields) {
  const f = checkBotFields(board, fields);
  return board.transaction(() => {
    if (f.is_chief) board.run('UPDATE bots SET is_chief = 0');
    const at = now(); const cols = COLUMNS.filter((k) => f[k] !== undefined);
    const { lastInsertRowid } = board.run(`INSERT INTO bots (${cols.join(', ')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`, ...cols.map((k) => dbValue(k, f[k])), at, at);
    const bot = getBot(board, Number(lastInsertRowid));
    ensureMemory(bot.id);
    return bot;
  });
}
export function updateBot(board, id, fields) {
  const bot = mustBot(board, id);
  const f = checkBotFields(board, fields, { partial: true, id: bot.id });
  const cols = COLUMNS.filter((k) => f[k] !== undefined);
  if (!cols.length) return bot;
  return board.transaction(() => {
    if (f.is_chief) board.run('UPDATE bots SET is_chief = 0 WHERE id != ?', bot.id);
    board.run(`UPDATE bots SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...cols.map((k) => dbValue(k, f[k])), now(), bot.id);
    return getBot(board, bot.id);
  });
}
// A bot removed: its row, its groups' places, its reminders, its waiting requests and its conversation. 3.5.1: its folder
// (memory and anything it kept) leaves bots\ too: it goes to Orb's own data (bots-borrados, where no agent or bot reads)
// and is deleted for good after 30 days.
export const TRASH_DAYS = 30;
export const botsTrash = () => path.join(ctx.paths.internal ?? path.join(ctx.home, '.orb', 'datos'), 'bots-borrados');
export function trashBotFolder(id, at = Date.now()) {
  const from = botDir(id);
  const trash = botsTrash();
  try {
    fs.mkdirSync(trash, { recursive: true });
    for (const name of fs.readdirSync(trash)) {
      const m = name.match(/-(\d{13})$/);
      if (m && at - Number(m[1]) > TRASH_DAYS * 86_400_000) fs.rmSync(path.join(trash, name), { recursive: true, force: true });
    }
  } catch { /* the trash is best effort */ }
  if (!fs.existsSync(from)) return null;
  const to = path.join(trash, `${Number(id)}-${at}`);
  try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); }
  return to;
}
export function deleteBot(board, id) {
  const bot = mustBot(board, id);
  board.transaction(() => {
    const convs = board.all('SELECT id FROM conversations WHERE bot_id = ?', bot.id).map((r) => r.id);
    for (const c of convs) { board.run('DELETE FROM chat WHERE conversation_id = ?', c); board.run('DELETE FROM conversations WHERE id = ?', c); }
    board.run('DELETE FROM bot_group_members WHERE bot_id = ?', bot.id);
    board.run('DELETE FROM bot_reminders WHERE bot_id = ?', bot.id);
    board.run("UPDATE bot_requests SET status = 'failed', result = 'bot borrado' WHERE bot_id = ? AND status IN ('pending', 'waiting')", bot.id);
    board.run('DELETE FROM bots WHERE id = ?', bot.id);
  });
  trashBotFolder(bot.id);
  return bot;
}

// 3.5: the first run only (on a database that never had bots): one empty starter bot, «Asistente».
export function seedStarter(board) {
  if (board.setting('bots_seeded')) return null;
  board.setting('bots_seeded', '1');
  if (board.one('SELECT COUNT(*) AS n FROM bots').n) return null;
  return createBot(board, { name: tr('msg.bots.starterName'), icon: '🤖', role_text: '', tools: STARTER_TOOLS });
}

// ---- exclusives: «only this bot touches the calendar». A topic (or tool group) exclusive to an active bot belongs to it.
export function exclusiveOwner(board, topic, { except = null } = {}) {
  const key = topicKey(topic); if (!key) return null;
  return listBots(board).find((b) => !b.paused && b.id !== except && b.exclusive.includes(key)) ?? null;
}
// The tool groups a bot really gets: its own, minus the ones another active bot has as exclusive; the chief also manages
// bots.
export function effectiveTools(board, bot) {
  const others = listBots(board).filter((b) => b.id !== bot.id && !b.paused).flatMap((b) => b.exclusive);
  const tools = (bot.tools ?? []).filter((t) => !others.includes(t));
  if (bot.is_chief && !tools.includes('gestion')) tools.push('gestion');
  return tools;
}

// ---- memories: <home>\bots\<id>\memoria.md and <home>\bots\memoria-global.md
export const botsDir = () => ctx.paths.bots ?? path.join(ctx.home, 'bots');
export const botDir = (id) => path.join(botsDir(), String(Number(id)));
// 3.6: the global memory is a person's: <home>\bots\personas\<person>\memoria-global.md (the owner's by default; the
// migration moved the 3.5 file there). Before this home's database is opened (ctx.owner unknown), the old place.
export const personDir = (person) => path.join(botsDir(), 'personas', String(person).replace(/[^\w-]/g, '_'));
export const memoryFile = (id, { person = ctx.owner } = {}) => (id === 'global' ? (person ? path.join(personDir(person), 'memoria-global.md') : path.join(botsDir(), 'memoria-global.md')) : path.join(botDir(id), 'memoria.md'));
export function ensureMemory(id) {
  const file = memoryFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '');
  return file;
}
export function readMemory(id) { try { return fs.readFileSync(memoryFile(id), 'utf8'); } catch { return ''; } }
// mode: 'append' (a new line or paragraph at the end) or 'replace' (the whole memory, as the user edits it). Never
// passwords, cards, IBAN or DNI; never anything the user protected (config.protected).
export function writeMemory(id, text, { mode = 'append' } = {}) {
  const value = String(text ?? '');
  if (looksPrivateText(value)) throw bad('msg.bots.secretInMemory');
  const hit = protectedHit(value);
  if (hit) throw bad('msg.bots.protectedInMemory', { name: hit });
  const file = ensureMemory(id);
  const next = mode === 'replace' ? value : `${readMemory(id).replace(/\s*$/, '')}${readMemory(id).trim() ? '\n' : ''}${value.trim()}\n`;
  if (Buffer.byteLength(next) > MEMORY_MAX) throw bad('msg.bots.memoryFull', { kb: MEMORY_MAX / 1024 });
  fs.writeFileSync(file, next);
  return next;
}

// ---- conversations: one of each bot, one of each group (rows of the conversations table with bot_id / group_id)
export function botConversation(board, bot) {
  const found = board.one('SELECT id FROM conversations WHERE bot_id = ? AND group_id IS NULL ORDER BY id LIMIT 1', bot.id)?.id;
  if (found) return found;
  const at = now();
  const { lastInsertRowid } = board.run('INSERT INTO conversations (title, titled, agent, model, reasoning, bot_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)', bot.name, bot.agent, bot.model ?? null, ['low', 'medium', 'high'].includes(bot.effort) ? bot.effort : 'high', bot.id, at, at);
  return Number(lastInsertRowid);
}
export function groupConversation(board, groupId) {
  const found = board.one('SELECT id FROM conversations WHERE group_id = ? ORDER BY id LIMIT 1', Number(groupId))?.id;
  if (found) return found;
  const g = board.one('SELECT * FROM bot_groups WHERE id = ?', Number(groupId));
  if (!g) throw bad('msg.bots.noGroup');
  const at = now();
  const { lastInsertRowid } = board.run('INSERT INTO conversations (title, titled, group_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?)', g.name, g.id, at, at);
  return Number(lastInsertRowid);
}
// What a conversation of the bots is: { bot } or { group } (null: one of the assistant's).
export function conversationOwner(board, conversation) {
  const r = conversation ? board.one('SELECT bot_id, group_id FROM conversations WHERE id = ?', Number(conversation)) : null;
  if (!r || (r.bot_id == null && r.group_id == null)) return null;
  return r.group_id != null ? { group: r.group_id } : { bot: r.bot_id };
}

// ---- groups: chats with several bots and the user. Members in order, the chief (if any) first.
export function groupMembers(board, id) {
  return board.all('SELECT b.* FROM bot_group_members m JOIN bots b ON b.id = m.bot_id WHERE m.group_id = ? ORDER BY b.is_chief DESC, m.position, b.id', Number(id)).map(parseBot);
}
export function getGroup(board, id) {
  const g = board.one('SELECT * FROM bot_groups WHERE id = ?', Number(id));
  return g ? { ...g, members: groupMembers(board, g.id).map((b) => b.id) } : null;
}
export const listGroups = (board) => board.all('SELECT id FROM bot_groups ORDER BY id').map((r) => getGroup(board, r.id));
function setMembers(board, id, members) {
  if (!Array.isArray(members) || members.length > 30) throw bad('msg.bots.badField', { name: 'members' });
  const ids = [...new Set(members.map((m) => mustBot(board, m).id))];
  board.run('DELETE FROM bot_group_members WHERE group_id = ?', id);
  ids.forEach((b, i) => board.run('INSERT INTO bot_group_members (group_id, bot_id, position) VALUES (?, ?, ?)', id, b, i));
}
const groupName = (name) => { const n = oneLine(String(name ?? ''), 60).trim(); if (!n || n.length > 40) throw bad('msg.bots.badName'); return n; };
export function createGroup(board, { name, icon = '', members = [] }) {
  const n = groupName(name);
  return board.transaction(() => {
    const at = now();
    const { lastInsertRowid } = board.run('INSERT INTO bot_groups (name, icon, created_at, updated_at) VALUES (?, ?, ?, ?)', n, String(icon ?? '').slice(0, 16), at, at);
    setMembers(board, Number(lastInsertRowid), members);
    return getGroup(board, Number(lastInsertRowid));
  });
}
export function updateGroup(board, id, { name, icon, members }) {
  const g = getGroup(board, id); if (!g) throw bad('msg.bots.noGroup');
  return board.transaction(() => {
    if (name !== undefined) { board.run('UPDATE bot_groups SET name = ? WHERE id = ?', groupName(name), g.id); board.run('UPDATE conversations SET title = ? WHERE group_id = ?', groupName(name), g.id); }
    if (icon !== undefined) board.run('UPDATE bot_groups SET icon = ? WHERE id = ?', String(icon ?? '').slice(0, 16), g.id);
    if (members !== undefined) setMembers(board, g.id, members);
    board.run('UPDATE bot_groups SET updated_at = ? WHERE id = ?', now(), g.id);
    return getGroup(board, g.id);
  });
}
export function deleteGroup(board, id) {
  const g = getGroup(board, id); if (!g) throw bad('msg.bots.noGroup');
  board.transaction(() => {
    for (const c of board.all('SELECT id FROM conversations WHERE group_id = ?', g.id)) { board.run('DELETE FROM chat WHERE conversation_id = ?', c.id); board.run('DELETE FROM conversations WHERE id = ?', c.id); }
    board.run('DELETE FROM bot_group_members WHERE group_id = ?', g.id);
    board.run('DELETE FROM bot_groups WHERE id = ?', g.id);
  });
  return true;
}

// ---- the golden rules (Ajustes › Bots): given to every bot
export const goldenRules = () => (ctx.config.bots?.rules ?? []).map((r) => String(r).trim()).filter(Boolean);

// ---- reminders
const parseReminder = (r) => r && { ...r, weekdays: json(r.weekdays, []), enabled: Boolean(r.enabled) };
// The first run at or after `after` (ms): from start_at, every day / week (on its weekdays) / month / year, local time.
export function nextRun(rem, after = Date.now()) {
  const start = new Date(rem.start_at);
  if (Number.isNaN(start.getTime())) return null;
  if (rem.every === 'once') return start.getTime() > after ? start.toISOString() : null;
  const days = rem.every === 'weekly' ? (rem.weekdays?.length ? rem.weekdays : [start.getDay()]) : null;
  const at = (k) => {
    const d = new Date(start);
    if (rem.every === 'daily' || rem.every === 'weekly') d.setDate(start.getDate() + k);
    else if (rem.every === 'monthly') { d.setDate(1); d.setMonth(start.getMonth() + k); d.setDate(Math.min(start.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
    else if (rem.every === 'yearly') { d.setDate(1); d.setFullYear(start.getFullYear() + k); d.setDate(Math.min(start.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
    return d;
  };
  // Straight to near `after` for daily/weekly (no walk through years of days).
  let k = 0;
  if ((rem.every === 'daily' || rem.every === 'weekly') && after > start.getTime()) k = Math.max(0, Math.floor((after - start.getTime()) / 86_400_000) - 2);
  for (let i = 0; i < 5000; i++, k++) {
    const d = at(k);
    if (d.getTime() <= after) continue;
    if (days && !days.includes(d.getDay())) continue;
    return d.toISOString();
  }
  return null;
}
export function createReminder(board, { bot_id, text, every = 'once', when, weekdays = [] }, actor = 'usuario') {
  const bot = mustBot(board, bot_id);
  const body = oneLine(String(text ?? ''), 500).trim();
  if (!body) throw bad('msg.bots.reminderNeedsText');
  if (looksPrivateText(body)) throw bad('msg.bots.secretInMemory');
  if (!EVERY.includes(every)) throw bad('msg.bots.badField', { name: 'every' });
  const start = new Date(String(when ?? ''));
  if (Number.isNaN(start.getTime())) throw bad('msg.bots.badWhen');
  if (!Array.isArray(weekdays) || weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw bad('msg.bots.badField', { name: 'weekdays' });
  const rem = { every, start_at: start.toISOString(), weekdays };
  const next = nextRun(rem, Date.now() - 1000);
  if (!next) throw bad('msg.bots.whenPast');
  const { lastInsertRowid } = board.run('INSERT INTO bot_reminders (bot_id, text, every, start_at, weekdays, next_run, enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    bot.id, body, every, rem.start_at, JSON.stringify(weekdays), next, String(actor).slice(0, 40), now());
  return getReminder(board, Number(lastInsertRowid));
}
export const getReminder = (board, id) => parseReminder(board.one('SELECT * FROM bot_reminders WHERE id = ?', Number(id)));
export function listReminders(board, { bot = null, all = false } = {}) {
  const where = [all ? null : 'enabled = 1', bot ? 'bot_id = ?' : null].filter(Boolean);
  return board.all(`SELECT * FROM bot_reminders${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY next_run IS NULL, next_run, id`, ...(bot ? [Number(bot)] : [])).map(parseReminder);
}
export function cancelReminder(board, id, { bot = null } = {}) {
  const r = getReminder(board, id);
  if (!r || (bot && r.bot_id !== Number(bot))) throw bad('msg.bots.noReminder');
  board.run('UPDATE bot_reminders SET enabled = 0, next_run = NULL WHERE id = ?', r.id);
  return getReminder(board, r.id);
}
// The reminders due at `at` (ms): each one moves to its next run (or ends, for «once»). → the ones that fired.
export function takeDueReminders(board, at = Date.now()) {
  const due = board.all('SELECT * FROM bot_reminders WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ? ORDER BY next_run', new Date(at).toISOString()).map(parseReminder);
  for (const r of due) {
    const next = nextRun(r, at);
    board.run('UPDATE bot_reminders SET last_run = ?, next_run = ?, enabled = ? WHERE id = ?', new Date(at).toISOString(), next, next ? 1 : 0, r.id);
  }
  return due;
}

// ---- requests from the bots' tools to the engine (src/mcp/bot.mjs → src/engine/bots.mjs)
export function addRequest(board, botId, kind, payload = {}) {
  const at = now();
  const { lastInsertRowid } = board.run("INSERT INTO bot_requests (bot_id, kind, payload, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)", Number(botId), kind, JSON.stringify(payload), at, at);
  return Number(lastInsertRowid);
}
export const getRequest = (board, id) => { const r = board.one('SELECT * FROM bot_requests WHERE id = ?', Number(id)); return r && { ...r, payload: json(r.payload, {}), result: json(r.result, r.result) }; };
export function setRequest(board, id, status, result = null) {
  board.run('UPDATE bot_requests SET status = ?, result = ?, updated_at = ? WHERE id = ?', status, result == null ? null : typeof result === 'string' ? result : JSON.stringify(result), now(), Number(id));
}

// 3.5.1: the user's OK for a bot's risky click in the browser (bot_confirm, src/mcp/server.mjs): once, on its site.
export const siteOf = (url) => { try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const sameSite = (host, granted) => Boolean(host && granted && (host === granted || host.endsWith(`.${granted}`)));
const plainText = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
// The user's OK for this one action: on this site, this button (when the bot named one), not used yet, not too old. It is
// spent here (taken out of the database) before the action runs. → null or why not.
export function takeGrant(boardRef, botId, { url, label }) {
  const key = `bot_grant:${botId}`;
  const g = boardRef.settingJson(key);
  if (!g?.until || g.until <= Date.now() || Number(g.uses ?? 1) < 1) return 'sys.botmcp.browserNeedsOk';
  if (!g.host) return 'sys.botmcp.browserNeedsSite';
  if (!sameSite(siteOf(url), g.host)) return 'sys.botmcp.browserOtherSite';
  if (g.button && label && !plainText(label).includes(plainText(g.button))) return 'sys.botmcp.browserOtherButton';
  boardRef.run('DELETE FROM settings WHERE key = ?', key);
  return null;
}

// ---- Home Assistant: its address in the settings, its long-lived token in the database (never in orb.json).
// 3.5.1: the token is kept with the address it was given for, and only goes to that address: changing the address
// (here, in orb.json or from another device) leaves Orb without a token until the user gives it again.
export const HA_TOKEN_KEY = 'secret:ha_token';
export const HA_TOKEN_URL_KEY = 'secret:ha_token_url';
const haUrl = () => String(ctx.config.bots?.homeAssistant?.url ?? '').trim().replace(/\/+$/, '');
export function haConfig(board) {
  const url = haUrl();
  const token = board.setting(HA_TOKEN_KEY) || '';
  let bound = board.setting(HA_TOKEN_URL_KEY);
  // A token saved by 3.5.0 (no address with it): it belongs to the address set now.
  if (token && bound == null) { board.setting(HA_TOKEN_URL_KEY, url); bound = url; }
  return { url, token: token && bound === url ? token : '' };
}
export function setHaToken(board, token, url) {
  board.setting(HA_TOKEN_KEY, String(token ?? ''));
  board.setting(HA_TOKEN_URL_KEY, String(token ? url ?? '' : ''));
}
// Domains whose services always wait for the user's approval (locks, the alarm, blinds and doors).
export const HA_SENSITIVE = ['lock', 'alarm_control_panel', 'cover'];
