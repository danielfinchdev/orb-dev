// 3.6: the starting templates of the wizard («Mi negocio», «Mi casa», «Desarrollo», «Empezar vacío»). Each one is a
// plain, generic JSON in src/core/templates/<lang>/<id>.json (no personal data): a few bots, groups, reminders and golden
// rules. The wizard shows it, the user edits it, and apply() creates everything through the bots' own core functions
// (same checks as creating them by hand). The reminders' wall times are in the person's time zone (src/core/tz.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from './bots.mjs';
import { ctx, saveConfig, tr } from './context.mjs';
import { nextLocalRun, utcToZoned, isValidTz, systemTz } from './tz.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const LANGS = ['es', 'en'];
const bad = (key, vars) => { const e = new Error(tr(key, vars)); e.userFacing = true; return e; };
const cache = new Map();

function load(lang) {
  const l = LANGS.includes(lang) ? lang : 'es';
  if (!cache.has(l)) {
    const list = fs.readdirSync(path.join(DIR, l)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, l, f), 'utf8')));
    cache.set(l, list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99)));
  }
  return cache.get(l);
}

export const TEMPLATE_IDS = () => load('es').map((t) => t.id);
// The list for the wizard, in a language: everything a preview needs (it is also what apply() takes back, edited).
export function listTemplates(lang = ctx.config?.language ?? 'es') { return structuredClone(load(lang)); }
export function getTemplate(id, lang = ctx.config?.language ?? 'es') {
  const t = load(lang).find((x) => x.id === id);
  if (!t) throw bad('data.templates.unknown', { id: String(id ?? '') });
  return structuredClone(t);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// The template as the user left it: the sections the wizard edited replace the template's; anything else stays.
export function checkTemplate(t) {
  const plain = (v, max) => typeof v === 'string' && v.length <= max;
  if (!Array.isArray(t.bots) || t.bots.length > 20) throw bad('data.templates.bad', { what: 'bots' });
  const keys = new Set();
  for (const b of t.bots) {
    if (!b || !plain(b.key ?? '', 40) || !plain(b.name, 40) || !b.name.trim()) throw bad('data.templates.bad', { what: 'bots' });
    if (b.key) { if (keys.has(b.key)) throw bad('data.templates.bad', { what: 'bots' }); keys.add(b.key); }
  }
  if (!Array.isArray(t.groups ?? []) || (t.groups ?? []).length > 10) throw bad('data.templates.bad', { what: 'groups' });
  for (const g of t.groups ?? []) if (!g || !plain(g.name, 40) || !Array.isArray(g.members) || g.members.some((m) => !keys.has(m))) throw bad('data.templates.bad', { what: 'groups' });
  if (!Array.isArray(t.reminders ?? []) || (t.reminders ?? []).length > 40) throw bad('data.templates.bad', { what: 'reminders' });
  for (const r of t.reminders ?? []) {
    if (!r || !keys.has(r.bot) || !plain(r.text, 500) || !B.EVERY.includes(r.every ?? 'daily') || (r.every ?? 'daily') === 'once' || !TIME.test(r.time ?? '09:00')) throw bad('data.templates.bad', { what: 'reminders' });
    if (r.weekdays !== undefined && (!Array.isArray(r.weekdays) || r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw bad('data.templates.bad', { what: 'reminders' });
    if (r.day !== undefined && (!Number.isInteger(r.day) || r.day < 1 || r.day > 28)) throw bad('data.templates.bad', { what: 'reminders' });
  }
  if (!Array.isArray(t.rules ?? []) || (t.rules ?? []).some((x) => !plain(x, 400))) throw bad('data.templates.bad', { what: 'rules' });
  return t;
}

// The first run of a template's reminder after `now`, in `tz`: the instant createReminder gets as «when».
export function reminderStart(r, tz, now = Date.now()) {
  const every = r.every ?? 'daily';
  const time = r.time ?? '09:00';
  const today = utcToZoned(now, tz);
  const day = every === 'monthly' || every === 'yearly' ? String(r.day ?? today.day).padStart(2, '0') : String(today.day).padStart(2, '0');
  const start = `${String(today.year).padStart(4, '0')}-${String(every === 'yearly' && r.month ? r.month : today.month).padStart(2, '0')}-${day}T${time}`;
  const rule = every === 'weekly' ? { every, time, weekdays: r.weekdays ?? [1] } : { every, start: every === 'daily' ? undefined : start, time };
  return nextLocalRun(rule, tz, now);
}

// Creates what the template holds. edits: the template edited in the wizard (bots / groups / reminders / rules
// replace the template's). person: who it is for (3.6, persons; until then the Orb's owner). → what was made.
export function applyTemplate(board, { id, lang = ctx.config?.language ?? 'es', edits = null, tz = null, person = null, now = Date.now() } = {}) {
  const base = getTemplate(id, lang);
  const t = checkTemplate({ ...base, ...(edits && typeof edits === 'object' ? Object.fromEntries(['bots', 'groups', 'reminders', 'rules'].filter((k) => edits[k] !== undefined).map((k) => [k, edits[k]])) : {}) });
  const zone = isValidTz(tz) ? tz : isValidTz(ctx.config?.tz) ? ctx.config.tz : systemTz();
  const made = { bots: [], groups: [], reminders: [], rules: 0, person };
  const byKey = new Map();
  const taken = new Set(B.listBots(board).map((b) => b.name.toLowerCase()));
  const freeName = (name) => { let n = name.trim(); for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${name.trim().slice(0, 36)} ${i}`; taken.add(n.toLowerCase()); return n; };
  try {
    for (const b of t.bots) {
      const bot = B.createBot(board, { name: freeName(b.name), icon: b.icon ?? '', role_text: b.role_text ?? '', tools: b.tools ?? undefined, ...(b.effort ? { effort: b.effort } : {}) });
      made.bots.push(bot.id); if (b.key) byKey.set(b.key, bot.id);
    }
    const groupNames = new Set(B.listGroups(board).map((g) => g.name.toLowerCase()));
    for (const g of t.groups ?? []) {
      let name = g.name.trim(); for (let i = 2; groupNames.has(name.toLowerCase()); i++) name = `${g.name.trim().slice(0, 36)} ${i}`;
      groupNames.add(name.toLowerCase());
      made.groups.push(B.createGroup(board, { name, icon: g.icon ?? '', members: g.members.map((k) => byKey.get(k)) }).id);
    }
    for (const r of t.reminders ?? []) {
      const when = reminderStart(r, zone, now);
      const every = r.every ?? 'daily';
      made.reminders.push(B.createReminder(board, { bot_id: byKey.get(r.bot), text: r.text, every: every === 'daily' && r.weekdays?.length ? 'weekly' : every, when: when.toISOString(), weekdays: r.weekdays ?? [] }, 'usuario').id);
    }
  } catch (error) {
    // Nothing half made: what this template created goes away again.
    for (const g of made.groups) { try { B.deleteGroup(board, g); } catch { /* gone */ } }
    for (const b of made.bots) { try { B.deleteBot(board, b); } catch { /* gone */ } }
    throw error;
  }
  // 3.6: what was made is that person's (a row without person_id is the owner's).
  if (person) {
    for (const [table, ids] of [['bots', made.bots], ['bot_groups', made.groups], ['bot_reminders', made.reminders]]) for (const id of ids) board.run(`UPDATE ${table} SET person_id = ? WHERE id = ?`, person, id);
  }
  const rules = (t.rules ?? []).map((x) => x.trim()).filter(Boolean);
  if (rules.length) {
    const current = B.goldenRules();
    const next = [...current, ...rules.filter((x) => !current.includes(x))].slice(0, 30);
    made.rules = next.length - current.length;
    if (made.rules) saveConfig({ bots: { rules: next } });
  }
  board.setting('template_applied', t.id);
  return made;
}
