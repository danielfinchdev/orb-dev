// A phone's fingerprint as the window uses it, with no JSX (the tests load this in Node). The engine's approve.request / approve.register
// answer { id, device, delivered, until }; approve.poll says { state: 'waiting' | 'done' | 'refused' | 'expired' | 'gone', unlock?, until? }.

// A little longer than the two minutes a challenge lives, so the engine's own «expired» is what ends it.
export const WAIT_MS = 125_000;

// Polls until the phone answered, the time ran out, or the caller gave up. → the last poll's answer ({ state }).
export async function waitApproval(call, id, { every = 1000, limit = WAIT_MS, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), cancelled = () => false } = {}) {
  const end = now() + limit;
  for (;;) {
    if (cancelled()) return { state: 'cancelled' };
    const r = await call('approve.poll', { id });
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
