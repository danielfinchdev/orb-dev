// 3.8.2: F5 reloads Orb's window (the page only: the engine keeps running in its own process, the screen on view comes
// back through main.jsx's saved route). What was typed and not sent in a message box comes back too: it is kept in this
// window's sessionStorage just before the reload and handed once to the same box on the same screen.
const KEY = 'orb.reload-drafts';
const MAX_AGE = 60_000;

const session = () => { try { return window.sessionStorage; } catch { return null; } };
export const routeKey = (route) => `${route?.view ?? ''}:${route?.id ?? ''}`;

// The unsent text of each message box on screen ({ [box]: text }), for the route on view.
export function saveDrafts(route, drafts, storage = session(), now = Date.now()) {
  const kept = Object.fromEntries(Object.entries(drafts ?? {}).filter(([box, text]) => box && typeof text === 'string' && text.trim()));
  try { if (Object.keys(kept).length) storage?.setItem(KEY, JSON.stringify({ route: routeKey(route), drafts: kept, at: now })); else storage?.removeItem(KEY); } catch { /* storage unavailable */ }
}

// The text a box had before the reload, once, and only on the same screen and shortly after.
export function takeDraft(box, route, storage = session(), now = Date.now()) {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(KEY) ?? 'null'); } catch { /* broken: nothing */ }
  if (!saved?.drafts || now - saved.at > MAX_AGE) { try { storage?.removeItem(KEY); } catch { /* storage unavailable */ } return null; }
  if (saved.route !== routeKey(route) || typeof saved.drafts[box] !== 'string') return null;
  const text = saved.drafts[box];
  delete saved.drafts[box];
  try { if (Object.keys(saved.drafts).length) storage.setItem(KEY, JSON.stringify(saved)); else storage.removeItem(KEY); } catch { /* storage unavailable */ }
  return text;
}

// F5 (no Ctrl / Alt / Meta: Ctrl+F5 and the rest are left alone), from anywhere, a text box included.
export const isReloadKey = (e) => e.key === 'F5' && !e.ctrlKey && !e.altKey && !e.metaKey;

export function reloadOrb(route, doc = document, loc = location) {
  const drafts = {};
  for (const box of doc.querySelectorAll('[data-slot=composer] textarea[data-testid]')) drafts[box.dataset.testid] = box.value;
  saveDrafts(route, drafts);
  loc.reload();
}
