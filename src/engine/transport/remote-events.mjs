// A short memory of the live events sent to phones, so a phone that lost its stream picks up where it left off.
// Ids are `<boot>.<n>`: `boot` is random per run of the engine, so an id from before a restart is never mistaken for a
// current one (the phone is then told to reload everything instead).
import crypto from 'node:crypto';

export const JOURNAL_MAX = 500;
export const JOURNAL_MS = 10 * 60_000;

export function createJournal({ max = JOURNAL_MAX, ttlMs = JOURNAL_MS, now = Date.now, boot = crypto.randomBytes(6).toString('hex') } = {}) {
  const items = []; // { n, at, value }
  let counter = 0;
  let floor = 0; // the newest id dropped for age or room: a phone behind it has lost events
  const prune = () => {
    const limit = now() - ttlMs;
    while (items.length && (items.length > max || items[0].at < limit)) floor = items.shift().n;
  };
  const parse = (id) => {
    const m = /^([0-9a-f]{12})\.(\d{1,15})$/.exec(String(id ?? ''));
    return m ? { boot: m[1], n: Number(m[2]) } : null;
  };
  return {
    boot,
    // `key`: only the newest event of a key is worth keeping (a chat's state is sent whole many times a second).
    add(value, key = null) {
      if (key) { const k = items.findIndex((x) => x.key === key); if (k >= 0) items.splice(k, 1); }
      counter += 1; items.push({ n: counter, at: now(), value, key }); prune(); return `${boot}.${counter}`;
    },
    idOf: (n) => `${boot}.${n}`,
    // → { items: [{ id, value }] } when everything after `lastId` is still held, or { resync: true } when it is not
    // (another run, an id from the future, or events already dropped): the phone must reload its whole state.
    since(lastId) {
      const last = parse(lastId);
      if (!last || last.boot !== boot) return { resync: true };
      prune();
      if (last.n > counter || last.n < floor) return { resync: true };
      return { items: items.filter((x) => x.n > last.n).map((x) => ({ id: `${boot}.${x.n}`, value: x.value })) };
    },
  };
}
