// 3.8.3 (restructuring): every key of orb.db's settings table the code writes or reads is registered in one place
// (src/platform/state.mjs › STATE_KEYS), so a new one is a decision, not a string typed somewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usedStateKeys } from './lib-state-keys.mjs';
import { isStateKey, STATE_KEYS } from '../src/platform/state.mjs';

test('every settings key the code names is registered', () => {
  const unknown = [...usedStateKeys()].filter(([k]) => !isStateKey(k)).map(([k, f]) => `${k} (${f})`);
  assert.deepEqual(unknown, []);
});

test('the registry has no duplicates and every prefix ends with a colon', () => {
  assert.equal(new Set(STATE_KEYS.exact).size, STATE_KEYS.exact.length);
  assert.deepEqual(Object.keys(STATE_KEYS.prefixes).filter((p) => !p.endsWith(':')), []);
  assert.ok(isStateKey('checkpoint:12') && isStateKey('paused') && !isStateKey('anything_else'));
});
