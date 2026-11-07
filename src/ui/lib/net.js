// 3.8: the phone's requests to the PC never wait for the system's own network timeout (minutes on Android when an
// address of the PC no longer answers): each one has its own limit, and a request that could not reach the PC is told
// apart from one the PC refused (pure: test/movil-ui.test.mjs).

// How long each kind of request may take before the next address is tried (ms).
// A call may do real work on the PC (git, GitHub), so it gets more room than the quick checks.
export const TIMEOUTS = { call: 45_000, me: 8_000, hello: 6_000, pair: 20_000, upload: 60_000, events: 10_000 };

// fetch with a time limit, also honouring the caller's own signal. A request that could not connect or ran out of time
// fails as offline (timeout: true for the second: the PC may have got it, so a request that changes something is not
// sent again elsewhere).
export async function timedFetch(url, init = {}, ms = TIMEOUTS.call, get = globalThis.fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms);
  const outer = init.signal;
  const stop = () => ctrl.abort(outer.reason);
  if (outer) { if (outer.aborted) stop(); else outer.addEventListener('abort', stop, { once: true }); }
  // Once the answer's headers are in, the time limit is over; the caller's signal still stops a stream it reads.
  try { return await get(url, { ...init, signal: ctrl.signal }); }
  catch (e) { outer?.removeEventListener?.('abort', stop); throw outer?.aborted ? e : offlineError(e, ctrl.signal.aborted); }
  finally { clearTimeout(timer); }
}

// A fetch bound to one time limit (what src/core/mobile-crypto.mjs › linkDevice takes as its fetch).
export const fetchWithin = (ms, get = globalThis.fetch) => (url, init) => timedFetch(url, init, ms, get);

// The PC could not be reached (network down, PC off, Orb closed, too slow): not an answer of the PC.
export const offlineError = (cause, timeout = false) => Object.assign(new Error('offline'), { offline: true, timeout, cause });
export const isOffline = (e) => Boolean(e?.offline);

// The pause before trying again while the PC cannot be reached: 3 s, 6 s, 12 s… up to 30 s.
export const retryDelay = (attempt) => Math.min(30_000, 3_000 * 2 ** Math.max(0, attempt));
