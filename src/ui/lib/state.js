// The window's state container: one object, replaced on each change, read with useSyncExternalStore. Kept apart from
// store.js (the actions) so the translations (i18n.js) can read the language without importing the actions back.
import { useRef, useSyncExternalStore } from 'react';

// chats: 3.8.3, what each conversation with the assistant is doing now (answering, its streamed text, its steps), kept
// apart from `app` so a streamed piece redraws only what shows it; answers: the line each one wrote last (by id).
let state = { version: 0, ready: false, info: null, app: null, chats: [], answers: {}, sessions: [], projects: [], tasks: [], conversations: [], route: { view: 'chat' }, settings: null, testToday: null };
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };
export const getState = () => state;
export function setState(patch) { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; emit(); }
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
// 3.0: a component draws again only when what it selects changes (before, every change of the store redrew every
// component). A selector that builds a new object or array each time is compared one level deep, so it stays stable.
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a); if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
};
const whole = (s) => s;
export function useStore(select = whole) {
  const last = useRef(null);
  const snapshot = () => {
    const prev = last.current;
    if (prev && prev.state === state && prev.select === select) return prev.value;
    const value = select(state);
    last.current = { state, select, value: prev && same(prev.value, value) ? prev.value : value };
    return last.current.value;
  };
  return useSyncExternalStore(subscribe, snapshot);
}
// The window's language (Ajustes › Idioma; Spanish until the engine's settings arrive).
export const uiLanguage = (s) => s.app?.config?.language || 'es';
