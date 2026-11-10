// The keys of orb.db's settings table that the code names (test/estado-claves.test.mjs checks each is registered in
// src/platform/state.mjs). Found by reading the sources: the first argument of setting()/settingJson() (a string, the
// fixed start of a template, or a constant defined in the same file) and the keys SQL statements name.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!['renderer', 'ui', 'locales'].includes(e.name)) walk(f); } else if (/\.mjs$/.test(e.name)) files.push(f); } };
walk(path.join(ROOT, 'src'));

export function usedStateKeys() {
  const found = new Map(); // key or prefix → first file
  const add = (k, f) => { if (k && !found.has(k)) found.set(k, path.relative(ROOT, f)); };
  const sources = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
  const constsOf = (code) => [...code.matchAll(/\bconst ([A-Z_0-9]+) = (?:'([^']+)'|`([^`$]*)\$\{)/g)].map((m) => [m[1], m[2] ?? m[3]]);
  const shared = new Map([...sources.values()].flatMap((code) => constsOf(code)));
  for (const f of files) {
    if (/migrate-38\.mjs$/.test(f)) continue; // 3.7's keys, read once to migrate
    const code = sources.get(f);
    const consts = new Map([...shared, ...constsOf(code)]);
    for (const m of code.matchAll(/\.setting(?:Json)?\(\s*(?:'([^']+)'|`([^`$]*)(\$\{)?|([A-Z_]+)\b)/g)) {
      if (m[1]) add(m[1], f);
      else if (m[2] !== undefined) add(m[2], f);
      else if (m[4] && consts.has(m[4])) add(consts.get(m[4]), f);
    }
    for (const m of code.matchAll(/key (?:LIKE|=|>=) '([a-z_:0-9]+)%?'/g)) add(m[1], f);
  }
  return found;
}
