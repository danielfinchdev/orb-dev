// The numbers of the usage page, as pure functions over the flat records of usage.records (one per day, account and chat,
// task or agent session): the filters, the series of the chart, the breakdowns, the top chats and tasks and the CSV.
// Records from before an account, project or model was recorded carry '' there; the page names those «Cuenta principal»,
// «Sin proyecto» and the default model, so nothing old drops out of a total.

export const DAY_MS = 86_400_000;

// 'YYYY-MM-DD' of the day `back` days before `day` (UTC arithmetic on the date only, so clock changes never skip a day).
export const shiftDay = (day, back) => new Date(Date.parse(`${day}T00:00:00Z`) - back * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
export const eachDay = (from, to) => Array.from({ length: Math.max(0, daysBetween(from, to) + 1) }, (_, i) => shiftDay(to, daysBetween(from, to) - i));

// The window of a period: 1, 7, 30 or 90 days ending today, or the two dates the user typed (never later than today,
// never before a year back, and swapped when written the wrong way round).
export function windowOf(period, custom, today) {
  if (period === 'custom' && custom?.from && custom?.to) {
    let [a, b] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
    if (b > today) b = today;
    if (a > b) a = b;
    const floor = shiftDay(today, 365);
    if (a < floor) a = floor;
    return { from: a, to: b, days: daysBetween(a, b) + 1 };
  }
  const n = Number(period) || 7;
  return { from: shiftDay(today, n - 1), to: today, days: n };
}

// How many days back usage.records must reach to cover the window and the equally long one before it (for the comparison).
export const daysNeeded = (win, today) => Math.min(366, daysBetween(win.from, today) + 1 + win.days);

export const BY = ['agent', 'model', 'project', 'account'];
export const keyOf = (r, by) => (by === 'agent' ? r.agent : by === 'model' ? r.model : by === 'project' ? r.project : r.account) ?? '';
// A filter value of '' means «all»; '-' picks the records that have none (no account, model or project).
export const rawValue = (value) => (value === '-' ? '' : value);
const hit = (want, have) => !want || (have ?? '') === rawValue(want);
export const matches = (r, f) => hit(f.agent, r.agent) && hit(f.account, r.account) && hit(f.model, r.model) && hit(f.project, r.project);
// The value the menus and the breakdown rows use for «' '» (no account, no model, no project): '-' so it can be picked.
export const menuValue = (key) => (key === '' ? '-' : key);

export const tokensOf = (r) => (r.tokensIn ?? 0) + (r.tokensOut ?? 0) + (r.tokensCache ?? 0);
export const valueOf = (r, metric) => (metric === 'cost' ? r.usd ?? 0 : tokensOf(r));
export const inDays = (records, from, to) => records.filter((r) => r.day >= from && r.day <= to);
export const filterRecords = (records, f, from, to) => records.filter((r) => r.day >= from && r.day <= to && matches(r, f));

export function totals(records) {
  const t = { usd: 0, tokensIn: 0, tokensOut: 0, tokensCache: 0, tokens: 0, turns: 0, items: 0 };
  const seen = new Set();
  for (const r of records) {
    t.usd += r.usd ?? 0; t.tokensIn += r.tokensIn ?? 0; t.tokensOut += r.tokensOut ?? 0; t.tokensCache += r.tokensCache ?? 0; t.turns += r.turns ?? 0;
    if (r.kind !== 'other') seen.add(`${r.kind}:${r.id}`);
  }
  t.tokens = t.tokensIn + t.tokensOut + t.tokensCache; t.items = seen.size;
  return t;
}

// The series of the chart: one value per day for each entity of the grouping, the biggest first; days with no use are 0.
export function seriesOf(records, days, by, metric) {
  const at = new Map(days.map((d, i) => [d, i]));
  const map = new Map();
  const totalsByDay = days.map(() => 0);
  const itemsByDay = days.map(() => new Set());
  for (const r of records) {
    const i = at.get(r.day); if (i == null) continue;
    const k = keyOf(r, by); const v = valueOf(r, metric);
    const line = map.get(k) ?? { key: k, values: days.map(() => 0), total: 0 };
    line.values[i] += v; line.total += v; map.set(k, line);
    totalsByDay[i] += v;
    if (r.kind !== 'other') itemsByDay[i].add(`${r.kind}:${r.id}`);
  }
  const lines = [...map.values()].filter((l) => l.total > 0).sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));
  return { lines, totals: totalsByDay, items: itemsByDay.map((s) => s.size) };
}

// A colour slot (1 to 5) that follows the entity, not its rank: the known agents have their own, everything else is
// placed by its name among the names of the whole loaded data, so a filter never repaints a series.
const AGENT_SLOT = { claude: 1, codex: 2, cursor: 3 };
export function slotOf(by, key, universe) {
  if (by === 'agent' && AGENT_SLOT[key]) return AGENT_SLOT[key];
  const names = [...new Set(universe)].sort((a, b) => String(a).localeCompare(String(b)));
  const i = Math.max(0, names.indexOf(key));
  return (i % 5) + 1;
}

export function breakdownOf(records, by, metric) {
  const map = new Map();
  for (const r of records) { const k = keyOf(r, by); const e = map.get(k) ?? { key: k, value: 0, agent: r.agent }; e.value += valueOf(r, metric); map.set(k, e); }
  const rows = [...map.values()].filter((e) => e.value > 0).sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
  const sum = rows.reduce((n, e) => n + e.value, 0) || 1;
  return rows.map((e) => ({ ...e, share: e.value / sum }));
}

// The chats and tasks that spent most, with what they spent over the days given.
export function topItems(records, metric) {
  const map = new Map();
  for (const r of records) {
    if (r.kind === 'other') continue;
    const k = `${r.kind}:${r.id}`;
    const e = map.get(k) ?? { key: k, kind: r.kind, id: r.id, title: r.title, project: r.project, agent: r.agent, model: r.model, modelLabel: r.modelLabel, last: r.day, tokens: 0, usd: 0 };
    e.tokens += tokensOf(r); e.usd += r.usd ?? 0; if (r.day > e.last) e.last = r.day;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => (metric === 'cost' ? b.usd - a.usd || b.tokens - a.tokens : b.tokens - a.tokens || b.usd - a.usd));
}

const CR = String.fromCharCode(13); const LF = String.fromCharCode(10); const BOM = String.fromCharCode(0xfeff);
// A cell that starts like a formula gets a quote in front, so a spreadsheet shows it as text instead of running it.
export const csvCell = (v) => { let x = String(v ?? ''); if ('=+-@'.includes(x[0] ?? ' ') || x[0] === String.fromCharCode(9) || x[0] === CR) x = `'${x}`; return /[",;]/.test(x) || x.includes(CR) || x.includes(LF) ? `"${x.replaceAll('"', '""')}"` : x; };
// The comparison only means something when the whole period before is among the loaded days.
export const prevLoaded = (loadedFrom, from, span) => Boolean(loadedFrom) && shiftDay(from, span) >= loadedFrom;
// What is filtered, one line per record, with a BOM so a spreadsheet opens the accents right.
export function toCsv(records, names) {
  const head = ['day', 'type', 'name', 'project', 'agent', 'account', 'model', 'tokens_in', 'tokens_out', 'tokens_cache', 'cost_usd'];
  const lines = [head, ...[...records].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).map((r) => [r.day, r.kind, r.title || (r.id != null ? `#${r.id}` : ''), r.project || names.noProject, names.agent(r.agent), names.account(r), r.modelLabel || r.model || names.defaultModel, r.tokensIn, r.tokensOut, r.tokensCache, (r.usd ?? 0).toFixed(4)])];
  return BOM + lines.map((l) => l.map(csvCell).join(',')).join(CR + LF) + CR + LF;
}

// A rounded top for the axis (1, 2, 2.5, 5, 10 times a power of ten).
export function niceMax(m) {
  if (!(m > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(m)); const r = m / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
}

// A smooth line through the points: monotone cubic, so it never overshoots a point nor dips under 0.
export function smoothPath(pts) {
  if (pts.length < 2) return '';
  const f = (n) => n.toFixed(1);
  const d = []; const h = []; const m = [];
  for (let i = 0; i < pts.length - 1; i++) { h[i] = pts[i + 1][0] - pts[i][0]; d[i] = (pts[i + 1][1] - pts[i][1]) / h[i]; }
  m[0] = d[0]; m[pts.length - 1] = d[pts.length - 2];
  for (let i = 1; i < pts.length - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < d.length; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i]; const b = m[i + 1] / d[i]; const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let p = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) p += ` C${f(pts[i][0] + h[i] / 3)} ${f(pts[i][1] + (m[i] * h[i]) / 3)} ${f(pts[i + 1][0] - h[i] / 3)} ${f(pts[i + 1][1] - (m[i + 1] * h[i]) / 3)} ${f(pts[i + 1][0])} ${f(pts[i + 1][1])}`;
  return p;
}
