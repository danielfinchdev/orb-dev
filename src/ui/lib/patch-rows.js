// A file's unified patch as rows for the Cambios viewer: one row per line with its number on each side, and the two
// other layouts the viewer offers (the old side alone, and old/new in two columns), all built from that same patch.
import { hunkStart } from './diff-hunk.js';

// kind: 'hunk' | 'meta' | 'ctx' | 'add' | 'del'. A code row has the line without its sign (`body`), the sign (`sign`) and
// its number in the old file (`oldNo`, not for an added line) and in the new one (`newNo`, not for a removed line).
// What comes before the first «@@» (diff --git, index, ---, +++) is left out: the file is named apart.
export function patchRows(text) {
  const out = [];
  let oldN = 0; let newN = 0; let started = false;
  const all = String(text ?? '').split('\n');
  if (all.at(-1) === '') all.pop();
  for (const l of all) {
    if (l.startsWith('@@')) { started = true; [oldN, newN] = hunkStart(l); out.push({ kind: 'hunk', l }); continue; }
    if (!started) continue;
    if (l.startsWith('\\')) { out.push({ kind: 'meta', l }); continue; } // «\ No newline at end of file»
    const sign = l[0] === '+' || l[0] === '-' || l[0] === ' ' ? l[0] : '';
    const body = sign ? l.slice(1) : l;
    if (sign === '+') out.push({ kind: 'add', sign, body, newNo: newN++ });
    else if (sign === '-') out.push({ kind: 'del', sign, body, oldNo: oldN++ });
    else out.push({ kind: 'ctx', sign, body, oldNo: oldN++, newNo: newN++ });
  }
  return out;
}

// «Antes»: the file as it was (context and removed lines). The added ones are not part of it.
export const beforeRows = (rows) => rows.filter((r) => r.kind !== 'add');

// «Dividido»: removed lines on the left, added on the right, side by side in the order of the patch; a block of removed
// lines meets the block of added lines that follows it row by row. A hunk header or a note spans both columns (`full`).
export function splitPairs(rows) {
  const out = [];
  let dels = []; let adds = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = []; adds = [];
  };
  for (const r of rows) {
    if (r.kind === 'del') { if (adds.length) flush(); dels.push(r); continue; }
    if (r.kind === 'add') { adds.push(r); continue; }
    flush();
    out.push(r.kind === 'ctx' ? { left: r, right: r } : { full: r });
  }
  flush();
  return out;
}

// The comment a line takes: the number and side the engine and the next message use (the old side for a removed line).
export const lineAt = (r, side) => (side === 'old' || r.kind === 'del' ? { line: r.oldNo, side: 'old' } : { line: r.newNo, side: 'new' });

// A whole file as rows for «Antes» / «Después»: every line with its number, the ones the patch added (side 'after') or removed
// (side 'before') marked like the diff marks them. `patch` is only read for those numbers.
// A longer file is not drawn whole (a row per line would freeze the window): fileRows answers null and the caller shows the patch.
export const MAX_FILE_LINES = 8000;
export function fileTooLong(text) {
  const s = String(text ?? ''); let n = 0;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) if (++n > MAX_FILE_LINES) return true;
  return n + (s === '' || s.endsWith('\n') ? 0 : 1) > MAX_FILE_LINES;
}
export function fileRows(text, patch, side) {
  if (fileTooLong(text)) return null;
  const before = side === 'before';
  const marked = new Set(patchRows(patch).filter((r) => r.kind === (before ? 'del' : 'add')).map((r) => (before ? r.oldNo : r.newNo)));
  const lines = String(text ?? '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((l, i) => {
    const no = i + 1; const hit = marked.has(no);
    const body = l.replace(/\r$/, '');
    return { kind: hit ? (before ? 'del' : 'add') : 'ctx', sign: hit ? (before ? '-' : '+') : ' ', body, ...(before ? { oldNo: no } : { newNo: no }) };
  });
}

// The line of the file where its first change is, for «Abrir en el editor» (null when the patch has none).
export function firstChangeLine(patch) {
  const rows = patchRows(patch);
  const i = rows.findIndex((r) => r.kind === 'add' || r.kind === 'del');
  if (i < 0) return null;
  const r = rows[i];
  if (r.kind === 'add') return r.newNo;
  const next = rows.slice(i).find((x) => x.newNo != null);
  return next?.newNo ?? r.oldNo ?? null;
}
