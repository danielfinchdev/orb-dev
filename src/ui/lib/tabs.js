// The chat tabs of this window (src/shared/tabs.mjs is the logic): kept in localStorage, so they come back after a reload.
import { useSyncExternalStore } from 'react';
import * as T from '../../shared/tabs.mjs';

const STORE = 'orb.tabs';
const load = () => { try { return T.sanitize(JSON.parse(localStorage.getItem(STORE) || 'null')); } catch { return T.emptyTabs(); } };
let state = load();
const listeners = new Set();
export const tabsState = () => state;
export const useTabs = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
export function setTabs(next) {
  if (next === state) return;
  state = next;
  try { localStorage.setItem(STORE, JSON.stringify(T.toSave(next))); } catch { /* storage unavailable: the tabs last until the window closes */ }
  listeners.forEach((fn) => fn());
}
// act((s) => T.openTab(s, key)): one change, saved
export const actTabs = (fn) => setTabs(fn(state));
// Drops the chats that no longer exist (called when the lists arrive).
export function pruneTabs(exists) {
  let s = state;
  for (const k of state.tabs) if (k !== 'chat:new' && !exists(k)) s = T.closeTab(s, k);
  setTabs(s);
}
