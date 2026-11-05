// 3.7 (WS5): the agents' browser goes at a human pace and warns before mass actions (src/mcp/server.mjs uses both before
// each action). Pure logic over a small store, so every MCP process of the same Orb shares the counts (the store is the
// database's settings) and the tests run them with a clock of their own.
//
// Pace (per site, orb.json browser.sites): a token bucket of `perHour` actions an hour (default 300) with a burst of
// `burst` (default 30), and between two actions on the same site a pause of minMs…maxMs (default 2–5 s, random). A site's
// own entry wins over «default»; a host matches its entry and its subdomains.
//
// Mass actions: a destructive click (delete, remove, unfollow…) repeated on the same site with the same button: after
// `limit` of them (default 50) in `windowMs` (default an hour) the next one waits for the person's OK on a card that
// warns about the site's terms.
export const PACE = Object.freeze({ minMs: 2000, maxMs: 5000, perHour: 300, burst: 30 });
export const MASS = Object.freeze({ limit: 50, windowMs: 60 * 60_000, okMs: 60 * 60_000 });
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/i;

export const hostOf = (url) => { try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
// A page of this machine or of the home network (an agent testing its own web): no pace.
export const isLocalHost = (host) => !host || LOCAL.test(host);

// The settings of one site: its own entry (or a parent domain's), over «default», over PACE.
export function siteRules(sites, host) {
  const all = sites && typeof sites === 'object' ? sites : {};
  let own = null;
  for (let h = host; h; h = h.includes('.') ? h.slice(h.indexOf('.') + 1) : '') { if (Object.hasOwn(all, h) && h !== 'default') { own = all[h]; break; } }
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const base = { ...PACE, ...(all.default ?? {}), ...(own ?? {}) };
  const minMs = num(base.minMs, 0, 60_000, PACE.minMs);
  return { minMs, maxMs: Math.max(minMs, num(base.maxMs, 0, 120_000, PACE.maxMs)), perHour: num(base.perHour, 1, 10_000, PACE.perHour), burst: num(base.burst, 1, 1000, PACE.burst) };
}

// store: { get(key) → object | null, set(key, value), tx(fn) } (tx: read-modify-write at once; the database's
// transaction, or nothing in memory). now(): the clock; random(): 0…1.
export function createPace({ store, sites = () => ({}), now = Date.now, random = Math.random }) {
  // → { wait: ms to sleep before the action } | { refuse: true, retryMs } (the hour's actions on that site are spent)
  function take(host) {
    if (isLocalHost(host)) return { wait: 0 };
    const r = siteRules(sites(), host);
    return store.tx(() => {
      const key = `browser_pace:${host}`;
      const t = now();
      const s = store.get(key) ?? { tokens: r.burst, at: t, next: 0 };
      const rate = r.perHour / 3_600_000; // tokens per ms
      // The pause since the previous action on this site (it may have been another bot's), then a token at that moment.
      const start = Math.max(t, Number(s.next ?? 0));
      const tokens = Math.min(r.burst, Number(s.tokens ?? r.burst) + Math.max(0, start - Number(s.at ?? start)) * rate);
      const gap = r.minMs + Math.round(random() * (r.maxMs - r.minMs));
      if (tokens < 1) {
        // No token yet: a short wait for the next one is part of the pause; a long one, refused (nothing is spent).
        const at = start + Math.ceil((1 - tokens) / rate);
        if (at - t > 20_000) return { refuse: true, retryMs: at - t };
        store.set(key, { tokens: 0, at, next: at + gap });
        return { wait: at - t };
      }
      store.set(key, { tokens: tokens - 1, at: start, next: start + gap });
      return { wait: start - t };
    });
  }
  return { take };
}

// What a destructive button says (es / en); the rest of the label is how two clicks are «the same».
export const DESTRUCTIVE = /(eliminar|borrar|suprimir|quitar|dejar de seguir|archivar|bloquear|vaciar|descartar|delete|remove|erase|unfollow|unsubscribe|archive|block|discard|trash|clear)/i;
const labelText = (line) => String(line ?? '').replace(/^\[\d+\]\s*/, '').replace(/^[\w:-]+\s*/, '').replace(/->.*$/, '').replace(/\(.*?\)\s*$/, '').replace(/["«»]/g, '').trim();
// The «same» action: the button's words without numbers, dates or counters («Eliminar 3 fotos» = «Eliminar 12 fotos»).
export const actionKind = (line) => labelText(line).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\d.,:/#-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
export const isDestructive = (line) => DESTRUCTIVE.test(labelText(line));

// Mass actions of one bot (or agent) on one site. check() before the click, done() after it ran.
// → { ok: true } | { needsOk: true, count } (raise the card) | { waiting: true } | { denied: true }
// approval: { get(id) → 'pending' | 'waiting' | 'done' | 'denied' | null } (the card's request), set by the caller.
export function createMassGuard({ store, who, limit = MASS.limit, windowMs = MASS.windowMs, okMs = MASS.okMs, now = Date.now, approval = { get: () => null } }) {
  const keyOf = (host, kind) => `browser_mass:${who}:${host}:${kind}`;
  function check(host, line) {
    if (!host || !isDestructive(line)) return { ok: true };
    const kind = actionKind(line); const key = keyOf(host, kind); const t = now();
    const s = store.get(key);
    const live = s && t - Number(s.since ?? 0) < windowMs;
    const count = live ? Number(s.count ?? 0) : 0;
    if (count < limit) return { ok: true };
    if (s?.request != null) {
      const st = approval.get(s.request);
      if (st === 'done' && t < Number(s.okUntil ?? (Number(s.decidedAt ?? t) + okMs))) { if (s.okUntil == null) store.set(key, { ...s, okUntil: t + okMs }); return { ok: true }; }
      if (st === 'pending' || st === 'waiting') return { waiting: true, count };
      if (st === 'denied') return { denied: true, count };
    }
    return { needsOk: true, count, kind };
  }
  // The card was raised: its request id, so the next clicks wait for its answer.
  function asked(host, line, request) { const key = keyOf(host, actionKind(line)); const s = store.get(key) ?? { count: limit, since: now() }; store.set(key, { ...s, request, okUntil: null }); }
  function done(host, line) {
    if (!host || !isDestructive(line)) return;
    store.tx(() => {
      const key = keyOf(host, actionKind(line)); const t = now();
      const s = store.get(key);
      const live = s && t - Number(s.since ?? 0) < windowMs;
      store.set(key, live ? { ...s, count: Number(s.count ?? 0) + 1 } : { count: 1, since: t });
    });
  }
  return { check, asked, done };
}

// A store in memory (tests, and an MCP process without a database).
export function memoryStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? structuredClone(m.get(k)) : null), set: (k, v) => { m.set(k, structuredClone(v)); }, tx: (fn) => fn(), map: m };
}
// The database's settings as the store (every MCP process of this Orb sees the same counts).
export function boardStore(board) {
  return {
    get: (k) => { try { return board.settingJson(k) ?? null; } catch { return null; } },
    set: (k, v) => { try { board.settingJson(k, v); } catch { /* never in the way */ } },
    tx: (fn) => { try { return board.transaction(fn); } catch (error) { if (/transaction/i.test(String(error?.message))) return fn(); throw error; } }
  };
}
