// The Android app checks its crypto and link parsing against committed vectors; they must match what the PC code
// produces now. If this fails, run `npm run android:vectors` and commit the result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

// Whether a malformed punycode host is rejected by URL itself or by Orb's own check depends on the Node version
// (22 vs 24); either way it throws, so only that it throws is compared.
const XN_REJECTED = /("input": "[^"\n]*\/\/xn--[^"\n]*",\n\s*"throws": true,\n\s*)"message": "[^"]*",\n(\s*)"key": "[^"]*"/g;
const norm = (text) => text.replace(XN_REJECTED, '$1"message": "rejected",\n$2"key": "rejected"');

test('the committed Android vectors match the PC code', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-vectors-'));
  try {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/android-vectors.mjs'), tmp], { env, stdio: 'pipe' });
    for (const f of ['crypto.json', 'link-payload.json', 'remote-methods.json']) {
      const committed = norm(fs.readFileSync(path.join(ROOT, 'android/app/src/test/resources/vectors', f), 'utf8'));
      const now = norm(fs.readFileSync(path.join(tmp, f), 'utf8'));
      if (now !== committed) {
        const x = now.split('\n'); const y = committed.split('\n');
        const i = x.findIndex((l, k) => l !== y[k]);
        assert.fail(`${f} is stale (run npm run android:vectors; Node ${process.version}): line ${i + 1}\n  now:       ${x[i]?.slice(0, 300)}\n  committed: ${y[i]?.slice(0, 300)}`);
      }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
