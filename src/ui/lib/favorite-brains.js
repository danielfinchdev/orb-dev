// The favourite brains of this window (src/shared/favorite-brains.mjs), kept in the browser's storage: a preference of the
// person at this screen, not of the engine. Everything still works when the storage is not available.
import { useSyncExternalStore } from 'react';
import { parseFavorites, toggleFavorite } from '../../shared/favorite-brains.mjs';

const KEY = 'orb.favoriteBrains';
const read = () => { try { return parseFavorites(localStorage.getItem(KEY)); } catch { return []; } };
let current = read();
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const favoriteBrains = () => current;
export const useFavoriteBrains = () => useSyncExternalStore(subscribe, favoriteBrains);
export function toggleFavoriteBrain(brain) {
  const next = toggleFavorite(current, brain);
  if (next === current) return;
  current = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: it lasts until the window closes */ }
  listeners.forEach((fn) => fn());
}
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) { current = read(); listeners.forEach((fn) => fn()); } });
