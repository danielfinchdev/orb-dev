// 3.8.1 (H4c): the lists the window asks for on every refresh (tasks, conversations, direct conversations, projects, the
// chat list) go as changes instead of whole. No engine imports: the window (src/ui/lib/store.js) loads this file too.
//
// The engine keeps one Feed per list (method + its parameters). Each call computes the list as before and compares each
// row's JSON with the one it last saw: a row that changed (or is new) takes the next version number; a row that left is
// remembered as gone at that version; the order of the keys and the rest of the reply (meta) also carry the version at
// which they last changed. The caller says which version it holds (`since: { epoch, v }`) and gets only what moved after
// it: { feed, epoch, v, base, rows, gone?, order?, meta? }. A caller with nothing (`since: {}`), of another engine run
// (epoch), or too far behind (gone rows forgotten) gets the whole list ({ ..., full: true, rows, meta? }). The versions
// are shared by every caller (the PC's window, phones), so any number of them can follow one Feed.
// A caller that sends no `since` (an Orb or a phone app of before 3.8.1) gets the plain reply, as before.
export const FEED_FORMAT = 1;
const MAX_GONE = 5000;
const randomEpoch = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class Feed {
  constructor({ key = (row) => row.id, maxGone = MAX_GONE } = {}) {
    this.key = key; this.maxGone = maxGone;
    this.epoch = randomEpoch(); this.ver = 0; this.floor = 0;
    this.rows = new Map(); // key → { json, ver }
    this.gone = new Map(); // key → ver (in the order they left)
    this.order = null; this.orderVer = 0; this.meta = undefined; this.metaVer = 0;
    this.keys = []; this.unique = true;
  }

  // The list as it is now: the versions move for what changed since the last look.
  update(rows, meta) {
    const next = this.ver + 1; let changed = false;
    const keys = new Array(rows.length); const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const k = this.key(rows[i]); keys[i] = k; seen.add(k);
      const json = JSON.stringify(rows[i]); const old = this.rows.get(k);
      if (!old || old.json !== json) { this.rows.set(k, { json, ver: next }); this.gone.delete(k); changed = true; }
    }
    this.unique = seen.size === rows.length; // two rows with one key: always sent whole (never seen in practice)
    for (const k of this.rows.keys()) if (!seen.has(k)) { this.rows.delete(k); this.gone.delete(k); this.gone.set(k, next); changed = true; }
    const order = keys.join('\u0001');
    if (order !== this.order) { this.order = order; this.orderVer = next; changed = true; }
    if (meta !== undefined) { const json = JSON.stringify(meta); if (json !== this.meta) { this.meta = json; this.metaVer = next; changed = true; } }
    this.keys = keys;
    if (changed) this.ver = next;
    // The oldest gone rows are forgotten: a caller behind them gets the whole list.
    if (this.gone.size > this.maxGone) {
      for (const [k, v] of this.gone) { if (this.gone.size <= this.maxGone) break; this.gone.delete(k); this.floor = Math.max(this.floor, v); }
    }
  }

  // What a caller that holds `since` gets now (update first).
  reply(rows, since, meta) {
    this.update(rows, meta);
    const head = { feed: FEED_FORMAT, epoch: this.epoch, v: this.ver };
    const base = Number(since?.v);
    const ok = this.unique && since?.epoch === this.epoch && Number.isInteger(base) && base >= this.floor && base <= this.ver;
    if (!ok) return { ...head, full: true, rows, ...(meta !== undefined ? { meta } : {}) };
    const out = { ...head, base, rows: rows.filter((r, i) => this.rows.get(this.keys[i]).ver > base) };
    const gone = []; for (const [k, v] of this.gone) if (v > base) gone.push(k);
    if (gone.length) out.gone = gone;
    if (this.orderVer > base) out.order = this.keys;
    if (meta !== undefined && this.metaVer > base) out.meta = meta;
    return out;
  }
}

// ---- the caller's side
// state: what the caller holds ({ epoch, v, byKey, list, meta }) or null. → { state, list, meta, changed }: list keeps
// the same array (and each unchanged row the same object) when nothing moved, so the screens draw nothing again.
// A plain reply (an engine of before 3.8.1) is taken whole: { state: null, list (or the reply itself as `plain`) }.
// A reply that does not follow from what the caller holds (an answer to an older request that arrived late) changes
// nothing; one that cannot be applied (a key in the order that the caller never got) asks for the whole list again
// (state null, `again`).
export const sinceOf = (state) => (state ? { epoch: state.epoch, v: state.v } : {});
export function applyFeed(state, res, key = (row) => row.id) {
  if (Array.isArray(res)) return { state: null, list: res, meta: undefined, changed: true };
  if (!res || typeof res !== 'object' || res.feed !== FEED_FORMAT) return { state: null, list: null, plain: res, changed: true };
  if (res.full) {
    if (state && state.epoch === res.epoch && res.v < state.v) return keep(state);
    const byKey = new Map(); for (const r of res.rows) byKey.set(key(r), r);
    return { state: { epoch: res.epoch, v: res.v, byKey, list: res.rows, meta: res.meta }, list: res.rows, meta: res.meta, changed: true };
  }
  if (!state || state.epoch !== res.epoch || res.base !== state.v) return keep(state);
  const moved = res.rows.length || res.gone?.length || res.order;
  if (!moved && res.meta === undefined) return { state: { ...state, v: res.v }, list: state.list, meta: state.meta, changed: false };
  let { byKey, list } = state;
  if (moved) {
    byKey = new Map(byKey);
    for (const k of res.gone ?? []) byKey.delete(k);
    for (const r of res.rows) byKey.set(key(r), r);
    if (res.order) {
      list = new Array(res.order.length);
      for (let i = 0; i < res.order.length; i++) { const r = byKey.get(res.order[i]); if (r === undefined) return { state: null, list: state.list, meta: state.meta, changed: false, again: true }; list[i] = r; }
      if (byKey.size !== list.length) { const listed = new Set(res.order); for (const k of [...byKey.keys()]) if (!listed.has(k)) byKey.delete(k); }
    } else {
      list = state.list.map((r) => byKey.get(key(r)));
      if (list.some((r) => r === undefined)) return { state: null, list: state.list, meta: state.meta, changed: false, again: true };
    }
  }
  const meta = res.meta !== undefined ? res.meta : state.meta;
  return { state: { epoch: res.epoch, v: res.v, byKey, list, meta }, list, meta, changed: true };
}
const keep = (state) => ({ state, list: state?.list ?? null, meta: state?.meta, changed: false });
