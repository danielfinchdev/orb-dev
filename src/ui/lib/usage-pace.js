// 3.8.2: an even pace through a plan's window (the usage page): how much of it would be used by now if it were spent
// evenly from its start to its reset. Only for windows whose length is known (the session of 5 h, the week, «<n>min»).
export function windowMs(name) {
  const s = String(name ?? '');
  if (/five_hour|^5h$/.test(s)) return 5 * 3_600_000;
  if (/seven_day/.test(s)) return 7 * 86_400_000;
  const min = Number(s.match(/^(\d+)min$/)?.[1]);
  return min ? min * 60_000 : null;
}
// → 0–100, or null when it cannot be told (no reset time, an unknown window, a reset already past).
export function paceOf(w, now = Date.now()) {
  const length = windowMs(w?.window);
  if (!length || !w?.resetAt || w.resetAt <= now) return null;
  return Math.round(Math.min(100, Math.max(0, (1 - (w.resetAt - now) / length) * 100)));
}
