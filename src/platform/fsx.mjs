// File system helpers with no Orb rules: real paths through junctions and links.
import fs from 'node:fs';
import path from 'node:path';

// Inside `root` (also through a junction or a link, and for a folder not made yet: its nearest existing parent counts).
export function inside(root, target) {
  const real = (p) => {
    let at = path.resolve(p); const rest = [];
    for (;;) {
      try { return path.join(fs.realpathSync.native(at), ...rest.reverse()); } catch { /* not there: its parent */ }
      const up = path.dirname(at); if (up === at) return path.resolve(p);
      rest.push(path.basename(at)); at = up;
    }
  };
  const r = real(root).toLowerCase().replace(/[\\/]+$/, ''); const t = real(target).toLowerCase().replace(/[\\/]+$/, '');
  return t === r || t.startsWith(r + path.sep);
}
