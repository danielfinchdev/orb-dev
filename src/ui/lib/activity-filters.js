// Pure helpers for the Activity tab: the two shapes the engine answers with, the filters it understands and the
// capability probes. Kept free of React so they can be tested on their own.

export const SOURCES = ['orb', 'subagentes', 'usuario', 'app'];
export const LEVELS = ['info', 'warn', 'error'];
export const PAGE = 100;

// Any request that carries `sources` makes a newer engine answer { items, next }; an older one ignores it and
// still answers with the plain array of events.
export function buildQuery(filters = {}, cursor = null) {
  const sources = filters.sources?.length ? filters.sources.filter((s) => SOURCES.includes(s)) : SOURCES;
  const q = { sources, limit: PAGE };
  if (filters.q?.trim()) q.q = filters.q.trim();
  if (filters.level && filters.level !== 'info' && LEVELS.includes(filters.level)) q.level = filters.level;
  if (filters.project) q.project = filters.project;
  if (filters.from) q.from = dayEdge(filters.from, false);
  if (filters.to) q.to = dayEdge(filters.to, true);
  if (cursor) q.cursor = cursor;
  return q;
}

// 'YYYY-MM-DD' (a date input) → the ISO instant that opens or closes that local day.
export function dayEdge(day, end) {
  const [y, m, d] = String(day).split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return (end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0)).toISOString();
}

// One shape for both answers. paged: the engine reads by pages and understands the filters.
export function normalizeActivity(res) {
  if (Array.isArray(res)) {
    return { paged: false, next: null, items: res.map((r) => ({ id: `events:${r.id}`, at: r.at ?? null, source: 'subagentes', level: 'info', project: r.project ?? null, kind: r.kind, text: String(r.detail ?? ''), legacy: r })) };
  }
  if (res && Array.isArray(res.items)) return { paged: true, next: res.next ?? null, items: res.items };
  return { paged: false, next: null, items: [] };
}

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
