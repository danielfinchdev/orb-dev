// The Android app checks its crypto and link parsing against committed vectors; they must match what the PC code
// produces now. If this fails, run `npm run android:vectors` and commit the result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

test('the committed Android vectors match the PC code', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-vectors-'));
  try {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/android-vectors.mjs'), tmp], { env, stdio: 'pipe' });
    for (const f of ['crypto.json', 'link-payload.json', 'remote-methods.json']) {
      const committed = fs.readFileSync(path.join(ROOT, 'android/app/src/test/resources/vectors', f), 'utf8');
      assert.equal(fs.readFileSync(path.join(tmp, f), 'utf8'), committed, `${f} is stale: run npm run android:vectors`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
