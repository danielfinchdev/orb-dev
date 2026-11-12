// HTML pages an agent shows in the chat (orb_html_show): sandboxed CSP, internet off per page, only /p/<id> on 127.0.0.1,
// limits, and the pc-only methods. The server is local; nothing here touches the network outside the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createHtmlPages, pageCsp, FRAME_ANCESTORS, frameAncestors, MAX_HTML, MAX_TITLE, PER_SESSION, MAX_PAGES, SHOWS_PER_MINUTE } from '../src/engine/host/html-pages.mjs';
import { METHODS, REMOTE_METHODS, principalOf, allowed } from '../src/domain/security/permissions.mjs';
import { ENGINE_EVENTS } from '../src/shared/events.mjs';
import { mountable } from '../src/ui/lib/html-mount.js';
import es from '../src/shared/locales/es/herramientas.mjs';
import en from '../src/shared/locales/en/herramientas.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const live = new Set(['s1', 's2']);
const items = [];
const sessions = { get: (id) => (live.has(String(id)) ? { id: String(id) } : null), addItem: (...a) => items.push(a) };
let clock = 1_000_000;
const make = () => { const events = []; const pages = createHtmlPages({ sessions, emit: (e, p) => events.push([e, p]), log: () => {}, now: () => clock }); return { pages, events }; };
// Raw GET with a chosen Host header and method (http.get would not let the Host of a rebinding request through fetch).
const req = (url, { method = 'GET', host } = {}) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers: host ? { Host: host } : {} }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  r.on('error', reject); r.end();
});
const raw = (port, path) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  r.on('error', reject); r.end();
});
// the directives of a CSP, without frame-ancestors (that one lists the window's own origins on purpose)
const fetchPart = (csp) => csp.split(';').map((d) => d.trim()).filter((d) => !d.startsWith('frame-ancestors')).join('; ');
const HTML = '<!doctype html><title>x</title><script>document.title="hi"</script>';

test('no internet by default: sandboxed CSP with nothing open to the network', async () => {
  const { pages } = make();
  try {
    const v = await pages.show({ id: 's1' }, { title: 'a', html: HTML });
    assert.equal(v.internet, false);
    const r = await req(v.url);
    assert.equal(r.status, 200);
    const csp = r.headers['content-security-policy'];
    assert.match(csp, /^sandbox allow-scripts;/);
    assert.doesNotMatch(csp, /allow-same-origin|allow-popups|allow-top-navigation|allow-forms/);
    assert.match(csp, /default-src 'none'/);
    const body = fetchPart(csp);
    assert.doesNotMatch(body, /https:|http:|\*|'self'|unsafe-eval|connect-src/);
    assert.match(csp, /frame-ancestors tauri:\/\/localhost http:\/\/tauri\.localhost https:\/\/tauri\.localhost$/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-dns-prefetch-control'], 'off');
    assert.match(r.headers['content-type'], /^text\/html; charset=utf-8/);
    assert.match(r.headers['permissions-policy'], /camera=\(\)/);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.headers['set-cookie'], undefined);
    assert.equal(r.body, HTML);
  } finally { pages.wipe(); }
});

test('internet on: https: only, per page, read on every request; still no http:, self, * or eval', async () => {
  const { pages } = make();
  try {
    const a = await pages.show({ id: 's1' }, { title: 'a', html: HTML });
    const b = await pages.show({ id: 's1' }, { title: 'b', html: HTML });
    pages.setInternet({ id: a.id, session: 's1' }, true);
    const ca = (await req(a.url)).headers['content-security-policy'];
    const cb = (await req(b.url)).headers['content-security-policy'];
    assert.match(ca, /connect-src https:/); assert.match(ca, /script-src 'unsafe-inline' https:/);
    assert.doesNotMatch(fetchPart(cb), /https:/);
    for (const csp of [ca, cb]) {
      assert.match(csp, /^sandbox allow-scripts;/);
      assert.doesNotMatch(fetchPart(csp), /http:|\*|'self'|unsafe-eval|allow-same-origin/);
      for (const d of ["frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
    }
    pages.setInternet({ id: a.id, session: 's1' }, false);
    assert.doesNotMatch(fetchPart((await req(a.url)).headers['content-security-policy']), /https:/);
    assert.doesNotMatch(pageCsp(true), /allow-same-origin/);
  } finally { pages.wipe(); }
});

test('the switch is per page and never inherited; wrong chat, unknown id and non-boolean are refused', async () => {
  const { pages, events } = make();
  try {
    const a = await pages.show({ id: 's1' }, { title: 'a', html: HTML });
    pages.setInternet({ id: a.id, session: 's1' }, true);
    const next = await pages.show({ id: 's1' }, { title: 'next', html: HTML });
    assert.equal(next.internet, false);
    assert.equal(pages.list().find((p) => p.id === a.id).internet, true);
    assert.equal(pages.list().find((p) => p.id === next.id).internet, false);
    assert.throws(() => pages.setInternet({ id: a.id, session: 's2' }, false), (e) => e.userFacing === true);
    assert.equal(pages.list().find((p) => p.id === a.id).internet, true);
    assert.throws(() => pages.setInternet({ id: 'f'.repeat(32), session: 's1' }, true), (e) => e.userFacing === true);
    assert.throws(() => pages.setInternet({ id: '../x', session: 's1' }, true), (e) => e.userFacing === true);
    for (const bad of ['true', 1, null, undefined]) assert.throws(() => pages.setInternet({ id: a.id, session: 's1' }, bad), (e) => e.userFacing === true);
    assert.ok(events.some(([e, p]) => e === 'html:update' && p.id === a.id && p.internet === true));
  } finally { pages.wipe(); }
});

test('only GET /p/<id> is served, on the exact Host, with no secrets', async () => {
  const { pages } = make();
  try {
    const v = await pages.show({ id: 's1' }, { title: 'a', html: HTML });
    const port = Number(new URL(v.url).port);
    for (const p of ['/', '/p/', '/p', '/p/..%2fx', `/p/${v.id}/`, `/p/${v.id}x`, `/p/${v.id.toUpperCase()}`, `/p/${'0'.repeat(32)}`, `/x/${v.id}`, `/p/${v.id}?a=1`]) assert.equal(await raw(port, p), 404, p);
    assert.equal(await raw(port, '/p/../x'), 404);
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) assert.equal((await req(v.url, { method })).status, 405, method);
    for (const host of ['localhost:' + port, 'evil.example:' + port, `127.0.0.1:${port + 1}`, '127.0.0.1']) assert.ok([403, 421].includes((await req(v.url, { host })).status), host);
    const ok = await req(v.url);
    assert.equal(ok.body, HTML);
    const all = JSON.stringify(ok.headers) + ok.body;
    assert.doesNotMatch(all, /token|secret|authorization|bearer/i);
    assert.equal(pages.address().address, '127.0.0.1');
    assert.equal(new URL(v.url).hostname, '127.0.0.1');
  } finally { pages.wipe(); }
});

test('limits, titles, random ids, events without html, notes in the chat', async () => {
  const { pages, events } = make();
  try {
    await assert.rejects(pages.show(null, { html: HTML }), (e) => e.userFacing === true);
    for (const bad of [{ html: '' }, { html: '  ' }, { html: 5 }, {}, null]) await assert.rejects(pages.show({ id: 's1' }, bad), (e) => e.userFacing === true);
    await assert.rejects(pages.show({ id: 's1' }, { html: 'x'.repeat(MAX_HTML + 1) }), (e) => e.userFacing === true);
    const weird = `  a${String.fromCharCode(0)}b
c${String.fromCharCode(0x202e)}${'z'.repeat(300)}`;
    const edge = await pages.show({ id: 's1' }, { title: weird, html: 'x'.repeat(MAX_HTML) });
    assert.ok(edge.title.length <= MAX_TITLE);
    assert.doesNotMatch(edge.title, /[\p{Cc}\p{Cf}]/u);
    const ids = [edge.id];
    for (let i = 0; i < PER_SESSION + 3; i++) { clock += 61_000; ids.push((await pages.show({ id: 's1' }, { title: `p${i}`, html: HTML })).id); }
    assert.equal(pages.list().filter((p) => p.session === 's1').length, PER_SESSION);
    assert.equal(pages.list().find((p) => p.id === edge.id), undefined); // the oldest went
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[0-9a-f]{32}$/);
    assert.notEqual(Number.parseInt(ids[1].slice(-4), 16) - Number.parseInt(ids[0].slice(-4), 16), 1);
    for (const [name, p] of events.filter(([n]) => n !== 'html:server')) { assert.ok(['html:page', 'html:update', 'html:closed'].includes(name)); assert.equal(JSON.stringify(p).includes('<script'), false); assert.equal('html' in p, false); }
    assert.ok(items.some((a) => a[0] === 's1' && a[1] === 'system' && a[2] === 'status'));
    assert.ok(MAX_PAGES >= PER_SESSION);
    assert.ok(Object.keys(pages.list()[0]).every((k) => ['id', 'session', 'title', 'url', 'internet'].includes(k)));
  } finally { pages.wipe(); }
});

test('the total of pages is capped; dropSession, close and wipe stop serving', async () => {
  const many = new Set(); const sess = { get: (id) => (many.has(String(id)) ? { id } : null), addItem() {} };
  const pages = createHtmlPages({ sessions: sess, emit: () => {}, log: () => {}, now: () => clock });
  try {
    for (let i = 0; i < MAX_PAGES; i++) { many.add(`c${i}`); await pages.show({ id: `c${i}` }, { html: HTML }); }
    // the global cap refuses the new page and never evicts another chat's
    many.add('extra');
    await assert.rejects(pages.show({ id: 'extra' }, { html: HTML }), (e) => e.userFacing === true && e.message === es['msg.html.tooMany'].replace('{n}', MAX_PAGES));
    assert.equal(pages.list().length, MAX_PAGES);
    assert.ok(pages.list().some((p) => p.session === 'c0'));
  } finally { pages.wipe(); }
  const { pages: p2, events } = make();
  const a = await p2.show({ id: 's1' }, { title: 'a', html: HTML });
  const b = await p2.show({ id: 's2' }, { title: 'b', html: HTML });
  const c = await p2.show({ id: 's2' }, { title: 'c', html: HTML });
  p2.dropSession('s2');
  assert.equal((await req(b.url)).status, 404); assert.equal((await req(c.url)).status, 404);
  assert.equal((await req(a.url)).status, 200);
  assert.equal(events.filter(([e]) => e === 'html:closed').length, 2);
  p2.close({ id: a.id, session: 's1' });
  assert.equal((await req(a.url).catch(() => ({ status: 'down' }))).status === 200, false);
  const d = await p2.show({ id: 's1' }, { title: 'd', html: HTML });
  const port = new URL(d.url).port;
  live.delete('s1'); // the chat is deleted: its page is not served any more
  assert.equal((await req(d.url)).status, 404);
  live.add('s1');
  p2.wipe();
  assert.equal(p2.address(), null);
  await assert.rejects(req(`http://127.0.0.1:${port}/p/${d.id}`));
  assert.deepEqual(p2.list(), []);
});

test('htmlPages.* are pc-only; html:* events never reach a phone', () => {
  for (const m of ['htmlPages.list', 'htmlPages.setInternet', 'htmlPages.close']) {
    assert.equal(METHODS[m], 'pc'); assert.equal(REMOTE_METHODS.has(m), false);
    for (const kind of ['phone', 'browser']) assert.equal(allowed(principalOf({ device: { id: 'd', kind } }), m), false, `${kind}: ${m}`);
    assert.equal(allowed(principalOf(), m), true);
  }
  for (const e of ['html:page', 'html:update', 'html:closed']) assert.ok(ENGINE_EVENTS.includes(e));
  const remote = read('src/engine/transport/remote.mjs');
  const set = /const EVENTS = new Set\(\[([^\]]*)\]/.exec(remote)[1];
  assert.doesNotMatch(set, /html:/);
});

test('the MCP tool exists only for a signed chat and the server refuses extra arguments', () => {
  const server = read('src/mcp/server.mjs');
  assert.match(server, /if \(!BOSS && SIGNED_SESSION\) tools\.push\(\s*\{ name: 'orb_html_show'/);
  assert.match(server, /required: \['title', 'html'\], properties: \{ title:[^}]*\}, html:/);
  assert.match(server, /AUTH\.call\('html', \{ title: a\.title, html: a\.html \}\)/);
  assert.match(server, /Strict arguments[\s\S]*sys\.mcp\.extraArgs/);
  const api = read('src/engine/api/index.mjs');
  assert.match(api, /method === 'html' && session\) return htmlPages\.show\(sessions\.get\(session\)/);
  assert.match(api, /htmlPages\.wipe\(\)/);
  assert.match(api, /typeof a\?\.internet !== 'boolean'/);
});

test('window: HtmlPages is mounted for the full PC and the frame is sandboxed with scripts only', () => {
  const jsx = read('src/ui/components/html-page.jsx');
  assert.match(read('src/ui/views/session.jsx'), /\{fullPc\(\) \? <HtmlPages sessionId=\{s\.id\} \/> : null\}/);
  assert.match(jsx, /sandbox="allow-scripts"/);
  assert.equal([...jsx.matchAll(/<iframe/g)].length, 1);
  assert.doesNotMatch(jsx, /allow-same-origin|allow-popups|allow-top-navigation|dangerouslySetInnerHTML|srcDoc|srcdoc/);
  assert.match(jsx, /referrerPolicy="no-referrer"/);
  assert.ok(jsx.includes('<bdi>{p.title}</bdi>'));
  for (const m of ['htmlPages.list', 'htmlPages.setInternet', 'htmlPages.close', 'html:page', 'html:update', 'html:closed']) assert.ok(jsx.includes(m), m);
  assert.doesNotMatch(jsx, /useState\((true|false)\)/); // the switch comes from the engine, not from local state
  const keys = (m) => Object.keys(m.default ?? m).filter((k) => k.startsWith('htmlpage.') || k.startsWith('msg.html.')).sort();
  assert.ok(keys(es).length >= 14); assert.deepEqual(keys(es), keys(en));
});

test('the window CSP adds only frame-src for the own page scheme (never a loopback port)', () => {
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json')).app.security.csp;
  const meta = /Content-Security-Policy" content="([^"]+)"/.exec(read('src/ui/index.html'))[1];
  for (const csp of [tauri, meta]) {
    const d = csp.split(';').map((x) => x.trim());
    assert.deepEqual(d.filter((x) => x.startsWith('frame-src')), ['frame-src http://orbpage.localhost orbpage://localhost']);
    assert.ok(d.includes("script-src 'self'"));
    assert.ok(d.some((x) => x.startsWith('connect-src') && !/127\.0\.0\.1|https?:\/\/\*/.test(x)));
    assert.doesNotMatch(csp, /unsafe-eval/);
  }
  assert.doesNotMatch(read('src/ui/pip.html'), /frame-src/);
  for (const csp of [tauri, meta]) assert.doesNotMatch(csp, /127\.0\.0\.1|localhost:|\*/);
  assert.ok(FRAME_ANCESTORS.includes('tauri://localhost'));
  assert.doesNotMatch(FRAME_ANCESTORS, /127\.0\.0\.1|localhost:\*/); // packaged: no loopback framers
  assert.match(frameAncestors(true), /http:\/\/localhost:\*/);
  assert.doesNotMatch(frameAncestors(false), /127\.0\.0\.1|localhost:/);
  assert.match(read('src-tauri/src/protocol.rs'), /--force-webrtc-ip-handling-policy=disable_non_proxied_udp/);
});

test('per-chat cap drops the oldest of that chat with a system note; rate limit is per chat', async () => {
  const { pages } = make();
  try {
    items.length = 0;
    const first = await pages.show({ id: 's1' }, { title: 'first', html: HTML });
    const other = await pages.show({ id: 's2' }, { title: 'other', html: HTML });
    for (let i = 1; i < PER_SESSION; i++) { clock += 61_000; await pages.show({ id: 's1' }, { title: `p${i}`, html: HTML }); }
    assert.equal(pages.list().filter((p) => p.session === 's1').length, PER_SESSION);
    clock += 61_000;
    await pages.show({ id: 's1' }, { title: 'overflow', html: HTML });
    assert.equal(pages.list().find((p) => p.id === first.id), undefined);
    assert.ok(pages.list().find((p) => p.id === other.id)); // another chat is untouched
    assert.ok(items.some((a) => a[0] === 's1' && a[3].includes('first')));
    clock += 61_000;
    pages.dropSession('s1'); pages.dropSession('s2');
    for (let i = 0; i < SHOWS_PER_MINUTE; i++) await pages.show({ id: 's1' }, { html: HTML });
    await assert.rejects(pages.show({ id: 's1' }, { html: HTML }), (e) => e.userFacing === true);
    await pages.show({ id: 's2' }, { html: HTML }); // other chat is not limited
    clock += 61_000;
    await pages.show({ id: 's1' }, { html: HTML }); // the window slides
  } finally { pages.wipe(); }
});

test('wipe during show: the late show is rejected and nothing is left serving; simultaneous shows respect the cap', async () => {
  const { pages } = make();
  const late = pages.show({ id: 's1' }, { html: HTML });
  pages.wipe();
  await assert.rejects(late, (e) => e.userFacing === true);
  assert.deepEqual(pages.list(), []);
  assert.equal(pages.address(), null);
  clock += 61_000;
  const burst = await Promise.allSettled(Array.from({ length: SHOWS_PER_MINUTE + 5 }, () => pages.show({ id: 's1' }, { html: HTML })));
  assert.equal(burst.filter((r) => r.status === 'fulfilled').length, SHOWS_PER_MINUTE);
  assert.equal(pages.list().length, SHOWS_PER_MINUTE);
  pages.wipe();
});

test('dropSession is wired to the deletion of a chat (session:removed)', () => {
  const api = read('src/engine/api/index.mjs');
  assert.match(api, /event === 'session:removed'.*htmlPages\.dropSession\(payload\.id\)/);
  assert.match(api, /sessions\.emit = emit/);
  assert.match(api, /createHtmlPages\(\{ sessions, emit: emitRaw/);
  const { pages, events } = make();
  return pages.show({ id: 's1' }, { html: HTML }).then(() => { pages.dropSession('s1'); assert.equal(events.filter(([e]) => e === 'html:closed').length, 1); assert.equal(pages.address(), null); });
});

test('mountable: while a page has internet only the first such page is a live frame', () => {
  const p = (id, internet) => ({ id, internet });
  assert.deepEqual([...mountable([p('a', false), p('b', false)])], ['a', 'b']);
  assert.deepEqual([...mountable([p('a', false), p('b', true), p('c', false)])], ['b']);
  assert.deepEqual([...mountable([p('a', true), p('b', true)])], ['a']);
  assert.deepEqual([...mountable([])], []);
  const jsx = read('src/ui/components/html-page.jsx');
  assert.ok(jsx.includes("mountable(list)")); assert.ok(jsx.includes("paused={!live.has(p.id)}"));
  for (const l of [es, en]) for (const k of ['htmlpage.pausedNote', 'msg.html.tooMany', 'msg.html.rate', 'msg.html.locked']) assert.ok(l[k], k);
});

test('the app frames pages through its own scheme and is told the exact server port', async () => {
  const { pages, events } = make();
  process.env.ORB_PAGES_ORIGIN = 'http://orbpage.localhost';
  try {
    const v = await pages.show({ id: 's1' }, { html: HTML });
    assert.equal(v.url, `http://orbpage.localhost/p/${v.id}`);
    const port = events.find(([n]) => n === 'html:server')[1].port;
    assert.ok(port > 0);
    assert.equal((await raw(port, `/p/${v.id}`)), 200); // what the Rust proxy fetches (pages.rs)
    process.env.ORB_PAGES_ORIGIN = 'http://evil.example/x?'; // not an origin: back to the loopback address
    assert.match(pages.list()[0].url, /^http:\/\/127\.0\.0\.1:\d+\/p\//);
    pages.dropSession('s1');
    assert.deepEqual(events.filter(([n]) => n === 'html:server').pop()[1], { port: 0 });
  } finally { delete process.env.ORB_PAGES_ORIGIN; pages.wipe(); }
});
