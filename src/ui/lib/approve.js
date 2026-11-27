// A phone's fingerprint as the window uses it, with no JSX (the tests load this in Node). The engine's approve.request / approve.register
// answer { id, device, delivered, until }; approve.poll says { state: 'waiting' | 'done' | 'refused' | 'expired' | 'gone', unlock?, until? }.

import { helloUsable } from './hello.js';

// A little longer than the two minutes a challenge lives, so the engine's own «expired» is what ends it.
export const WAIT_MS = 125_000;

// Polls until the phone answered, the time ran out, or the caller gave up. → the last poll's answer ({ state }).
export async function waitApproval(call, id, { method = 'approve.poll', every = 1000, limit = WAIT_MS, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), cancelled = () => false } = {}) {
  const end = now() + limit;
  for (;;) {
    if (cancelled()) return { state: 'cancelled' };
    const r = await call(method, { id });
    if (r?.state !== 'waiting') return r ?? { state: 'gone' };
    if (now() >= end) return { state: 'expired' };
    await sleep(every);
  }
}

// Whether the dialog of a protected action may offer «Aprobar con el móvil»: a call to approve is named and some phone may approve it.
export async function mobileReady(call, request) {
  if (!request?.method) return false;
  try { return (await call('approve.devices')).phones.some((p) => p.registered === true); } catch { return false; }
}

// «Lo he olvidado todo» needs a phone that may approve and Windows Hello working: → { ok, reason?, phone?, phoneId? }.
// reason: 'noPhone' | 'noHello'. Without either, the only way left is starting from scratch.
export async function rebuildReadiness(call) {
  let phones = [];
  try { phones = ((await call('approve.devices'))?.phones ?? []).filter((p) => p.registered === true); } catch { /* none */ }
  if (!phones.length) return { ok: false, reason: 'noPhone' };
  let hello = null;
  try { hello = await call('master.helloState'); } catch { /* none */ }
  if (!helloUsable(hello)) return { ok: false, reason: 'noHello', phone: phones[0].name };
  return { ok: true, phone: phones[0].name, phoneId: phones[0].id };
}

// m:ss left until `until` (ms), for the countdown of a wait; '0:00' once it is over.
export function countdown(until, now = Date.now()) {
  const s = Math.max(0, Math.ceil((Number(until) - now) / 1000)) || 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
