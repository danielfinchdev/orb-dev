// 3.2: every notification passes here. One on screen at a time, the same one never twice in a row, and all of them kept
// for the bell of the top bar (components/notification-center.jsx), with a dot while there are new ones.
import { toast } from 'sonner';
import { getState, setState } from './store.js';

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
export function notify(n, { toast: asToast = true, ms } = {}) {
  // Without the emoji some engine notices start with (the tone's icon already says it).
  const body = String(n.body ?? '').replace(/^\p{Extended_Pictographic}️?\s*/u, '').trim(); if (!body && !n.title) return { show: false };
  const now = Date.now();
  const tone = ['success', 'warning', 'error'].includes(n.tone) ? n.tone : 'info';
  const notices = getState().notices ?? [];
  const same = notices.find((x) => x.body === body && (x.title ?? '') === (n.title ?? '') && now - x.at < REPEAT_MS);
  if (same) {
    const next = notices.map((x) => (x === same ? { ...x, count: (x.count ?? 1) + 1, at: now } : x));
    setState({ notices: next }); write(KEY, next);
    return { show: false };
  }
  const entry = { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, at: now, title: n.title ?? null, body, tone, go: n.go ?? null };
  const next = [entry, ...notices].slice(0, MAX);
  setState({ notices: next, noticesUnread: true }); write(KEY, next);
  const level = levelOf(tone);
  if (current.level === 'attention' && level === 'info' && current.until > now) return { show: false, id: entry.id };
  const duration = ms ?? (level === 'attention' ? 8000 : 4500);
  current = { id: entry.id, level, until: now + duration };
  toast.dismiss();
  setState({ popup: entry.id });
  if (asToast) {
    const show = toast[tone] ?? toast.info;
    show(n.title ?? body, { id: entry.id, duration, description: n.title ? body : undefined, action: n.action, onDismiss: () => popupClosed(entry.id) });
  }
  return { show: true, id: entry.id };
}

// The popup closed before its time (its X, or the user went where it pointed): the next one may show.
export function popupClosed(id) { if (current.id === id) current = { ...current, until: 0 }; }

export function markNoticesSeen() { write(SEEN, Date.now()); setState({ noticesUnread: false }); }
export function clearNotices() { write(KEY, []); write(SEEN, Date.now()); setState({ notices: [], noticesUnread: false }); }
