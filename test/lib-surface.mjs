// The surface other programs and older files rely on, gathered in one object (test/superficie.test.mjs compares it
// with test/fixtures/superficie.json). A refactor must leave it unchanged: the RPC methods and who may call them, the
// engine's event names, the default settings, the database schema and the phone link's protocol numbers.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { METHODS, UNLOCK_METHODS, FRESH_UNLOCK } from '../src/core/permissions.mjs';
import { DEFAULT_CONFIG } from '../src/core/home.mjs';
import { PROTOCOL, MIN_PROTOCOL, PAIR_PROTOCOL } from '../src/shared/link-payload.mjs';
import { openDb } from '../src/core/db.mjs';

const sources = (dir) => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(mjs|js)$/.test(e.name)) out.push(f); } }; walk(path.join(ROOT, dir)); return out; };
const keysOf = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? keysOf(v, `${pre}${k}.`) : [`${pre}${k}`]));

// Event names the engine sends (its emit calls, whatever file they are in).
export function eventNames() {
  const names = new Set();
  const dirs = ['src/engine', 'src/core', 'src/agents', 'src/mcp', 'src/shared', 'src/platform', 'src/domain'].filter((d) => fs.existsSync(path.join(ROOT, d)));
  for (const f of dirs.flatMap(sources)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bemit\(\s*'([A-Za-z][\w]*(?::[\w]+)*)'/g)) names.add(m[1]);
  }
  return [...names].sort();
}

export function schema() {
  const db = openDb(':memory:');
  try { return db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all().map((r) => `${r.type} ${r.name}: ${r.sql.replace(/\s+/g, ' ')}`); } finally { db.close(); }
}

export function surface() {
  return {
    methods: Object.fromEntries(Object.entries(METHODS).sort(([a], [b]) => a.localeCompare(b))),
    unlock: [...UNLOCK_METHODS].sort(),
    freshUnlock: FRESH_UNLOCK,
    protocol: { PROTOCOL, MIN_PROTOCOL, PAIR_PROTOCOL },
    config: keysOf(DEFAULT_CONFIG).sort(),
    events: eventNames(),
    schema: schema(),
  };
}
