// 3.6: time zones without dependencies (only Intl). Schedules keep a WALL time («every day at 09:00») in the
// owner's zone; the instant (UTC) of each run is worked out here, so a PC in UTC fires a
// Madrid schedule at 09:00 in Madrid, also across both daylight-saving changes.
//   zonedToUtc('2026-03-29T02:30', 'Europe/Madrid')  → Date (spring forward: the first valid minute, 03:00; fall back:
//                                                       the first of the two 02:30)
//   utcToZoned(date, tz)                              → { year, month, day, hour, minute, second, weekday, iso }
//   nextLocalRun(rule, tz, after)                     → Date of the first run after `after` (or null)
// core/schedules calls nextLocalRun (one function for every repeating thing).
const FORMATTERS = new Map();
const formatter = (tz) => {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    FORMATTERS.set(tz, f);
  }
  return f;
};
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const pad = (n, w = 2) => String(n).padStart(w, '0');
const DAY = 86_400_000;

// The zone of this machine (the fallback when the settings name none).
export const systemTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
// The owner's zone: the settings' tz (orb.json), else this machine's.
export const ownerTz = (config) => (isValidTz(config?.tz) ? config.tz : systemTz());
export function isValidTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { formatter(tz); return true; } catch { return false; }
}
const zoneOr = (tz) => (isValidTz(tz) ? tz : systemTz());

// The wall clock of `date` in `tz`.
export function utcToZoned(date, tz) {
  const ms = date instanceof Date ? date.getTime() : typeof date === 'number' ? date : Date.parse(date);
  if (!Number.isFinite(ms)) throw new Error('fecha no válida');
  const parts = {};
  for (const p of formatter(zoneOr(tz)).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const z = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second), weekday: WEEKDAYS[parts.weekday] };
  z.iso = `${pad(z.year, 4)}-${pad(z.month)}-${pad(z.day)}T${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)}`;
  return z;
}
// Offset of `tz` from UTC at the instant `ms` (in ms: Madrid in summer = +2 h).
export function offsetAt(ms, tz) {
  const z = utcToZoned(ms, tz);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// 'YYYY-MM-DDTHH:mm[:ss]' (no zone) → the wall time as if it were UTC (ms), or NaN.
function wallMs(local) {
  if (local && typeof local === 'object') return Date.UTC(local.year, (local.month ?? 1) - 1, local.day ?? 1, local.hour ?? 0, local.minute ?? 0, local.second ?? 0);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(local ?? '').trim());
  if (!m) return NaN;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

// A wall time in `tz` → the instant. A time that does not exist (the hour skipped when clocks go forward) becomes the
// first valid minute after the gap; a time that happens twice (clocks go back) is the first of the two.
export function zonedToUtc(local, tz) {
  const zone = zoneOr(tz);
  const L = wallMs(local);
  if (!Number.isFinite(L)) throw new Error('hora local no válida');
  const offsets = [...new Set([offsetAt(L - DAY, zone), offsetAt(L, zone), offsetAt(L + DAY, zone)])];
  const valid = offsets.map((o) => L - o).filter((t) => {
    const z = utcToZoned(t, zone);
    return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second) === L;
  });
  if (valid.length) return new Date(Math.min(...valid));
  // In a gap: the change happens between the two candidate instants; find it (to the second) and run then.
  const cands = offsets.map((o) => L - o).sort((a, b) => a - b);
  let lo = cands[0]; let hi = cands[cands.length - 1];
  const before = offsetAt(lo, zone);
  while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2 / 1000) * 1000; if (offsetAt(mid, zone) === before) lo = mid; else hi = mid; }
  return new Date(hi);
}

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const parseTime = (t, fallback) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(t ?? ''));
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : fallback;
};

// The first run strictly after `after` of a rule in `tz`.
// rule: { every: 'once'|'hourly'|'every_hours'|'daily'|'weekly'|'monthly'|'yearly', start?: local wall time ('YYYY-MM-DDTHH:mm':
//   when it begins and, for monthly/yearly, which day), time?: 'HH:mm' (defaults to start's), weekdays?: [0-6] (Sunday 0),
//   hours?: N for every_hours }.
export function nextLocalRun(rule, tz, after = Date.now()) {
  const zone = zoneOr(tz);
  const afterMs = after instanceof Date ? after.getTime() : Number(after);
  const startWall = rule?.start != null ? wallMs(rule.start) : NaN;
  const start = Number.isFinite(startWall) ? (() => { const d = new Date(startWall); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }; })() : null;
  const startAt = start ? zonedToUtc(start, zone).getTime() : -Infinity;
  const every = rule?.every ?? 'once';
  if (every === 'once') { if (!start) return null; return startAt > afterMs ? new Date(startAt) : null; }
  if (every === 'hourly') { const base = Math.max(afterMs, startAt - 1); return new Date((Math.floor(base / 3_600_000) + 1) * 3_600_000); }
  if (every === 'every_hours') {
    const step = Math.max(1, Math.min(168, Number(rule.hours) || 6)) * 3_600_000;
    if (!start) return new Date(afterMs + step);
    if (startAt > afterMs) return new Date(startAt);
    return new Date(startAt + (Math.floor((afterMs - startAt) / step) + 1) * step);
  }
  const time = parseTime(rule.time, start ? { hour: start.hour, minute: start.minute } : { hour: 9, minute: 0 });
  const days = every === 'weekly' ? ((rule.weekdays?.length ? rule.weekdays : [start ? new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay() : 1]).map(Number)) : null;
  // Walk local days from the later of (the day before `after`) and the start's day.
  const from = utcToZoned(Math.max(afterMs, startAt) - DAY, zone);
  let cursor = Date.UTC(from.year, from.month - 1, from.day);
  if (start) cursor = Math.max(cursor, Date.UTC(start.year, start.month - 1, start.day));
  const limit = every === 'yearly' ? 366 * 9 : every === 'monthly' ? 400 : 16;
  for (let i = 0; i < limit; i++, cursor += DAY) {
    const d = new Date(cursor); const y = d.getUTCFullYear(); const m = d.getUTCMonth() + 1; const day = d.getUTCDate();
    if (days && !days.includes(d.getUTCDay())) continue;
    if (every === 'monthly' || every === 'yearly') {
      const want = start?.day ?? 1;
      if (day !== Math.min(want, daysIn(y, m))) continue;
      if (every === 'yearly' && m !== (start?.month ?? 1)) continue;
    }
    const at = zonedToUtc({ year: y, month: m, day, hour: time.hour, minute: time.minute }, zone).getTime();
    if (at > afterMs && at >= startAt) return new Date(at);
  }
  return null;
}

// Local date ('YYYY-MM-DD') of an instant in a zone (daily backups, usage days).
export const localDay = (date, tz) => utcToZoned(date, tz).iso.slice(0, 10);
