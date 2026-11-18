// Pure helpers of a conversation's turns: where each finished turn's «Cambió N archivos» card goes, which runs of tool
// calls fold under «Trabajó 4 min 20 s», and how that time reads. Blocks are the ones session-blocks.js › toBlocks makes.
const TOOLISH = new Set(['tool', 'toolgroup', 'subagent']);
const stamp = (v) => { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
const atOf = (b) => (b?.type === 'item' ? stamp(b.item?.at) : null);
// a photo is taken right after the turn's last line is saved: a little slack covers clock and write order
const SLACK_MS = 2000;

const startsTurn = (b) => b?.type === 'item' && b.item.role === 'user' && b.item.kind === 'text' && Number.isInteger(b.item.id) && !b.item.body?.steer;

// → Map<key of the block the card goes after, { n, user }>. turns: [{ n, at }] as sessions.turns returns them; user: the
// message that started that turn (the one «Volver atrás…» goes back to), or null.
export function placeTurns(blocks, turns) {
  const out = new Map();
  if (!blocks?.length || !turns?.length) return out;
  let floor = -1; let prev = 0;
  for (const turn of [...turns].sort((a, b) => a.n - b.n)) {
    const gap = turn.n !== prev + 1; prev = turn.n;
    const limit = turn.at + SLACK_MS;
    // a card is anchored on the first user message after the previous card (lines a rewind left in between belong to no turn)
    let i = -1;
    for (let k = floor + 1; k < blocks.length; k++) if (startsTurn(blocks[k])) { i = k; break; }
    if (i < 0 || (atOf(blocks[i]) ?? 0) > limit) continue;
    // it ends the turn at the last line before the next message; with no photo before this turn (a gap in the numbers) the card
    // covers every message up to its own photo, and then it names none of them
    for (let k = i + 1; k < blocks.length; k++) {
      const at = atOf(blocks[k]);
      if (startsTurn(blocks[k]) && (!gap || at == null || at > limit)) break;
      if (at != null && at > limit) break;
      i = k;
    }
    const first = blocks.findIndex((b, k) => k > floor && startsTurn(b));
    out.set(blocks[i].key, { n: turn.n, user: gap ? null : blocks[first].item, gap });
    floor = i;
  }
  return out;
}

// What the turn cards read from the engine, kept for the whole run so the cards and the Changes panel share it and a long chat
// does not pile requests on the PC. Both stores take the engine call as a parameter, so nothing here knows the window.
// turns: one sessions.turns per finished turn (a chat that goes back to rest), repeated asks folded into one request.
export function createTurnsStore(fetchTurns) {
  const entries = new Map(); const listeners = new Map();
  const entry = (id) => { let e = entries.get(id); if (!e) { e = { value: null, stamp: null, round: 0, running: false, inflight: null }; entries.set(id, e); } return e; };
  const emit = (id) => { for (const fn of listeners.get(id) ?? []) fn(); };
  const store = {
    get: (id) => entries.get(id)?.value ?? null,
    subscribe(id, fn) { const set = listeners.get(id) ?? new Set(); set.add(fn); listeners.set(id, set); return () => set.delete(fn); },
    // a new run starts a new round: the photos of its turn are read once, when the chat is back at rest
    setRunning(id, running) { const e = entry(id); if (running && !e.running) e.round++; e.running = running; },
    load(id) {
      const e = entry(id);
      // while it works any list already read will do; at rest it has to be read after the last run
      const fits = (stamp) => e.running || stamp === e.round;
      if (e.value && fits(e.stamp)) return Promise.resolve(e.value);
      if (e.inflight) return fits(e.inflight.stamp) ? e.inflight.promise : e.inflight.promise.then(() => store.load(id));
      const stamp = e.running ? -1 : e.round;
      const promise = Promise.resolve().then(() => fetchTurns(id)).then(
        (r) => ({ value: r?.available ? { available: true, turns: r.turns ?? [] } : { available: false, turns: [] }, stamp }),
        () => ({ value: { available: false, turns: [] }, stamp: -2 }), // read again the next time it is asked for
      ).then((r) => { e.value = r.value; e.stamp = r.stamp; e.inflight = null; emit(id); return e.value; });
      e.inflight = { promise, stamp };
      return promise;
    },
  };
  return store;
}

// «Revisar» numbers of each card: one sessions.turnDiff at a time, a short pause before each, only for cards still on screen.
// A finished turn does not change, so a result stays; a failure is not kept, so the card can ask again.
export function createDiffQueue(fetchDiff, { delay = 150, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const done = new Map(); const pending = new Map(); const queue = []; let busy = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        await wait(delay);
        if (!job.wanted.some((f) => f())) { pending.delete(job.key); job.reject(Object.assign(new Error('skipped'), { skipped: true })); continue; }
        try { const r = await fetchDiff(job.params); done.set(job.key, r); pending.delete(job.key); job.resolve(r); } catch (e) { pending.delete(job.key); job.reject(e); }
      }
    } finally { busy = false; }
  };
  return {
    peek: (key) => done.get(key) ?? null,
    // wanted(): false when the card left the screen or went away before its turn in the queue
    request(key, params, wanted = () => true) {
      if (done.has(key)) return Promise.resolve(done.get(key));
      const waiting = pending.get(key);
      if (waiting) { waiting.job.wanted.push(wanted); return waiting.promise; }
      const job = { key, params, wanted: [wanted] };
      const promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      pending.set(key, { job, promise });
      queue.push(job);
      pump();
      return promise;
    },
  };
}

// → [{ blocks: [one block] } | { worked: true, key, blocks: [...], ms }]: every run of tool calls (and the reasoning between
// them) becomes one «Trabajó…» entry; ms: from the line before the run to the line after it, null when either is missing.
export function groupWorked(blocks) {
  const out = []; let run = [];
  const flush = (next) => {
    if (!run.length) return;
    if (run.some((b) => TOOLISH.has(b.type))) {
      const before = out.length ? atOf(out[out.length - 1].blocks.at(-1)) : null;
      const after = atOf(next);
      out.push({ worked: true, key: `worked-${run[0].key}`, blocks: run, ms: before != null && after != null && after >= before ? after - before : null });
    } else for (const b of run) out.push({ blocks: [b] });
    run = [];
  };
  for (const b of blocks) {
    if (TOOLISH.has(b.type) || (b.type === 'item' && b.item.kind === 'reasoning')) run.push(b);
    else { flush(b); out.push({ blocks: [b] }); }
  }
  flush(null);
  return out;
}

// 4 min 20 s · 35 s · 1 h 5 min (null when there is no time to tell)
export function formatSpan(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}
