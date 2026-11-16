// the logic of Ctrl+K (components/command-palette.jsx), apart so the tests can run it.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Ctrl+K (⌘K) alone.
// The same palette from a button (no shortcut involved): the palette listens for this event.
export const PALETTE_EVENT = 'orb:palette';
export const openPalette = () => window.dispatchEvent(new Event(PALETTE_EVENT));

// Ctrl+P / Ctrl+Shift+F: the same window, in the mode that searches the project's files ('files') or its text ('text').
export const FINDER_EVENT = 'orb:finder';
export const openFinder = (mode) => window.dispatchEvent(new CustomEvent(FINDER_EVENT, { detail: mode === 'text' ? 'text' : 'files' }));

export const isPaletteKey = (e) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK';

// What a query finds, in groups: places and actions, chats (by title, project or messages), messages of other chats,
// tasks (by number or title, then by what they say) and projects. Without a query, the places and actions.
// found: what lib/search.js › useSearch returned (null while it looks).
export function paletteGroups({ q, cmds, items, found, tasks, projects }) {
  const needle = fold(String(q ?? '').trim());
  if (!needle) return [{ id: 'go', rows: cmds }];
  const has = (s) => fold(s).includes(needle);
  const chats = items.filter((x) => has(x.title) || has(x.project) || (x.kind === 'conversation' ? found?.conversations?.has(x.id) : found?.sessions?.has(x.id))).slice(0, 8);
  const shown = new Set(chats.map((x) => x.key));
  const messages = (found?.messages ?? []).filter((m) => !shown.has(m.key)).map((m) => ({ ...m, item: items.find((x) => x.key === m.key) })).filter((m) => m.item).slice(0, 5);
  const own = tasks.filter((x) => `#${x.id}` === needle || has(x.title)).slice(0, 6);
  const ids = new Set(own.map((x) => x.id));
  return [
    { id: 'go', rows: cmds.filter((c) => has(c.label)) },
    { id: 'chats', rows: chats },
    { id: 'messages', rows: messages },
    { id: 'tasks', rows: [...own, ...(found?.tasks ?? []).filter((x) => !ids.has(x.id))].slice(0, 6) },
    { id: 'projects', rows: projects.filter((p) => has(p.name)).slice(0, 5) }
  ].filter((g) => g.rows.length);
}
