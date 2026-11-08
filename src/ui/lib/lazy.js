// 3.8.1 (H4a): screens that load the first time they open (main.jsx), and that recover when that load fails. React.lazy
// keeps a failed load for good (the screen would fail until the page reloads); a phone's browser gets the files from
// the PC over the network, so a weak or dropped connection must end in «Sin conexión · Reintentar», never in a broken
// screen. A screen that failed to load is made again when the user retries (retryLoads, from the ErrorBoundary).
import { createElement, lazy } from 'react';

// A file of the app that could not be fetched (Chromium, Firefox and Safari word it differently; Vite's preload too).
const LOAD_FAILED = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk [\w-]+ failed/i;
export const isLoadError = (e) => Boolean(e) && (e.orbLoad === true || e.name === 'ChunkLoadError' || LOAD_FAILED.test(String(e.message ?? e)));

// The file the browser could not fetch, as the error names it (or null).
export function failedUrl(e) {
  const m = /((?:https?|file|tauri|app|orb):\/\/[^\s'"]+?\.m?js)(?:[?#][^\s'"]*)?(?=$|[\s'"])/i.exec(String(e?.message ?? ''));
  return m ? m[1] : null;
}

// Loads `load()` again. If it fails the same way (a browser that keeps the failed file in its module map), the same file
// with a query that makes it a new request: a module of its own, but its imports are the app's shared ones.
export async function loadAgain(load, attempt = 1, importUrl = (u) => import(/* @vite-ignore */ u)) {
  try { return await load(); } catch (e) {
    const url = failedUrl(e);
    if (!url || !isLoadError(e)) throw e;
    return importUrl(`${url}?retry=${attempt}`);
  }
}

const failed = new Set(); // what makes each failed screen again
// Every screen whose load failed is made again (the next time it is drawn it fetches its file anew). → how many.
export function retryLoads() { const n = failed.size; for (const reset of [...failed]) reset(); failed.clear(); return n; }

// A screen exported as `name` by the module `load()` reads. Screen.preload() fetches it ahead (errors ignored).
export function lazyScreen(load, name) {
  let attempt = 0; let Lazy = null;
  const make = () => lazy(() => (attempt ? loadAgain(load, attempt) : load()).then(
    (m) => ({ default: m[name] }),
    (e) => {
      if (isLoadError(e)) { try { e.orbLoad = true; } catch { /* frozen */ } }
      failed.add(reset);
      throw e;
    }));
  // Only on a retry: making it again from inside the failed render would fetch it in a loop while offline.
  const reset = () => { attempt++; Lazy = null; };
  function Screen(props) { Lazy ??= make(); return createElement(Lazy, props); }
  Screen.preload = () => load().catch(() => {});
  return Screen;
}
