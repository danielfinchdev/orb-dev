// Pure helpers for the Activity tab: the two shapes the engine answers with, the filters it understands and the
// capability probes. Kept free of React so they can be tested on their own.

import { toIso, addDays } from './date-field.js';

export const SOURCES = ['orb', 'subagentes', 'usuario', 'app'];
export const LEVELS = ['info', 'warn', 'error'];
export const PAGE = 100;

// Any request that carries `sources` makes a newer engine answer { items, next }; an older one ignores it and
// still answers with the plain array of events.
export function buildQuery(filters = {}, cursor = null, { counts = true } = {}) {
  const sources = filters.sources?.length ? filters.sources.filter((s) => SOURCES.includes(s)) : SOURCES;
  const q = { sources, limit: PAGE };
  if (filters.q?.trim()) q.q = filters.q.trim();
  if (filters.level && filters.level !== 'info' && LEVELS.includes(filters.level)) q.level = filters.level;
  if (filters.project) q.project = filters.project;
  if (filters.from) q.from = dayEdge(filters.from, false);
  if (filters.to) q.to = dayEdge(filters.to, true);
  // the totals per source and level are asked with the first page only (and not while the text is being typed)
  if (cursor) q.cursor = cursor; else if (counts) q.counts = true;
  return q;
}

// 'YYYY-MM-DD' (a date input) → the ISO instant that opens or closes that local day.
export function dayEdge(day, end) {
  const [y, m, d] = String(day).split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return (end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0)).toISOString();
}

// The totals of the engine, or null when it sent none (an older one) or something of another shape.
function validCounts(c) {
  const ok = (o, keys) => o && typeof o === 'object' && keys.every((k) => Number.isFinite(o[k]));
  return ok(c?.sources, SOURCES) && ok(c?.levels, LEVELS) ? { sources: c.sources, levels: c.levels, partial: c.partial === true } : null;
}

// One shape for both answers. paged: the engine reads by pages and understands the filters.
export function normalizeActivity(res) {
  if (Array.isArray(res)) {
    return { paged: false, next: null, items: res.map((r) => ({ id: `events:${r.id}`, at: r.at ?? null, source: 'subagentes', level: 'info', project: r.project ?? null, kind: r.kind, text: String(r.detail ?? ''), legacy: r })) };
  }
  if (res && Array.isArray(res.items)) return { paged: true, next: res.next ?? null, items: res.items, counts: validCounts(res.counts) };
  return { paged: false, next: null, items: [] };
}

// Everything but the typed text: the totals are asked again only when this changes (the text waits for a pause).
export const countsKey = (f) => JSON.stringify([f.sources ?? [], f.level, f.project, f.from, f.to]);

// The same filters left untouched.
export const EMPTY_FILTERS = Object.freeze({ sources: [], level: 'info', project: '', from: '', to: '', q: '' });
export const hasFilters = (f) => Boolean(f.sources?.length || (f.level && f.level !== 'info') || f.project || f.from || f.to);

// Older page after the current one, without repeating a line the engine gave twice.
export function appendPage(items, more) {
  const seen = new Set(items.map((i) => i.id));
  return [...items, ...more.filter((i) => !seen.has(i.id))];
}

// Does the engine have this method? Asked once per method and kept; an old engine answers with an error.
const known = new Map();
export function hasMethod(call, method, params) {
  if (!known.has(method)) known.set(method, Promise.resolve().then(() => call(method, params)).then(() => true, (e) => /unknown|desconoc|no existe|not found|method/i.test(String(e?.message ?? e)) ? false : true));
  return known.get(method);
}
export const forgetMethods = () => known.clear();

// What the report shows of the copied text: its first lines, and how many follow.
export function previewLines(text, shown = 6) {
  const lines = String(text ?? '').split('\n');
  const body = lines.slice(lines.findIndex((l) => l === '') + 1);
  return { head: body.slice(0, shown), more: Math.max(0, body.length - shown), total: body.length };
}

// The quick tabs of the Activity tab. «agentes» is the source the engine calls «subagentes»; «problemas» is the warning
// level, which the engine reads as «warnings and errors».
export const TABS = ['todo', 'tu', 'agentes', 'problemas'];
export const RANGES = ['0', '7', '30', 'all', 'custom'];
export const DEFAULT_RANGE = '7';
export const EMPTY_VIEW = Object.freeze({ tab: 'todo', project: '', range: DEFAULT_RANGE, from: '', to: '', q: '' });

const TAB_FILTERS = { todo: { sources: [], level: 'info' }, tu: { sources: ['usuario'], level: 'info' }, agentes: { sources: ['subagentes'], level: 'info' }, problemas: { sources: [], level: 'warn' } };

// The days a range shows, as local 'YYYY-MM-DD' bounds (an empty one is open). «Hoy» is today; «7 días» includes today.
export function rangeDates(range, custom = {}, now = new Date()) {
  if (range === 'custom') return { from: custom.from || '', to: custom.to || '' };
  if (range === 'all') return { from: '', to: '' };
  const days = Number(range);
  const today = toIso(now);
  return { from: days > 0 ? addDays(today, -(days - 1)) : today, to: '' };
}

// The view of the Activity tab (tab, project, range, text) → the filters the engine query understands.
export function resolveFilters(view, now = new Date()) {
  const { sources, level } = TAB_FILTERS[view.tab] ?? TAB_FILTERS.todo;
  const { from, to } = rangeDates(view.range, view, now);
  return { sources, level, project: view.project || '', from, to, q: view.q ?? '' };
}

// The filters on show as removable labels (the tab has its own control and is not one of them).
export function activeChips(view) {
  const chips = [];
  if (view.project) chips.push({ key: 'project', value: view.project });
  if (view.range !== DEFAULT_RANGE) chips.push({ key: 'range', value: view.range });
  if (view.q?.trim()) chips.push({ key: 'q', value: view.q.trim() });
  return chips;
}
export const clearChip = (view, key) => ({ ...view, ...(key === 'project' ? { project: '' } : key === 'range' ? { range: DEFAULT_RANGE, from: '', to: '' } : { q: '' }) });

// What counts as «technical» (hidden until «Ver detalles técnicos»): the plain lines Orb's own logs write for developers.
// Only an info line of Orb's or the app's own log qualifies, so a warning or an error is never hidden:
//  - the lock-screen notices («pantalla de bloqueo (sin usar)»);
//  - the start-up line that lists where each agent is installed («agentes: claude=C:\...\claude.exe · codex=no»);
//  - any other line that is just a program path.
const TECH_LINE = [/^pantalla de bloqueo\b/i, /^agentes:\s.*=/i, /^(?:[a-z]:|\/)\S+\.(?:exe|cmd|bat|js|mjs)$/i];
export function isTechnical(item) {
  if (!item || item.level !== 'info' || (item.source !== 'orb' && item.source !== 'app')) return false;
  const text = String(item.text ?? '').trim();
  return TECH_LINE.some((re) => re.test(text));
}
export const visibleLines = (items, showTechnical) => (showTechnical ? items : items.filter((i) => !isTechnical(i)));
