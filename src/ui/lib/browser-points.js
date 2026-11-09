// 3.8.2 (T3 3.11): what the user pointed at in the agents' browser (its little window, «Señalar elemento»): the engine
// says so with 'browser:pointed' { session, path, text } (this PC's window only). The chat it belongs to opens and its
// message box gets the picture and a line with the element; nothing is sent until the user sends it.
const waiting = new Map(); // session id -> [{ path, text }]
const listeners = new Set();

// The line for the message box. Pure (tested).
export function pointLine({ selector, text, url } = {}) {
  const what = [selector ? `\`${String(selector).replace(/`/g, '')}\`` : null, text ? `«${String(text).slice(0, 300)}»` : null].filter(Boolean).join(' ');
  return [what, url ? `(${url})` : null].filter(Boolean).join(' ');
}

// Registered once by the window (main.jsx). open(id): go to that chat.
export function listenPoints(bridge, open) {
  return bridge.on('browser:pointed', (p) => {
    if (!p?.session || !p.path) return;
    const id = String(p.session);
    waiting.set(id, [...(waiting.get(id) ?? []), { path: p.path, text: pointLine(p) }]);
    for (const fn of listeners) fn(id);
    open(p.session);
  });
}
// What is waiting for one chat (taken once).
export function takePoints(id) { const list = waiting.get(String(id)) ?? []; waiting.delete(String(id)); return list; }
export function onPoints(fn) { listeners.add(fn); return () => listeners.delete(fn); }
