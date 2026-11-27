// 3.8.10, step 7 A2, the window's side: polling for the phone's answer and keeping its one-use token out of the window's held unlock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { waitApproval, mobileReady } from '../src/ui/lib/approve.js';
import { unlockCore, setMasterAsker, heldUnlock, dropUnlock } from '../src/ui/lib/core-access.js';
import es from '../src/shared/locales/es/master.mjs';
import en from '../src/shared/locales/en/master.mjs';

test('waitApproval polls until the phone answers, gives up on time, and stops when the caller leaves', async () => {
  const answers = [{ state: 'waiting' }, { state: 'waiting' }, { state: 'done', unlock: 'tok' }];
  const seen = [];
  const call = async (m, p) => { seen.push([m, p.id]); return answers.shift(); };
  assert.deepEqual(await waitApproval(call, 'r1', { sleep: async () => {} }), { state: 'done', unlock: 'tok' });
  assert.deepEqual(seen, [['approve.poll', 'r1'], ['approve.poll', 'r1'], ['approve.poll', 'r1']]);
  let t = 0;
  const forever = async () => ({ state: 'waiting' });
  assert.deepEqual(await waitApproval(forever, 'r2', { limit: 100, now: () => t, sleep: async () => { t += 60; } }), { state: 'expired' });
  let left = false;
  assert.deepEqual(await waitApproval(forever, 'r3', { sleep: async () => { left = true; }, cancelled: () => left }), { state: 'cancelled' });
  assert.deepEqual(await waitApproval(async () => ({ state: 'refused' }), 'r4'), { state: 'refused' });
});

test('the dialog offers the phone only for a named call and when some phone may approve', async () => {
  const yes = async () => ({ phones: [{ id: 'a', registered: false }, { id: 'b', registered: true }] });
  const no = async () => ({ phones: [{ id: 'a', registered: false }] });
  assert.equal(await mobileReady(yes, { method: 'secrets.connector', params: {} }), true);
  assert.equal(await mobileReady(yes, null), false, 'no call named, no approval');
  assert.equal(await mobileReady(no, { method: 'secrets.connector', params: {} }), false);
  assert.equal(await mobileReady(async () => { throw new Error('x'); }, { method: 'x' }), false);
});

test('a phone\'s approval is one call\'s token: it is never held for the next one', async () => {
  const asked = [];
  setMasterAsker(async (action, opts) => { asked.push(opts.request); return { unlock: 'movil', until: Date.now() + 120_000, strength: 'mobile' }; });
  const request = { method: 'secrets.connector', params: { name: 'github' } };
  assert.equal(await unlockCore('secrets', { request }), 'movil');
  assert.deepEqual(asked, [request], 'the dialog is told which call it is for');
  assert.equal(heldUnlock(), null, 'not kept');
  setMasterAsker(async () => ({ unlock: 'clave', until: Date.now() + 300_000 }));
  assert.equal(await unlockCore('secrets'), 'clave');
  assert.equal(heldUnlock(), 'clave', 'a password\'s is');
  dropUnlock();
});

test('the words exist in both languages and the settings menu and the dialog use them', () => {
  for (const k of Object.keys(es).filter((x) => x.startsWith('approve.') || x.startsWith('msg.approve.'))) assert.ok(en[k], `en ${k}`);
  for (const k of Object.keys(en).filter((x) => x.startsWith('approve.') || x.startsWith('msg.approve.'))) assert.ok(es[k], `es ${k}`);
  const link = fs.readFileSync(path.join(ROOT, 'src/ui/views/magic-link.jsx'), 'utf8');
  assert.match(link, /approve\.allow/);
  assert.match(link, /approve\.unregister/);
  assert.match(fs.readFileSync(path.join(ROOT, 'src/ui/views/master.jsx'), 'utf8'), /<MobileBox request=\{request\}/);
});
