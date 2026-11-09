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
