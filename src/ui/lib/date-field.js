// Pure helpers of the date field (a short text button that opens a month calendar). Dates travel as 'YYYY-MM-DD',
// the same shape the engine's filters already take.

const pad = (n) => String(n).padStart(2, '0');

export const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 'YYYY-MM-DD' → a local Date at noon (never moved by a daylight-saving change); null when it is not a real day.
export function fromIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

export function addDays(iso, n) {
  const d = fromIso(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return toIso(d);
}

// «hoy», «ayer», «5 nov» (with the year when it is not this one); '' when there is no date.
export function shortDate(iso, { locale = 'es', today = new Date(), labels = { today: 'hoy', yesterday: 'ayer' } } = {}) {
  const d = fromIso(iso);
  if (!d) return '';
  const now = toIso(today);
  if (iso === now) return labels.today;
  if (iso === addDays(now, -1)) return labels.yesterday;
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).replace(/\./g, '');
}

// The weeks of a month as rows of 7 cells ('YYYY-MM-DD' or null), starting on `firstDay` (0 = Sunday ... 6).
export function monthGrid(year, month, firstDay = 1) {
  const lead = (new Date(year, month, 1).getDay() - firstDay + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => toIso(new Date(year, month, i + 1)))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

// A day outside [min, max] cannot be picked.
export const inRange = (iso, min, max) => (!min || iso >= min) && (!max || iso <= max);
