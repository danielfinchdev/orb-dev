// The text rules: one .md per rule in core\normas, read when a prompt is built (the persona, a task brief, the chat
// briefing). The shipped rules (defaults.mjs) are created at start; the user's own are added beside them.
// Nothing here ever breaks a prompt: a file that cannot be read or parsed falls back to the shipped text, a missing
// folder to the shipped rules. Who may change them (password, API) is decided by the callers; this module is only the files and the logic.
import fs from 'node:fs';
import path from 'node:path';
import { ctx } from '../../platform/context.mjs';
import { writeAtomic } from '../../platform/fsx.mjs';
import { DEFAULT_RULES, DEFAULT_IDS, HOST_OF, defaultRule, hashText } from './defaults.mjs';
import { render } from './render.mjs';

export const PARAS = Object.freeze(['orb', 'subagentes', 'ambos']);
export const ESTADOS = Object.freeze(['activa', 'pausada', 'eliminada']);
export const MAX_TITLE = 80;
export const MAX_TEXT = 20_000;
const ID = /^[a-z0-9-]{1,60}$/;
export const isRuleId = (id) => typeof id === 'string' && ID.test(id);

export class RuleError extends Error {
  constructor(code, message) { super(message); this.name = 'RuleError'; this.code = code; }
}

// Problems are noted once each (a prompt is built often); the engine's stderr goes to its log.
let logger = (line) => console.error(line);
const told = new Set();
export const setRulesLogger = (fn) => { logger = typeof fn === 'function' ? fn : () => {}; told.clear(); };
function tell(key, line) { if (told.has(key)) return; told.add(key); try { logger(`normas: ${line}`); } catch { /* the log is optional */ } }

const fileOf = (id) => path.join(ctx.paths.rules, `${id}.md`);
const seedRule = (d) => ({ id: d.id, titulo: d.titulo, para: d.para, tipo: 'texto', estado: d.estado, de_serie: true, serie: d.serie, texto: d.texto });
const snapshot = (r) => (r ? { id: r.id, titulo: r.titulo, para: r.para, tipo: r.tipo, estado: r.estado, de_serie: r.de_serie, texto: r.texto } : null);

function serialize(r) {
  return `---\nid: ${r.id}\ntitulo: ${r.titulo}\npara: ${r.para}\ntipo: texto\nestado: ${r.estado}\nde_serie: ${r.de_serie ? 'sí' : 'no'}\nserie: ${r.serie ?? ''}\n---\n${r.texto}\n`;
}

// null when the file is not a rule of this id (no header, an odd value, another id): the caller decides what to use.
function parseFile(raw, id) {
  const text = String(raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(text);
  if (!m) return null;
  const head = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 1) return null;
    head[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (head.id !== id || !head.titulo || !PARAS.includes(head.para) || !ESTADOS.includes(head.estado)) return null;
  const body = m[2].replace(/\n$/, '').slice(0, MAX_TEXT);
  return { id, titulo: head.titulo.slice(0, MAX_TITLE), para: head.para, tipo: 'texto', estado: head.estado, de_serie: DEFAULT_IDS.has(id), serie: head.serie ?? '', texto: body };
}

// Every rule as it counts right now, by id. A shipped rule whose file is missing or unreadable is its shipped self.
function loadAll() {
  const found = new Map();
  let names = [];
  try { names = fs.readdirSync(ctx.paths.rules); } catch (error) { if (error.code !== 'ENOENT') tell('dir', `no se pudo leer la carpeta de normas (${error.code ?? error.message}); se usan las de serie`); }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -3);
    if (!isRuleId(id)) continue;
    try { found.set(id, parseFile(fs.readFileSync(path.join(ctx.paths.rules, name), 'utf8'), id)); } catch { found.set(id, null); }
  }
  const all = new Map();
  for (const d of DEFAULT_RULES) {
    const f = found.get(d.id);
    if (found.has(d.id) && !f) tell(`broken:${d.id}`, `${d.id}.md no se puede leer; se usa el texto de serie`);
    all.set(d.id, f ?? seedRule(d));
  }
  for (const [id, f] of found) {
    if (DEFAULT_IDS.has(id)) continue;
    if (f) all.set(id, f); else tell(`broken:${id}`, `${id}.md no se puede leer; se ignora`);
  }
  return all;
}

// Creates the shipped rules that are missing and brings up to date those the user never touched (their text still hashes
// to the `serie` they were created with) when the shipped text changed. A rule the user changed, or deleted, stays.
export function ensureDefaultRules() {
  const result = { created: [], updated: [] };
  fs.mkdirSync(ctx.paths.rules, { recursive: true });
  for (const d of DEFAULT_RULES) {
    let raw = null;
    try { raw = fs.readFileSync(fileOf(d.id), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') { tell(`broken:${d.id}`, `${d.id}.md no se puede leer: ${error.code ?? error.message}`); continue; } }
    try {
      if (raw === null) { writeAtomic(fileOf(d.id), serialize(seedRule(d))); result.created.push(d.id); continue; }
      const cur = parseFile(raw, d.id);
      if (!cur) { tell(`broken:${d.id}`, `${d.id}.md tiene la cabecera rota; se usa el texto de serie`); continue; }
      if (cur.estado === 'eliminada') continue;
      if (cur.serie !== d.serie && hashText(cur.texto) === cur.serie) {
        writeAtomic(fileOf(d.id), serialize({ ...cur, texto: d.texto, serie: d.serie }));
        result.updated.push(d.id);
      }
    } catch (error) { tell(`write:${d.id}`, `no se pudo escribir ${d.id}.md: ${error.message}`); }
  }
  return result;
}

// ---- what the user does (the files only; the password check and the activity log are the caller's)

function cleanFields({ titulo, para, texto }, base = {}) {
  const t = titulo === undefined ? base.titulo : String(titulo).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const p = para === undefined ? base.para : para;
  const x = texto === undefined ? base.texto : String(texto).replace(/\r\n/g, '\n');
  if (!t) throw new RuleError('titulo', 'La norma necesita un título.');
  if (t.length > MAX_TITLE) throw new RuleError('titulo', `El título tiene más de ${MAX_TITLE} caracteres.`);
  if (!PARAS.includes(p)) throw new RuleError('para', 'La norma es para orb, subagentes o ambos.');
  if (typeof x !== 'string' || !x.trim()) throw new RuleError('texto', 'La norma necesita un texto.');
  if (x.length > MAX_TEXT) throw new RuleError('texto', `El texto tiene más de ${MAX_TEXT} caracteres.`);
  return { titulo: t, para: p, texto: x };
}
function existing(id) {
  if (!isRuleId(id)) throw new RuleError('id', 'Identificador de norma no válido.');
  const cur = loadAll().get(id);
  if (!cur || cur.estado === 'eliminada') throw new RuleError('noexiste', 'Esa norma no existe.');
  return cur;
}
const put = (rule) => { fs.mkdirSync(ctx.paths.rules, { recursive: true }); writeAtomic(fileOf(rule.id), serialize(rule)); };

// The rules to show, the shipped ones first (the deleted ones only on request: they are hidden, not gone).
export function listRules({ deleted = false } = {}) {
  const all = [...loadAll().values()].filter((r) => deleted || r.estado !== 'eliminada');
  const order = (r) => (DEFAULT_IDS.has(r.id) ? DEFAULT_RULES.findIndex((d) => d.id === r.id) : 1000);
  return all.sort((a, b) => order(a) - order(b) || a.titulo.localeCompare(b.titulo, 'es')).map(snapshot);
}
export function readRule(id) {
  if (!isRuleId(id)) return null;
  const r = loadAll().get(id);
  return r && r.estado !== 'eliminada' ? snapshot(r) : null;
}

// Each of these returns { before, after } (a rule as listRules shows it, or null) for the activity log.
export function saveRule(id, fields) {
  const cur = existing(id);
  const next = { ...cur, ...cleanFields(fields ?? {}, cur) };
  put(next);
  return { before: snapshot(cur), after: snapshot(next) };
}
export function createRule(fields) {
  const clean = cleanFields({ para: 'ambos', ...(fields ?? {}) }, {});
  const slug = clean.titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52).replace(/-+$/, '') || 'norma';
  let id = slug;
  for (let n = 2; DEFAULT_IDS.has(id) || fs.existsSync(fileOf(id)); n++) id = `${slug}-${n}`;
  const rule = { id, ...clean, tipo: 'texto', estado: 'activa', de_serie: false, serie: '' };
  put(rule);
  return { before: null, after: snapshot(rule) };
}
export function setRuleState(id, estado) {
  if (!['activa', 'pausada'].includes(estado)) throw new RuleError('estado', 'El estado es activa o pausada.');
  const cur = existing(id);
  const next = { ...cur, estado };
  put(next);
  return { before: snapshot(cur), after: snapshot(next) };
}
// A shipped rule is hidden (so «restaurar» can bring it back and it is not made again); the user's own file is removed.
export function deleteRule(id) {
  const cur = existing(id);
  if (DEFAULT_IDS.has(id)) {
    const next = { ...cur, estado: 'eliminada' };
    put(next);
    return { before: snapshot(cur), after: snapshot(next) };
  }
  fs.rmSync(fileOf(id), { force: true });
  return { before: snapshot(cur), after: null };
}
// Every shipped rule back to its shipped text, title, audience and state; the user's own rules stay as they are.
export function restoreDefaults() {
  const all = loadAll();
  const before = []; const after = [];
  for (const d of DEFAULT_RULES) {
    const cur = all.get(d.id); const seed = seedRule(d);
    let onDisk = null;
    try { onDisk = parseFile(fs.readFileSync(fileOf(d.id), 'utf8'), d.id); } catch { /* missing or unreadable: written again */ }
    const same = onDisk && ['titulo', 'para', 'estado', 'texto', 'serie'].every((k) => onDisk[k] === seed[k]);
    if (same) continue;
    put(seed);
    before.push(snapshot(cur)); after.push(snapshot(seed));
  }
  return { before, after };
}

// ---- building a prompt

// target: 'orb' (the persona, the briefing) or 'subagentes' (a task brief). vars and conds: see defaults.mjs.
// rule(id): the rendered text of a rule the code places itself ('' when it is paused, deleted or for the other side).
// extras(): what goes at the end: the rules that lost their place and the user's own, already rendered.
export function ruleSet(target, { vars = {}, conds = {} } = {}) {
  const all = loadAll();
  const used = new Set();
  const forMe = (r) => r && r.estado === 'activa' && (r.para === target || r.para === 'ambos');
  const text = (id, stack = []) => {
    const r = all.get(id);
    if (!forMe(r) || stack.includes(id)) return '';
    used.add(id);
    return render(r.texto, { vars, conds, norma: (other) => text(other, [...stack, id]) });
  };
  return {
    rule: (id) => text(id),
    extras() {
      const mine = [...all.values()].filter((r) => !DEFAULT_IDS.has(r.id) && forMe(r))
        .map((r) => ({ titulo: r.titulo, texto: render(r.texto, { vars, conds, norma: (other) => text(other, [r.id]) }) }));
      const lost = DEFAULT_RULES.filter((d) => HOST_OF[d.id] && !used.has(d.id)).map((d) => text(d.id)).filter(Boolean);
      return { lost, mine };
    }
  };
}
export { defaultRule };
