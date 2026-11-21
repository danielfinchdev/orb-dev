// A rule's text before and after as one unified patch (for the «Antes / Después» of Normas). No JSX and no alias imports
// (the tests load it in Node). Lines are compared whole; a text too long to compare line by line is shown as all removed
// and all added.
const MAX_CELLS = 4_000_000;

export function linePatch(before, after) {
  const a = String(before ?? '').split('\n'); const b = String(after ?? '').split('\n');
  if (a.join('\n') === b.join('\n')) return '';
  const rows = [];
  if (a.length * b.length > MAX_CELLS) {
    rows.push(...a.map((l) => `-${l}`), ...b.map((l) => `+${l}`));
  } else {
    // longest common subsequence of lines, then walked from the top
    const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0; let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { rows.push(` ${a[i]}`); i++; j++; }
      else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) rows.push(`-${a[i++]}`);
      else rows.push(`+${b[j++]}`);
    }
  }
  return `@@ -1,${a.length} +1,${b.length} @@\n${rows.join('\n')}\n`;
}

// What a rail «Guardar cambios» may write: only the keys the user edited (`edited`, computed against what the card
// loaded), never the rest of the card's copy. `stale` lists the edited keys whose value in the engine now is not the one
// the card loaded (changed elsewhere while editing); the «Antes» is always the engine's current value.
export function railSaveView(loaded, now, edited) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const keys = Object.keys(edited ?? {});
  const changed = {}; const before = {}; const stale = [];
  for (const k of keys) {
    changed[k] = edited[k];
    before[k] = now?.[k];
    if (!same(now?.[k], loaded?.[k])) stale.push(k);
  }
  return { changed, before, stale };
}
