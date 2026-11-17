// The comments written on lines of a turn's diff wait here (per conversation) until the next message goes: the view
// sends them with it (sessions.send › comments) and empties the tray. Kept outside React so the panel and the
// conversation share it.
import { useSyncExternalStore } from 'react';

const byChat = new Map(); const listeners = new Set(); const EMPTY = Object.freeze([]);
const emit = () => { for (const fn of listeners) fn(); };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const commentsOf = (id) => byChat.get(id) ?? EMPTY;
export function addComment(id, c) {
  const text = String(c.text ?? '').trim(); if (!text) return;
  byChat.set(id, [...commentsOf(id), { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, path: c.path, line: c.line, side: c.side === 'old' ? 'old' : 'new', text }]);
  emit();
}
export function removeComment(id, key) { const next = commentsOf(id).filter((c) => c.key !== key); if (next.length) byChat.set(id, next); else byChat.delete(id); emit(); }
export function takeComments(id) { const list = commentsOf(id); byChat.delete(id); emit(); return list.map(({ path, line, side, text }) => ({ path, line, side, text })); }
export function putBackComments(id, list) { if (list.length) { byChat.set(id, [...list.map((c) => ({ ...c, key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` })), ...commentsOf(id)]); emit(); } }
export const useComments = (id) => useSyncExternalStore(subscribe, () => commentsOf(id), () => EMPTY);
