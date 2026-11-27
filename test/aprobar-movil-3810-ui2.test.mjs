// 3.8.10, step 7 A2, the window's rest: «Lo he olvidado todo» and the phone's approval in the dialogs that fill in first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { rebuildReadiness, countdown, waitApproval } from '../src/ui/lib/approve.js';
import { unlockCore, setMasterAsker, dropUnlock } from '../src/ui/lib/core-access.js';
import es from '../src/shared/locales/es/master.mjs';
import en from '../src/shared/locales/en/master.mjs';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const phone = { phones: [{ id: 'p1', name: 'Pixel de Dani', registered: true }, { id: 'p2', name: 'Otro', registered: false }] };

test('«Lo he olvidado todo» needs a registered phone and Windows Hello, and says which is missing', async () => {
  const hello = { available: true, enabled: true, valid: true, tpm: true };
  const ask = (devices, st) => async (m) => { if (m === 'approve.devices') return devices; if (m === 'master.helloState') return st; throw new Error(m); };
  assert.deepEqual(await rebuildReadiness(ask(phone, hello)), { ok: true, phone: 'Pixel de Dani', phoneId: 'p1' });
  assert.equal((await rebuildReadiness(ask({ phones: [{ id: 'p2', registered: false }] }, hello))).reason, 'noPhone');
  assert.equal((await rebuildReadiness(ask(phone, { available: true, enabled: false }))).reason, 'noHello');
  assert.equal((await rebuildReadiness(ask(phone, null))).reason, 'noHello');
  assert.equal((await rebuildReadiness(async () => { throw new Error('x'); })).reason, 'noPhone');
});

test('the countdown reads m:ss and stops at zero; the rebuild polls its own call', async () => {
  assert.equal(countdown(120_000, 0), '2:00');
  assert.equal(countdown(61_500, 0), '1:02');
  assert.equal(countdown(1000, 5000), '0:00');
  const seen = [];
  const r = await waitApproval(async (m, p) => { seen.push([m, p.id]); return { state: 'done' }; }, 'r', { method: 'master.rebuildPoll' });
  assert.equal(r.state, 'done');
  assert.deepEqual(seen, [['master.rebuildPoll', 'r']]);
});

test('the dialogs that fill in first ask for the phone with the exact parameters, after the form', () => {
  assert.match(read('src/ui/views/agents.jsx'), /unlockCore\('secrets', \{ request: \{ method: 'agentKeys\.save', params \} \}\)[\s\S]*?\{ \.\.\.params, unlock \}/);
  assert.match(read('src/ui/views/master.jsx'), /request: \{ method: 'secrets\.saveConnector', params \}[\s\S]*?\{ \.\.\.params, unlock: again \}/);
  const data = read('src/ui/views/data.jsx');
  assert.match(data, /request: \{ method: 'backup\.restore', params \}/);
  assert.match(data, /if \(!info\.mobile\) await call\('backup\.verify'/, 'a phone\'s token is for the restore alone');
  assert.match(read('src/ui/views/session.jsx'), /unlockCore\('fullAccess', \{ request: \{ method: 'sessions\.grantTotal', params: \{ id: s\.id \} \} \}\)/);
  assert.match(read('src/ui/views/chat.jsx'), /method === 'sessions\.grantTotal' \? \{ request/);
  assert.match(read('src/ui/components/secret-card.jsx'), /method: 'secrets\.answer'/);
});

test('a phone\'s token reports itself to the caller and is never kept', async () => {
  const info = {};
  setMasterAsker(async () => ({ unlock: 'movil', until: Date.now() + 120_000, strength: 'mobile' }));
  assert.equal(await unlockCore('restore', { request: { method: 'backup.restore', params: {} }, info }), 'movil');
  assert.equal(info.mobile, true);
  const own = {};
  setMasterAsker(async () => ({ unlock: 'clave', until: Date.now() + 120_000 }));
  assert.equal(await unlockCore('restore', { info: own }), 'clave');
  assert.equal(own.mobile, undefined);
  dropUnlock();
});

test('the forgot flow offers the three ways and the rebuild asks Hello, the phone and the new password in order', () => {
  const master = read('src/ui/views/master.jsx');
  assert.match(master, /value: 'all', label: tNow\('master\.forgotAll'\)/);
  assert.match(master, /rb\.ok \? await rebuildFlow\(rb\) : await noRebuild\(rb, lost\)/);
  const rebuild = read('src/ui/views/rebuild.jsx');
  assert.match(rebuild, /purpose: 'rebuild-master'/);
  assert.ok(rebuild.indexOf('master.rebuildStart') < rebuild.indexOf('master.rebuildPoll') && rebuild.indexOf('master.rebuildPoll') < rebuild.indexOf('master.rebuildFinish'));
  assert.match(rebuild, /rebuild-cancel/);
  assert.match(rebuild, /okDisabled: \(v\) => v\.step !== 'password'/);
  assert.match(rebuild, /showRecoveryCode\(r\)/);
});

test('the new words exist in both languages', () => {
  const keys = (l) => Object.keys(l).filter((k) => k.startsWith('rebuild.') || k.startsWith('master.forgotAll') || k === 'master.forgotChooseNo');
  assert.ok(keys(es).length >= 20);
  assert.deepEqual(keys(es).sort(), keys(en).sort());
  for (const k of keys(es)) assert.ok(es[k] && en[k], k);
  for (const m of read('src/ui/views/rebuild.jsx').matchAll(/t\('((?:rebuild)\.[\w.]+)'/g)) assert.ok(es[m[1]], m[1]);
});
