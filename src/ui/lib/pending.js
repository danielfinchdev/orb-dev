// 3.8.3: the messages the user just sent, shown before the engine has saved them (lib/store.js › addPending). No React,
// no store (test/fluidez-ui.test.mjs).

// The pending messages of a screen that its lines do not hold yet (lines: [{ id, text }] of what the user wrote). A line
// saved after it with the same text is its own; failing that, any line of the user saved after it (the engine may keep
// the text a little differently), so a message never shows twice.
export function pendingShown(pending, lines) {
  const used = new Set();
  return pending.filter((p) => {
    const newer = lines.filter((l) => !used.has(l.id) && l.id > p.after);
    const hit = newer.find((l) => l.text === p.text) ?? newer[0];
    if (hit) { used.add(hit.id); return false; }
    return true;
  });
}
