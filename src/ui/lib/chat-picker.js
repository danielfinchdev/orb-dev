// The project picker that «New chat» opens: pure parts (which entries show, which key picks which), so tests run them alone.
// Entry 0 is always «No project»; Ctrl+1 picks the first entry, Ctrl+2 the second… up to Ctrl+9.
export const PICKER_KEYS = 9;

// The entries the picker lists for `query` (a substring of the project's name). «No project» stays while the query is empty
// or matches its label, so a typed filter never leaves the list with nothing to choose.
export function pickerEntries(projects, query, noProjectLabel = '') {
  const q = String(query ?? '').trim().toLowerCase();
  const names = (projects ?? []).map((p) => (typeof p === 'string' ? p : p?.name)).filter(Boolean);
  const entries = [];
  if (!q || String(noProjectLabel).toLowerCase().includes(q)) entries.push({ project: null });
  for (const name of names) if (!q || name.toLowerCase().includes(q)) entries.push({ project: name });
  return entries;
}

// Ctrl+digit → the entry's index, or -1 (Alt or Shift make it another key; Cmd counts as Ctrl like the rest of the app).
export function digitIndex(e) {
  if (!e || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return -1;
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code ?? '') ?? /^([1-9])$/.exec(e.key ?? '');
  return m ? Number(m[1]) - 1 : -1;
}

// The highlighted row after an arrow key, wrapping around.
export const moveActive = (active, key, count) => {
  if (!count) return 0;
  if (key === 'ArrowDown') return (active + 1) % count;
  if (key === 'ArrowUp') return (active - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return Math.min(active, count - 1);
};
