// 3.8.1 (review Tauri D-fix B2): the «in use» probe renames a project's folder beside it and back; if the name could not
// come back then (an antivirus took it), the next try gives it back first and the folder is never lost under the probe.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { folderInUse, putBack } from '../src/core/project-close.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-sonda-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

test('a probe left behind gets its name back before anything else', { skip: process.platform !== 'win32' }, () => {
  const dir = path.join(base, 'web', 'demo');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  assert.equal(folderInUse(dir), false);
  fs.renameSync(dir, `${dir}.orb-comprobando-a1b2c3`);
  assert.equal(folderInUse(dir), false);
  assert.ok(fs.existsSync(path.join(dir, 'a.txt')));
  assert.deepEqual(fs.readdirSync(path.dirname(dir)), ['demo']);
  // Something else with a similar name is not taken for a probe.
  fs.mkdirSync(`${dir}.orb-comprobando-otra-cosa`);
  fs.rmSync(dir, { recursive: true });
  assert.equal(putBack(dir), true); assert.equal(fs.existsSync(dir), false);
});
