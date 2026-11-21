// every notification passes here. One on screen at a time, the same one never twice in a row, and all of them kept
// for the bell of the top bar (components/notification-center.jsx), with a dot while there are new ones.
import { toast } from 'sonner';
import { getState, setState } from './state.js';
import { errorText } from './utils.js';

// The only module that talks to the toast library (eslint.config.mjs forbids importing it anywhere else).
export { Toaster } from 'sonner';

const KEY = 'orb.notices';
const SEEN = 'orb.noticesSeen';
const MAX = 60;
const REPEAT_MS = 90_000; // the same text again within this time: counted in the bell, not shown again
const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* this session only */ } };

const saved = read(KEY, []);
const list = Array.isArray(saved) ? saved.filter((n) => n && typeof n.body === 'string').slice(0, MAX) : [];
setState({ notices: list, noticesUnread: list.some((n) => n.at > Number(read(SEEN, 0))) });

// What is on screen now: an attention notice is not covered by a passing piece of news (that one waits in the bell).
let current = { id: null, level: 'info', until: 0 };
const levelOf = (tone) => (tone === 'warning' || tone === 'error' ? 'attention' : 'info');

// Records a notification and says whether it may show now. n: { title?, body, tone: info|success|warning|error, go? }.
// toast: true shows it as a passing notification here; false leaves the showing to the caller (the robot of notices.jsx).
// always: the same text again shows again (the answer to a click, never a repeat of an engine notice).
// record: false keeps it out of the bell (a hint that means nothing a minute later).
export function notify(n, { toast: asToast = true, ms, always = false, record = true } = {}) {
  // Without the emoji some engine notices start with (the tone's icon already says it).
  const body = String(n.body ?? '').replace(/^\p{Extended_Pictographic}️?\s*/u, '').trim(); if (!body && !n.title) return { show: false };
  const now = Date.now();
  const tone = ['success', 'warning', 'error'].includes(n.tone) ? n.tone : 'info';
  const notices = getState().notices ?? [];
  // always: a notice that must never be silenced by the repeat filter (a screen capture of the PC)
  const same = n.always === true ? null : notices.find((x) => x.body === body && (x.title ?? '') === (n.title ?? '') && now - x.at < REPEAT_MS);
  if (same && !always) {
    const next = notices.map((x) => (x === same ? { ...x, count: (x.count ?? 1) + 1, at: now } : x));
    setState({ notices: next }); write(KEY, next);
    return { show: false };
  }
  const entry = same ? same : { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, at: now, title: n.title ?? null, body, tone, go: n.go ?? null };
  if (record && !same) { const next = [entry, ...notices].slice(0, MAX); setState({ notices: next, noticesUnread: true }); write(KEY, next); }
  const level = levelOf(tone);
  if (current.level === 'attention' && level === 'info' && current.until > now) return { show: false, id: entry.id };
  const duration = ms ?? (level === 'attention' ? 8000 : 4500);
  current = { id: entry.id, level, until: now + duration };
  toast.dismiss();
  setState({ popup: entry.id });
  if (asToast) {
    const pop = () => {
      current = { id: entry.id, level, until: Date.now() + duration };
      const show = toast[tone] ?? toast.info;
      show(n.title ?? body, { id: entry.id, duration, description: n.title ? body : undefined, action: n.action, onDismiss: () => popupClosed(entry.id) });
    };
    // one line fits in the window's corner under any dialog; a taller one would cover the dialog's controls
    const tall = Boolean(n.title) || Boolean(n.action) || body.length > 60;
    // (held back, nothing is on screen: it must not keep later notices away)
    if (held && tall) { waiting = { pop, at: now, duration }; current = { ...current, until: 0 }; } else { waiting = null; pop(); }
  }
  return { show: true, id: entry.id };
}

// A dialog that leaves no room around it holds the tall notices back (main.jsx › useToastInsets says when): they are in the
// bell meanwhile, and the latest one shows when the dialog closes (unless a newer notice has shown since).
let held = false;
let waiting = null;
export function holdNotices(on) {
  if (held === on) return;
  held = on;
  // one that waited longer than it would have stayed on screen is old news: it stays in the bell only
  if (!on && waiting) { const w = waiting; waiting = null; if (Date.now() - w.at <= w.duration * 4) w.pop(); }
}

// The popup closed before its time (its X, or the user went where it pointed): the next one may show.
export function popupClosed(id) { if (current.id === id) current = { ...current, until: 0 }; }

export function markNoticesSeen() { write(SEEN, Date.now()); setState({ noticesUnread: false }); }
export function clearNotices() { write(KEY, []); write(SEEN, Date.now()); setState({ notices: [], noticesUnread: false }); }

// What an action says about itself: the same text every time, shown each time it happens.
export const notifyOk = (body, o) => notify({ body, tone: 'success' }, { always: true, ...o });
export const notifyInfo = (body, o) => notify({ body, tone: 'info' }, { always: true, ...o });
export const notifyWarn = (body, o) => notify({ body, tone: 'warning' }, { always: true, ...o });
// A failure: an error (or a fixed text) with paths and secrets taken out of what it says.
export const notifyError = (error, o) => notify({ body: errorText(error), tone: 'error' }, { always: true, ...o });
// A long step in progress («Instalando…»): not kept in the bell. Returns the function that closes it.
export function notifyProgress(body) {
  const id = toast.loading(body);
  return () => toast.dismiss(id);
}
