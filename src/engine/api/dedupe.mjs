// Remembers, for a few minutes, what a message with a given clientId did, so a client that retries after a lost answer
// does not send it twice. In memory only: after a restart a retry is a new message, which is the old behavior.
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const clientIdOf = (value) => (typeof value === 'string' && CLIENT_ID.test(value) ? value : null);

// A conversation id as one stable text, whatever shape the client sent it in.
export const conversationKey = (x) => (x == null ? 'new' : Number.isFinite(Number(x)) && String(x).trim() !== '' ? String(Number(x)) : String(x));

export function createDedupe({ ttl = 10 * 60_000, max = 500, clock = Date.now } = {}) {
  const seen = new Map(); // key -> { at, result }
  const prune = () => {
    const limit = clock() - ttl;
    for (const [key, v] of seen) { if (v.at < limit || seen.size > max) seen.delete(key); else break; } // oldest first
  };
  return {
    // Runs `run` once per (scope, clientId); a repeat gets the first result. Without a valid clientId it just runs.
    once(scope, clientId, run) {
      const id = clientIdOf(clientId);
      if (!id) return run();
      prune();
      const key = `${scope}\u0000${id}`;
      const hit = seen.get(key);
      if (hit) return hit.result;
      const result = run();
      seen.set(key, { at: clock(), result });
      // A failed first try must stay retryable.
      if (result && typeof result.then === 'function') result.catch(() => { if (seen.get(key)?.result === result) seen.delete(key); });
      return result;
    },
    size: () => seen.size
  };
}
