// File helpers for the code that deletes the user's data (uninstall.mjs, previous.mjs). They never follow a link: a
// symbolic link or a junction is a thing to refuse (as a target) or to remove itself (inside a tree), never a road into
// another folder. Node reports a junction as a symbolic link in lstat.
import fs from 'node:fs';
import path from 'node:path';

export const lstatOrNull = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const stripPrefix = (p) => String(p).replace(/^\\\\\?\\/, '');
// A path as Windows compares them: no \?\ prefix, any case, no trailing separator.
export const keyOf = (p) => stripPrefix(path.resolve(p)).toLowerCase().replace(/[\\/]+$/, '');
export const isUnder = (root, target) => { const r = keyOf(root); const t = keyOf(target); return t !== r && t.startsWith(r + path.sep); };
export const isSameOrUnder = (root, target) => keyOf(root) === keyOf(target) || isUnder(root, target);

// Every existing step from `root` down to `target` is a plain folder or file: no link, no junction in the way. root itself
// is checked too. A target that is not there yet is fine as far as it goes.
export function plainChain(root, target) {
  if (!isSameOrUnder(root, target)) return false;
  let at = path.resolve(root);
  const first = lstatOrNull(at);
  if (!first || first.isSymbolicLink() || !first.isDirectory()) return false;
  const rel = path.relative(path.resolve(root), path.resolve(target));
  for (const part of rel ? rel.split(/[\\/]/) : []) {
    at = path.join(at, part);
    const st = lstatOrNull(at);
    if (!st) return true;
    if (st.isSymbolicLink()) return false;
  }
  return true;
}

// Bytes and files of a tree without following links (a link counts as itself). The walk stops at `limit` entries.
export function sizeOf(p, { limit = 300_000 } = {}) {
  let bytes = 0; let files = 0; let seen = 0;
  const go = (at) => {
    if (seen++ > limit) return;
    const st = lstatOrNull(at); if (!st) return;
    if (st.isSymbolicLink() || !st.isDirectory()) { bytes += st.isSymbolicLink() ? 0 : st.size; files++; return; }
    let names; try { names = fs.readdirSync(at); } catch { return; }
    for (const n of names) go(path.join(at, n));
  };
  go(p);
  return { bytes, files, partial: seen > limit };
}

// Removes the entry; a folder with everything in it. A link met inside is removed as a link, never entered. The top entry
// itself must not be a link. → true when something was removed, false when it was not there. Throws what the system says.
export function removeTree(p) {
  const st = lstatOrNull(p);
  if (!st) return false;
  if (st.isSymbolicLink()) throw Object.assign(new Error(`link: ${p}`), { code: 'ELINK' });
  const go = (at, s) => {
    if (s.isSymbolicLink()) {
      try { fs.unlinkSync(at); } catch { fs.rmdirSync(at); } // a junction or a folder link goes with rmdir
      return;
    }
    if (!s.isDirectory()) { fs.rmSync(at, { force: true }); return; }
    for (const n of fs.readdirSync(at)) { const c = path.join(at, n); const cs = lstatOrNull(c); if (cs) go(c, cs); }
    fs.rmdirSync(at);
  };
  go(p, st);
  return true;
}

// A folder only if it is empty (never a recursive delete). → true when it went.
export function removeIfEmpty(p) {
  const st = lstatOrNull(p);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return false;
  try { fs.rmdirSync(p); return true; } catch { return false; }
}
