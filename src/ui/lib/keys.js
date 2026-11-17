// The window's shortcut table (src/shared/keybindings.mjs): the defaults plus the user's rules from core/keybindings.json.
// A screen asks for a command (useShortcut) instead of reading keys itself, so changing a key in Ajustes changes it everywhere.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { call, bridge, getState } from './store.js';
import { resolve, matchCommand } from '../../shared/keybindings.mjs';

let current = { rules: [], problems: [], ...resolve([]) };
const listeners = new Set();
const publish = (rules, problems = []) => {
  const r = resolve(rules);
  current = { rules, problems: [...problems, ...r.problems], table: r.table };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const keyTable = () => current.table;
export const useKeys = () => useSyncExternalStore(subscribe, () => current);

let watching = false;
export async function loadKeys() {
  if (bridge.mobile) return;
  if (!watching) { watching = true; bridge.on?.('keys:changed', () => { loadKeys(); }); }
  try { const r = await call('keys.get'); publish(Array.isArray(r?.rules) ? r.rules : [], Array.isArray(r?.problems) ? r.problems.filter((p) => p.index === -1) : []); } catch { /* the defaults stay */ }
}
// → { saved, problems }; a clash is never saved (the engine checks it too).
export async function saveKeys(rules) {
  const r = await call('keys.save', { rules });
  if (r?.saved) publish(r.rules, []);
  return r;
}

// `handler(e)` runs when the key of `command` is pressed in a place where it counts. It calls preventDefault itself when it
// takes the key. capture: before the others (the keys the web view would take, such as Ctrl+W).
export function useShortcut(command, handler, { capture = false, enabled = true } = {}) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    const on = (e) => {
      if (matchCommand(current.table, e, { view: getState().route?.view }) === command) ref.current(e);
    };
    window.addEventListener('keydown', on, capture);
    return () => window.removeEventListener('keydown', on, capture);
  }, [command, capture, enabled]);
}
