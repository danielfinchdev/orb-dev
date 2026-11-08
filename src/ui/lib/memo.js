// 3.8.1 (H4a): the pure comparisons behind the memoised pieces of the screen (a message, a block of a direct conversation,
// a row of the chat list). A key that is too coarse means «it does not update», so they are tested on their own
// (test/memo-ui.test.mjs). No React, no store.

// Two values are the same if they are the same object, or plain data written the same way.
export const sameJson = (x, y) => Object.is(x, y) || (x !== null && y !== null && typeof x === 'object' && typeof y === 'object' && JSON.stringify(x) === JSON.stringify(y));

// The newest value when it changed, else the one already there (so a memo that compares by reference keeps working).
export const keepIfSame = (prev, next) => (sameJson(prev, next) ? prev : next);

// A list fetched again keeps the lines that did not change as they were, so that their memoised Message is not drawn
// again (the engine's events refresh the list several times a second while the assistant answers). The same lines in
// the same order → the very same list.
export function keepSame(prev, next) {
  if (!prev.length) return next;
  const old = new Map(prev.map((m) => [m.id, m]));
  let same = prev.length === next.length;
  const out = next.map((m, i) => {
    const o = old.get(m.id);
    const keep = o && o.body === m.body && o.at === m.at && o.role === m.role && sameJson(o.meta ?? null, m.meta ?? null);
    if (!keep || prev[i] !== o) same = false;
    return keep ? o : m;
  });
  return same ? prev : out;
}

// A block of a direct conversation (views/session.jsx › toBlocks: an item, a tool call with its result, a run of changed
// files) shows the same as before.
export const sameBlock = (a, b) => a.type === b.type && a.key === b.key && a.item === b.item && a.call === b.call && a.result === b.result
  && (a.files === b.files || (a.files?.length === b.files?.length && a.files.every((f, i) => f === b.files[i])));

// A row of the chat list shows the same as before: every field the same (objects such as its tasks or last line
// compared by reference first, then by content).
export const sameItem = (a, b) => { if (a === b) return true; const ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every((k) => sameJson(a[k], b[k])); };
