// 3.8.10: restoring an older copy of this same PC (same data key) keeps valid the recovery code the person holds now: this
// PC's code file only goes back with the recovery wrap it names, which the copy may have replaced by an older one.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paths } from '../src/platform/paths.mjs';
import { FILES } from '../src/domain/security/master.mjs';
import * as K from '../src/domain/data/backup.mjs';

const put = (file, json) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(json)); };
const saltOf = (home) => JSON.parse(fs.readFileSync(K.recoveryFile(home), 'utf8')).kdf.salt;

function scene({ ownSalt, wrapSalt, copySalt }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-same-'));
  const home = path.join(base, 'home'); const tmp = path.join(base, 'tmp');
  put(path.join(paths(home).secrets, FILES.vault), { keyId: 'K1' });
  put(path.join(paths(home).secrets, FILES.code), { keyId: 'K1', copyId: ownSalt });
  put(K.recoveryFile(home), { kdf: { salt: wrapSalt } });
  put(path.join(paths(tmp).secrets, FILES.vault), { keyId: 'K1' });
  put(K.recoveryFile(tmp), { kdf: { salt: copySalt } });
  return { base, home, tmp };
}
const keys = { proof: true, adopt: async () => ({ byCode: false, keyId: 'K1' }) };

test('an older copy of this PC brings the older wrap: this PC\'s own wrap and code file stay together', async () => {
  const s = scene({ ownSalt: 'B', wrapSalt: 'B', copySalt: 'A' });
  try {
    await K.settleEnvelopes(s.home, s.tmp, keys);
    assert.equal(JSON.parse(fs.readFileSync(path.join(paths(s.tmp).secrets, FILES.code), 'utf8')).copyId, 'B');
    assert.equal(saltOf(s.tmp), 'B', 'the code the person holds now still opens');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a copy that has the wrap the code file names takes the code file and leaves its wrap', async () => {
  const s = scene({ ownSalt: 'B', wrapSalt: 'B', copySalt: 'B' });
  try {
    await K.settleEnvelopes(s.home, s.tmp, keys);
    assert.ok(fs.existsSync(path.join(paths(s.tmp).secrets, FILES.code)));
    assert.equal(saltOf(s.tmp), 'B');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('when neither wrap is the one the code file names, the copy\'s own wrap decides and no code file is taken', async () => {
  const s = scene({ ownSalt: 'X', wrapSalt: 'B', copySalt: 'A' });
  try {
    await K.settleEnvelopes(s.home, s.tmp, keys);
    assert.equal(fs.existsSync(path.join(paths(s.tmp).secrets, FILES.code)), false);
    assert.equal(saltOf(s.tmp), 'A');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});
