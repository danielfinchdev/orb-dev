// 3.8.3 (restructuring): the surface the phone, older files and the window rely on does not move when the code does.
// To change it on purpose, regenerate the snapshot: node test/superficie.test.mjs --write
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { surface } from './lib-surface.mjs';

const FILE = path.join(ROOT, 'test', 'fixtures', 'superficie.json');
if (process.argv.includes('--write')) fs.writeFileSync(FILE, `${JSON.stringify(surface(), null, 1)}\n`);
const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const now = surface();

test('the RPC methods, their channel and the unlock rules are the same', () => {
  assert.deepEqual(now.methods, saved.methods);
  assert.deepEqual(now.unlock, saved.unlock);
  assert.deepEqual(now.freshUnlock, saved.freshUnlock);
});
test('the phone link keeps its protocol numbers (4, oldest 2)', () => assert.deepEqual(now.protocol, saved.protocol));
test('orb.json keeps its default keys', () => assert.deepEqual(now.config, saved.config));
test('the engine sends the same events', () => assert.deepEqual(now.events, saved.events));
test('orb.db keeps its schema', () => assert.deepEqual(now.schema, saved.schema));

test('the event catalog (src/shared/events.mjs) lists exactly what the engine sends, and the window hears only listed events', async () => {
  const { ENGINE_EVENTS, EVENTS } = await import('../src/shared/events.mjs');
  assert.deepEqual([...ENGINE_EVENTS].sort(), now.events);
  const heard = new Set();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(js|jsx)$/.test(e.name)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:event === |bridge\.on\()'([a-zA-Z]+:[a-zA-Z:]+|notice)'/g)) heard.add(m[1]); } };
  walk(path.join(ROOT, 'src', 'ui'));
  assert.deepEqual([...heard].filter((e) => !EVENTS.includes(e)), []);
});
