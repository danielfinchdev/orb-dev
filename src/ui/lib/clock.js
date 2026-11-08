// 3.8.1 (H4a): the day and the time zone the dates on screen are written for (no React: lib/use-day.js is the hook).
// Memoised pieces (a message's time, the chat list's rows) are not drawn again by themselves: they follow the day,
// which changes at midnight and when the system's time zone changes with the app open (a trip), and the date formatters
// kept for speed are made again for the new zone (an Intl.DateTimeFormat keeps the zone it was made with). Checked
// once a minute while something shows a date, and when the window is seen again.
const zoneNow = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { return ''; } };
let zone = zoneNow();
let key = `${new Date().toDateString()}|${zone}`;
const subs = new Set();
let timer = null;

// The time zone the formatters must be made for (part of their cache keys).
export const timeZone = () => zone;
// «Mon Nov 09 2026|Europe/Madrid»: changes when the day or the zone does.
export const clockKey = () => key;

// → true when the day or the zone changed since the last look (and tells everything that shows a date).
export function checkClock() {
  const z = zoneNow();
  const k = `${new Date().toDateString()}|${z}`;
  if (k === key) return false;
  zone = z; key = k;
  for (const fn of [...subs]) fn();
  return true;
}

const seen = () => { if (!globalThis.document?.hidden) checkClock(); };
// fn() runs when the day or the zone changes. → unsubscribe.
export function onClock(fn) {
  subs.add(fn);
  if (subs.size === 1) {
    timer = setInterval(checkClock, 60_000);
    globalThis.document?.addEventListener?.('visibilitychange', seen);
    globalThis.addEventListener?.('focus', seen);
  }
  return () => {
    subs.delete(fn);
    if (subs.size) return;
    clearInterval(timer); timer = null;
    globalThis.document?.removeEventListener?.('visibilitychange', seen);
    globalThis.removeEventListener?.('focus', seen);
  };
}
