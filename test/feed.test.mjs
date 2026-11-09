// 3.8.1 (H4c): the lists of every refresh as changes (src/shared/feed.mjs, src/engine/feeds.mjs). Parity: whatever the
// order of changes and however far behind a caller is, applying the feed replies gives exactly the whole list (and a row
// that did not change keeps its object); older callers (no `since`) and older engines (plain replies) keep working; the
// phone's path stripping gives the same rows either way.
import { tempHome, startEngine } from './helpers.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Feed, applyFeed, sinceOf, FEED_FORMAT } from '../src/shared/feed.mjs';
import { createFeeds, compactTask } from '../src/engine/feeds.mjs';
import { shapeResult } from '../src/engine/remote.mjs';

// A small random generator with a seed (the same run every time).
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const json = (x) => JSON.stringify(x);

test('feed: callers that look at random moments always end with the whole list, in its order', () => {
  const rand = rng(7);
  const feed = new Feed();
  let rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `t${i + 1}`, status: 'queued' }));
  let next = 31; let meta = { unread: 0 };
  const clients = Array.from({ length: 4 }, () => ({ state: null, list: null, meta: undefined }));
  for (let step = 0; step < 600; step++) {
    // the list changes: a row changes, one comes, one goes, the order moves, the meta moves
    const r = rand();
    if (r < 0.35 && rows.length) { const i = Math.floor(rand() * rows.length); rows = rows.map((x, j) => (j === i ? { ...x, status: ['running', 'done', 'failed'][Math.floor(rand() * 3)], n: step } : x)); }
    else if (r < 0.5) rows = [{ id: next++, title: `t${next}`, status: 'queued' }, ...rows];
    else if (r < 0.62 && rows.length > 5) rows = rows.filter((_, j) => j !== Math.floor(rand() * rows.length));
    else if (r < 0.7) rows = [...rows].sort(() => rand() - 0.5);
    else if (r < 0.75) meta = { unread: step };
    else if (r < 0.78 && rows.length) { const back = rows.pop(); rows = [back, ...rows]; } // back on top, the same content
    // a random caller looks (some look often, some rarely)
    for (const [ci, c] of clients.entries()) {
      if (rand() > [0.9, 0.4, 0.1, 0.02][ci]) continue;
      const before = c.list;
      const res = JSON.parse(json(feed.reply(rows, sinceOf(c.state), meta))); // as it travels
      const out = applyFeed(c.state, res);
      assert.equal(out.again, undefined);
      c.state = out.state; c.list = out.list; c.meta = out.meta;
      assert.equal(json(c.list), json(rows), `cliente ${ci}, paso ${step}`);
      assert.equal(json(c.meta), json(meta));
      if (before && !out.changed) assert.equal(c.list, before, 'nada cambió: la misma lista');
      if (before) { // a row that did not change keeps its object (the screens do not draw it again)
        const old = new Map(before.map((x) => [x.id, x]));
        for (const x of c.list) if (old.has(x.id) && json(old.get(x.id)) === json(x) && !res.full && !res.rows.some((y) => y.id === x.id)) assert.equal(x, old.get(x.id));
      }
    }
  }
});

test('feed: what travels when nothing moved, one row moved and a caller is new', () => {
  const feed = new Feed();
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, title: `Tarea ${i}`, status: 'done', text: 'x'.repeat(400) }));
  const first = feed.reply(rows, {});
  assert.equal(first.full, true); assert.equal(first.rows.length, 500); assert.equal(first.feed, FEED_FORMAT);
  const same = feed.reply(rows.map((x) => ({ ...x })), { epoch: first.epoch, v: first.v });
  assert.deepEqual(same, { feed: FEED_FORMAT, epoch: first.epoch, v: first.v, base: first.v, rows: [] });
  assert.ok(json(same).length < 100);
  const moved = rows.map((x) => (x.id === 7 ? { ...x, status: 'running' } : x));
  const one = feed.reply(moved, { epoch: first.epoch, v: first.v });
  assert.equal(one.rows.length, 1); assert.equal(one.rows[0].id, 7); assert.equal(one.order, undefined); assert.equal(one.gone, undefined);
  assert.ok(json(one).length < 600);
});

test('feed: another engine run, a caller too far behind or a late answer', () => {
  const feed = new Feed({ maxGone: 3 });
  let rows = [1, 2, 3, 4, 5].map((id) => ({ id }));
  const a = applyFeed(null, feed.reply(rows, {}));
  // another engine (its epoch): the whole list
  assert.equal(new Feed().reply(rows, sinceOf(a.state)).full, true);
  // many rows gone since: their marks forgotten, the whole list
  const old = a.state;
  for (let i = 6; i < 12; i++) { rows = [{ id: i }]; feed.reply(rows, {}); }
  const far = feed.reply(rows, sinceOf(old));
  assert.equal(far.full, true); assert.equal(json(applyFeed(old, far).list), json(rows));
  // a late answer to an older request changes nothing
  const b = applyFeed(null, feed.reply(rows, {}));
  rows = [{ id: 20 }, ...rows];
  const r1 = feed.reply(rows, sinceOf(b.state)); const r2 = feed.reply([{ id: 21 }, ...rows], sinceOf(b.state));
  const after2 = applyFeed(b.state, r2);
  const late = applyFeed(after2.state, r1);
  assert.equal(late.changed, false); assert.equal(late.list, after2.list);
  // an older whole list, late too
  const fullOld = feed.reply(rows, {}); const newer = applyFeed(after2.state, feed.reply([{ id: 22 }], sinceOf(after2.state)));
  if (fullOld.v < newer.state.v) assert.equal(applyFeed(newer.state, fullOld).changed, false);
  // a reply that cannot be applied (a key in the order never received): ask again for the whole list
  const broken = applyFeed(newer.state, { feed: FEED_FORMAT, epoch: newer.state.epoch, v: newer.state.v + 1, base: newer.state.v, rows: [], order: [999] });
  assert.equal(broken.again, true); assert.equal(broken.state, null);
});

test('feed: two rows with one key are always sent whole; plain replies of an older engine are taken as they come', () => {
  const feed = new Feed();
  const rows = [{ id: 1, a: 1 }, { id: 1, a: 2 }];
  const a = feed.reply(rows, {});
  assert.equal(feed.reply(rows, { epoch: a.epoch, v: a.v }).full, true);
  const arr = applyFeed(null, [{ id: 1 }]);
  assert.deepEqual(arr.list, [{ id: 1 }]); assert.equal(arr.state, null);
  const obj = applyFeed(null, { zone: 'orb', items: [] });
  assert.deepEqual(obj.plain, { zone: 'orb', items: [] });
});

test('feeds: one per method and parameters, the meta of the chat list, compact tasks', () => {
  const feeds = createFeeds();
  const inbox = { zone: 'orb', items: [{ key: 'conversation:1', title: 'a' }], sections: [], unread: 0, projects: [] };
  const r = feeds.reply('inbox.list', { zone: 'orb', since: {} }, inbox);
  assert.equal(r.full, true); assert.deepEqual(r.meta, { zone: 'orb', sections: [], unread: 0, projects: [] });
  const r2 = feeds.reply('inbox.list', { zone: 'orb', since: { epoch: r.epoch, v: r.v } }, { ...inbox, unread: 2 });
  assert.deepEqual(r2.rows, []); assert.equal(r2.meta.unread, 2);
  // another limit: another feed
  const t1 = feeds.reply('tasks.list', { limit: 200, since: {} }, [{ id: 1, title: 'x', description: 'larga', result: 'r', project_path: 'C:\\a' }]);
  assert.deepEqual(t1.rows, [{ id: 1, title: 'x' }]);
  const t2 = feeds.reply('tasks.list', { limit: 50, since: { epoch: t1.epoch, v: t1.v } }, [{ id: 1, title: 'x' }]);
  assert.notEqual(t2.epoch, t1.epoch); assert.equal(t2.full, true);
  // a method that is not a list: as it was
  assert.deepEqual(feeds.reply('app.state', { since: {} }, { a: 1 }), { a: 1 });
});

test('feeds: only the parameters that change the list count, normalised; linked devices never push out the PC\'s feeds', () => {
  const feeds = createFeeds({ max: 24, maxRemote: 2 });
  const rows = [{ id: 1, title: 'x' }];
  const pc = { channel: 'desktop' }; const phone = { channel: 'phone', device: 'a' };
  const t1 = feeds.reply('tasks.list', { limit: 200, since: {} }, rows, pc);
  // the same limit spelled otherwise, and stray parameters: the same feed
  for (const params of [{ limit: '200' }, { limit: 200, x: 1 }, { limit: 200, junk: 'y'.repeat(1000) }]) {
    const r = feeds.reply('tasks.list', { ...params, since: { epoch: t1.epoch, v: t1.v } }, rows, pc);
    assert.equal(r.epoch, t1.epoch); assert.equal(r.full, undefined);
  }
  const capped = feeds.reply('tasks.list', { limit: 500, since: {} }, rows, pc);
  assert.equal(feeds.reply('tasks.list', { limit: 9999, since: { epoch: capped.epoch, v: capped.v } }, rows, pc).epoch, capped.epoch, 'the limit as tasks.list caps it');
  const arch = feeds.reply('sessions.list', { archived: true, since: {} }, rows, pc);
  assert.equal(feeds.reply('sessions.list', { archived: 1, since: { epoch: arch.epoch, v: arch.v } }, rows, pc).epoch, arch.epoch);
  // a phone asking for anything, many times: its own small cache; the PC still gets changes
  for (let i = 0; i < 50; i++) feeds.reply('tasks.list', { limit: i, x: i, since: {} }, rows, phone);
  assert.ok(feeds.size().remote <= 2);
  const again = feeds.reply('tasks.list', { limit: 200, since: { epoch: t1.epoch, v: t1.v } }, rows, pc);
  assert.equal(again.epoch, t1.epoch); assert.equal(again.full, undefined);
});

test('feeds: per kind of caller (a list that one day depends on the caller must not share its feed)', () => {
  const feeds = createFeeds();
  const rows = [{ id: 1 }];
  const pc = feeds.reply('conversations.list', { since: {} }, rows, { channel: 'desktop' });
  const phone = feeds.reply('conversations.list', { since: {} }, rows, { channel: 'phone', device: 'a' });
  assert.notEqual(pc.epoch, phone.epoch, 'the PC and a phone hold different feeds');
  // a phone that presents the PC's feed version gets the whole list: never `gone`/`order` worked out for another caller
  const cross = feeds.reply('conversations.list', { since: { epoch: pc.epoch, v: pc.v } }, rows, { channel: 'phone', device: 'a' });
  assert.equal(cross.full, true);
});

let t; let engine;
afterEach(async () => { await engine?.stop(); engine = null; t?.cleanup(); });

test('feeds del motor: aplicar los cambios da la lista entera (también la del móvil, sin rutas) y sin since la respuesta de siempre', async () => {
  t = tempHome({ autoRun: false });
  engine = await startEngine(t.home);
  const { call } = engine;
  await call('projects.create', { name: 'web' }); await call('projects.create', { name: 'api' });
  await call('projects.setActive', { name: 'web' });
  for (let i = 0; i < 6; i++) await call('tasks.create', { project: i % 2 ? 'web' : 'api', title: `Tarea ${i}`, description: `Descripción ${i} `.repeat(30), agent: 'claude' });
  const LISTS = [['tasks.list', { limit: 200 }, (x) => x.id], ['conversations.list', {}, (x) => x.id], ['sessions.list', {}, (x) => x.id], ['projects.list', {}, (x) => x.name], ['inbox.list', { zone: 'orb' }, (x) => x.key]];
  const held = {}; const phone = {};
  const whole = async (method, params) => {
    const plain = await call(method, params);
    return method === 'tasks.list' ? plain.map((x) => compactTask({ ...x })) : plain;
  };
  const check = async (what) => {
    for (const [method, params, key] of LISTS) {
      const res = await call(method, { ...params, since: sinceOf(held[method]) });
      const out = applyFeed(held[method], res, key); held[method] = out.state;
      const ph = applyFeed(phone[method], shapeResult(method, res), key); phone[method] = ph.state;
      const full = await whole(method, params);
      const mine = method === 'inbox.list' ? { ...out.meta, items: out.list } : out.list;
      const phoneMine = method === 'inbox.list' ? { ...ph.meta, items: ph.list } : ph.list;
      const sortKeys = (x) => (x && !Array.isArray(x) && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
      assert.equal(json(sortKeys(mine)), json(sortKeys(full)), `${method} tras ${what}`);
      assert.equal(json(sortKeys(phoneMine)), json(sortKeys(shapeResult(method, full))), `${method} (móvil) tras ${what}`);
    }
  };
  await check('el principio');
  const plain = await call('tasks.list', { limit: 200 });
  assert.ok(Array.isArray(plain) && plain[0].description && 'project_path' in plain[0], 'sin since: la lista entera de siempre');
  const tasks = plain.map((x) => x.id);
  await call('tasks.cancel', { id: tasks[0] });
  const quiet = await call('tasks.list', { limit: 200, since: sinceOf(held['tasks.list']) });
  assert.equal(quiet.rows.length, 1, 'solo la tarea que cambió');
  await check('cancelar una tarea');
  await call('tasks.create', { project: 'web', title: 'Nueva', description: 'Otra más', agent: 'codex' });
  await call('tasks.retry', { id: tasks[0] });
  await check('crear y reintentar');
  await call('projects.create', { name: 'movil' });
  await call('sessions.create', { agent: 'claude', project: 'web', title: 'Directa' });
  await check('un proyecto y una conversación directa');
  const none = await call('conversations.list', { since: sinceOf(held['conversations.list']) });
  assert.deepEqual([none.rows.length, none.gone, none.order], [0, undefined, undefined], 'nada cambió: nada viaja');
});
