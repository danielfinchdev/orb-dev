// A project's git and GitHub state (projects.info). A project's page reads the full state (git and gh) and keeps it for a
// minute. The list reads only the local git state (projects.info with local: true: no gh, no network), one project at a
// time, only for the rows on screen, and keeps it for ten minutes; the rows paint first and the facts fill in later.
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './store.js';

const TTL = 60_000;
const LANES = 2;
const cache = new Map(); // name -> { at, info } | { pending: Promise }
const queue = [];
let running = 0;

function pump() {
  while (running < LANES && queue.length) {
    const job = queue.shift();
    running += 1;
    job().finally(() => { running -= 1; pump(); });
  }
}

export function readInfo(name, force = false) {
  const hit = cache.get(name);
  if (hit?.pending) return hit.pending;
  if (!force && hit?.info && Date.now() - hit.at < TTL) return Promise.resolve(hit.info);
  const pending = new Promise((resolve) => {
    queue.push(() => call('projects.info', { name })
      .catch((e) => ({ git: false, error: e.message }))
      .then((info) => { cache.set(name, { at: Date.now(), info }); resolve(info); }));
    pump();
  });
  cache.set(name, { ...hit, pending });
  return pending;
}

export const forgetInfo = (name) => { cache.delete(name); rowCache.delete(name); };

export const forgetRowInfos = () => rowCache.clear();
export const ROW_TTL = 10 * 60_000;
// The most the interface waits for one row: past it the row says «no git data» and is not asked again by itself.
export const ROW_TIMEOUT = 8000;
const rowCache = new Map(); // name -> { at, path, info }
const rowQueue = []; // { name, path, force, waiters: Set<fn> }, read one at a time
let rowBusy = false;
let rowRunning = null; // the job being read now: a row that leaves and comes back must join it, not queue another read
// The interface gives up on a row at ROW_TIMEOUT but the engine keeps reading; the next read waits for the engine to
// answer, or this long, so late reads do not pile up as parallel gits.
export const ROW_ENGINE_GRACE = 30_000;

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const id = setTimeout(() => reject(new Error('timeout')), ms);
  promise.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
});

function pumpRows() {
  if (rowBusy) return;
  const job = rowQueue.shift();
  if (!job) return;
  rowBusy = true;
  rowRunning = job;
  const engine = call('projects.info', { name: job.name, local: true });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(grace);
    rowBusy = false;
    pumpRows();
  };
  const grace = setTimeout(release, ROW_ENGINE_GRACE);
  engine.then(release, release);
  // the folder is read through the engine's local-only option; a failure or a timeout is an answer too, kept like any other
  withTimeout(engine, ROW_TIMEOUT)
    .catch(() => ({ git: false, unavailable: true }))
    .then((info) => {
      if (rowRunning === job) rowRunning = null;
      // nobody waits any more (the view was left): the late answer is dropped
      if (job.waiters.size) { rowCache.set(job.name, { at: Date.now(), path: job.path, info }); for (const w of job.waiters) w(info); }
    });
}

// The list's read of one project; returns a function that cancels it. A fresh answer in memory is given without asking.
export function requestRowInfo(name, path, onInfo) {
  const hit = rowCache.get(name);
  if (hit && hit.path === path && Date.now() - hit.at < ROW_TTL) { onInfo(hit.info); return () => {}; }
  let job = rowQueue.find((j) => j.name === name && j.path === path);
  if (!job && rowRunning?.name === name && rowRunning.path === path) job = rowRunning;
  if (!job) { job = { name, path, waiters: new Set() }; rowQueue.push(job); }
  job.waiters.add(onInfo);
  pumpRows();
  return () => {
    job.waiters.delete(onInfo);
    const at = rowQueue.indexOf(job);
    if (!job.waiters.size && at >= 0) rowQueue.splice(at, 1);
  };
}

// A row's git state: `ref` goes on the row; the read starts only once the row is on screen and is cancelled when it
// leaves the view. `stamp` changes after forgetRowInfos() (the list's «refresh») to read the rows on screen again.
export function useRowInfo(name, path, stamp = 0) {
  const ref = useRef(null);
  const [info, setInfo] = useState(() => { const hit = rowCache.get(name); return hit && hit.path === path ? hit.info : null; });
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return undefined;
    return requestRowInfo(name, path, setInfo);
  }, [name, path, visible, stamp]);
  return [ref, info];
}

// One project: its info and a way to read it again (after a commit, a push…).
export function useProjectInfo(name) {
  const [info, setInfo] = useState(() => cache.get(name)?.info ?? null);
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    let alive = true;
    if (stamp > 0) setInfo(null);
    readInfo(name, stamp > 0).then((r) => { if (alive) setInfo(r); });
    return () => { alive = false; };
  }, [name, stamp]);
  return [info, useCallback(() => setStamp((n) => n + 1), [])];
}
