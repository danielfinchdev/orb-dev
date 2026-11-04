// 3.6 «Personas», acceptance test 1 for the gateway (WS2): no leaks between Ana (owner) and Leo (user) on any surface.
// Each one has a bot, a group, a project, a conversation with Orbe, a reminder, a task, a scheduled task and a direct
// conversation with an agent, all marked with a word of their own (qzana… / qzleo…). Then, for each of Leo's ways in
// (this PC's window after switching, phone, browser, terminal, his linked Orb, a call forwarded to a workshop, an agent's
// tool process) every POLICY method is called with Ana's ids: refused when it touches her things (audited), and nothing
// of hers in what comes back. Leo's live events (window, phone, his Orb) and his phone's notifications (push mock) get
// nothing of Ana while she uses every resource; and the other way round, Ana (the owner) gets nothing of Leo's content.
// Orb Núcleo's local socket (control) cannot call content methods at all.
//
// GAPS (owned by other workstreams; the coordinator runs the full matrix after merging):
// - (WS4 closed its gaps: Leo makes his own bot, group and reminder, stamped with him, and each one's global memory is
//   their own; both carry their mark.)
// - WS3: the scheduler's notices about a task (finished, failed) carry no person: they go to the owner. Tasks stay paused
//   here (control.pause) so none runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine, until, wait, ROOT } from './helpers.mjs';
import { createLink } from '../src/core/link.mjs';
import { POLICY, policyOf } from '../src/core/policy.mjs';
import { Board } from '../src/core/board.mjs';
import { authorize, principalOf, can } from '../src/core/authz.mjs';
import { paths } from '../src/core/home.mjs';
import * as C from '../src/core/mobile-crypto.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
let A; let tA; let port; let dir; let pushLog; let board;
let ana; let leo;
const R = { ana: {}, leo: {} }; // each one's resources
const links = [];
const SKIP = new Set(['persons.switch', 'persons.lock', 'persons.unlock', 'app.lockState']); // the window's own (enlace-36, test 11)
// The owner manages the people (rename, remove, PIN reset, templates for them): not content, and it would undo the test.
const SKIP_OWNER = new Set(['persons.remove', 'persons.rename', 'persons.setPin', 'data.deletePerson', 'templates.apply', 'persons.pauseBots', 'persons.setCaps', 'persons.update']); // the owner's own admin actions on someone (no content)
// Known gaps of other workstreams, reported (not failed): the method echoes a name the caller typed.
const KNOWN = { 'projects.create': 'WS3: «ese nombre ya existe» nombra el proyecto (B6: mensaje neutro)' };
const db = () => new DatabaseSync(paths(tA.home).db);
const sql = (q, ...args) => { const d = db(); try { return d.prepare(q).run(...args); } finally { d.close(); } };
const all = (q, ...args) => { const d = db(); try { return d.prepare(q).all(...args); } finally { d.close(); } };

// What may not show up anywhere for the other person: the marks and the ids that are strings.
const marks = (who) => [who === 'ana' ? 'qzana' : 'qzleo', R[who].session, ...(R[who].devices ?? [])].filter(Boolean);
const leaks = (value, who) => { const s = JSON.stringify(value ?? null); return marks(who).filter((m) => s.includes(m)); };

// The params of a method aimed at someone's resources.
function paramsFor(method, r, person) {
  const m = method;
  if (m === 'sidebar.complete') return { key: `c${r.conv}` };
  if (m === 'chat.answer' || m === 'chat.accept') return { id: r.line };
  if (/^(conversations|chat)\./.test(m)) return { id: r.conv, conversation: r.conv, text: 'x', project: r.project };
  if (/^(projects|expert)\./.test(m)) return { name: r.project, project: r.project, to: 'otro-nombre' };
  if (/^(whiteboard|logs|images)\./.test(m)) return { project: r.project };
  if (/^tasks\./.test(m)) return { id: r.task, project: r.project, title: 'x', description: 'x' };
  if (/^sessions\./.test(m)) return { id: r.session, project: r.project, text: 'x' };
  if (/^schedules\./.test(m)) return { id: r.schedule, project: r.project, title: 'x', description: 'x', every: 'daily' };
  if (/^bots\.groups\./.test(m)) return { id: r.group, text: 'x' };
  if (m === 'bots.reminders.cancel') return { id: r.reminder };
  if (m === 'bots.decide' || m === 'bots.answer') return { item: r.botLine, decision: 'allow' };
  if (/^bots\./.test(m)) return { id: r.bot, text: 'x' };
  if (/^link\./.test(m)) return { id: r.devices?.[0] ?? 'x', name: 'x' };
  if (/^(persons|data|templates)\./.test(m)) return { id: person, person, name: 'x', pin: null };
  return {};
}
// Whether the call aims at one of those resources (then it must be refused).
const aims = (method, params) => { let list = []; try { list = [policyOf(method)?.res?.(params) ?? []].flat(); } catch { /* none */ } return list.some((x) => x && x.id != null && x.id !== '' && !['owner', 'integration'].includes(x.type)); };
const methods = () => Object.keys(POLICY).filter((m) => !m.endsWith('.*') && !SKIP.has(m));

const device = (name, kind) => { const l = createLink({ file: path.join(dir, `${crypto.randomUUID()}.json`), secret: crypto.randomBytes(32), identity: () => ({ name, kind }) }); links.push(l); return l; };
async function pairFor(person, kind, name) {
  const l = device(name, kind);
  const q = await A.call('link.qr', { person, device: kind });
  const peer = await l.connect({ qr: q.url });
  await until(() => l.peers().find((p) => p.id === peer.id)?.online, `${name} en directo`);
  const events = [];
  l.on('*', (e, p) => events.push({ e, p }));
  return { l, peer, events, call: (m, p = {}) => l.call(peer.id, m, p) };
}
// A device with notifications on and its app closed (its pushes go to the mock log).
async function pushDevice(person, tag) {
  const l = device(`Avisos ${tag}`, 'phone');
  const peer = await l.connect({ qr: (await A.call('link.qr', { person })).url });
  const raw = l.raw(peer.id);
  const sub = { endpoint: `https://fcm.googleapis.com/fcm/send/${tag}-${crypto.randomUUID()}`, keys: { p256dh: Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  const r = await raw.post('/api/push', raw.box('push', { subscription: sub }));
  assert.equal(C.open(raw.key, await r.json(), C.AAD.response(raw.id)).ok, true);
  l.stop(); // the app is closed
  return { id: peer.id, endpoint: sub.endpoint };
}
const pushes = () => { try { return fs.readFileSync(pushLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

// Each one makes their own things (marked with its word) from this PC's window: the API stamps them with the caller.
async function seed(who) {
  const w = `qz${who}`; const r = R[who];
  r.project = `${w}-proyecto`;
  if (who === 'leo') {
    // Ana lends Leo her Claude account for Orb mode (WS3 loans), then Leo sits at the window.
    await A.call('accounts.lend', { id: 'claude', person: leo.id, daily_turns: 500, dev: true });
    assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  }
  try {
    await A.call('projects.create', { name: r.project });
    const c = await A.call('chat.send', { text: `${w} hola Orbe` });
    r.conv = c.conversation;
    await until(async () => (await A.call('chat.list', { conversation: r.conv })).some((l) => l.role === 'orb'), `respuesta de Orbe (${who})`);
    await A.call('conversations.update', { id: r.conv, title: `${w} conversación` });
    r.line = (await A.call('chat.list', { conversation: r.conv })).find((l) => l.role === 'orb').id;
    r.task = (await A.call('tasks.create', { project: r.project, title: `${w} tarea`, description: `${w} hacer algo` })).id;
    r.schedule = (await A.call('schedules.create', { project: r.project, title: `${w} programada`, description: `${w} cada día`, every: 'daily' })).id;
    r.session = (await A.call('sessions.create', { agent: 'claude', project: r.project, title: `${w} sesión` })).id;
    const bot = await A.call('bots.create', { name: `${w}bot`, role_text: `${w} ayuda` });
    r.bot = bot.id;
    r.group = (await A.call('bots.groups.create', { name: `${w} grupo`, members: [bot.id] })).id;
    await A.call('bots.groups.chat', { id: r.group });
    r.reminder = (await A.call('bots.reminders.create', { id: bot.id, text: `${w} recordatorio`, when: new Date(Date.now() + 86_400_000).toISOString() })).id;
    await A.call('bots.memory.set', { id: bot.id, text: `${w} memoria del bot` });
    await A.call('bots.memory.set', { id: 'global', text: `${w} memoria global` });
    await A.call('bots.send', { id: bot.id, text: `${w} hola bot` });
    await until(async () => { const x = await A.call('bots.chat', { id: bot.id }); return x.lines.some((l) => l.role === 'bot') && !x.state?.busy && x; }, `respuesta del bot (${who})`, 30_000);
    const chat = await A.call('bots.chat', { id: bot.id });
    r.botConv = chat.conversation; r.botLine = chat.lines[0].id;
  } finally { if (who === 'leo') assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
}

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  port = 20000 + Math.floor(Math.random() * 20000);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-superficies-'));
  pushLog = path.join(dir, 'avisos.jsonl');
  tA = tempHome({ role: 'todo', mobile: { enabled: true, port, name: 'Casa', preview: 'all' } });
  A = await startEngine(tA.home, { env: { ORB_REMOTE_BIND: '127.0.0.1', ORB_PUSH_LOG: pushLog } });
  await until(async () => (await A.call('remote.status')).running, 'acceso');
  await A.call('control.pause'); // no task runs (see GAPS)
  leo = await A.call('persons.create', { name: 'Leo', caps: { dev: true } }); // Orb mode for Leo (A9)
  ana = (await A.call('persons.list')).find((p) => p.role === 'owner');
  await seed('ana'); await seed('leo');
  board = new Board(); // this test's own connection to the same database (for the in-process channels)
});
after(async () => {
  for (const l of links) l.stop();
  try { board?.close?.(); } catch { /* closed */ }
  await A?.stop(); tA?.cleanup();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
});

// Every method with the other person's ids through one channel: refused when it aims at their things, clean otherwise.
async function sweep(call, other, label, t = null) {
  const bad = [];
  let refused = 0;
  for (const m of methods()) {
    if (other === 'leo' && SKIP_OWNER.has(m)) continue;
    const params = paramsFor(m, R[other], other === 'ana' ? ana.id : leo.id);
    let out; let err = null;
    try { out = await call(m, params); } catch (e) { err = e; }
    if (err) {
      refused++;
      if (leaks(err.message, other).length) { if (KNOWN[m]) t?.diagnostic(`GAP ${m}: ${KNOWN[m]}`); else bad.push(`${m}: error con ${leaks(err.message, other)}`); }
      continue;
    }
    if (aims(m, params)) bad.push(`${m}: debía negarse`);
    const l = leaks(out, other); if (l.length) { const j = JSON.stringify(out); const i = j.indexOf(l[0]); bad.push(`${m}: devuelve ${l.join(', ')} (${j.slice(Math.max(0, i - 300), i + 60)})`); }
  }
  assert.deepEqual(bad, [], `${label}: ${bad.join(' · ')}`);
  return refused;
}

test('1a: Leo, por cada canal, no llega a nada de Ana (todas las reglas de POLICY)', async (t) => {
  const phone = await pairFor(leo.id, 'phone', 'Móvil de Leo');
  const browser = await pairFor(leo.id, 'browser', 'Navegador de Leo');
  const terminal = await pairFor(leo.id, 'terminal', 'Terminal de Leo');
  const orb = await pairFor(leo.id, 'orb', 'Orb de Leo');
  for (const [d, label] of [[phone, 'móvil'], [browser, 'navegador'], [terminal, 'terminal'], [orb, 'Orb enlazado']]) {
    assert.equal((await d.call('persons.me')).person.id, leo.id, label);
    await sweep(d.call, 'ana', label, t);
  }
  // This PC's window, after switching to Leo.
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  try { await sweep(A.call, 'ana', 'ventana (Leo)', t); }
  finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  // A call forwarded to this Orb as Leo (a workshop), and an agent's tool process of Leo: the same rules, in process.
  const fwd = principalOf(board, { forwarded: true, person: leo.id });
  const agent = principalOf(board, { agentToken: { person: leo.id, agent: 'claude' } });
  for (const m of methods()) {
    const params = paramsFor(m, R.ana, ana.id);
    if (aims(m, params)) assert.throws(() => authorize(board, fwd, m, params), (e) => e.status === 403, `reenviada: ${m}`);
    assert.throws(() => authorize(board, agent, m, params), (e) => e.status === 403, `agente: ${m}`);
  }
  for (const res of [{ type: 'bot', id: R.ana.bot }, { type: 'conversation', id: R.ana.conv }, { type: 'project', id: R.ana.project }, { type: 'task', id: R.ana.task }, { type: 'session', id: R.ana.session }, { type: 'reminder', id: R.ana.reminder }])
    assert.equal(can(board, agent, 'view', res), false, `agente de Leo: ${res.type}`);
  // Refusals are audited (ids only, never content).
  const audit = all("SELECT * FROM audit WHERE person_id = ? AND decision = 'deny'", leo.id);
  assert.ok(audit.length > 100, `auditoría: ${audit.length}`);
  assert.ok(audit.every((a) => !String(a.resource ?? '').includes('qzana hola')), 'sin contenido en la auditoría');
  // His own things, he does reach.
  assert.ok((await phone.call('bots.list')).bots.some((b) => b.id === R.leo.bot));
  assert.ok((await phone.call('conversations.list')).some((c) => c.id === R.leo.conv));
  assert.ok((await phone.call('chat.list', { conversation: R.leo.conv })).length > 0);
});

test('1b: Ana (la dueña) tampoco lee nada de Leo; solo ve nombres y números', async (t) => {
  await sweep(A.call, 'leo', 'ventana (Ana)', t);
  const anaPhone = await pairFor(ana.id, 'phone', 'Móvil de Ana');
  await sweep(anaPhone.call, 'leo', 'móvil de Ana', t);
  const overview = await A.call('persons.overview');
  assert.deepEqual(leaks(overview, 'leo'), []);
  const o = overview.find((x) => x.id === leo.id);
  assert.equal(o.counts.bots, 1); assert.equal(o.counts.projects, 1); assert.ok(o.devices >= 4);
});

test('1c: los directos, la ventana y los avisos de cada uno no llevan nada del otro', async () => {
  const leoPhone = await pairFor(leo.id, 'phone', 'Móvil de Leo (directo)');
  const leoOrb = await pairFor(leo.id, 'orb', 'Orb de Leo (directo)');
  const anaPhone = await pairFor(ana.id, 'phone', 'Móvil de Ana (directo)');
  const leoPush = await pushDevice(leo.id, 'leo');
  const anaPush = await pushDevice(ana.id, 'ana');
  R.ana.devices = (await A.call('link.devices')).filter((d) => d.person === ana.id).map((d) => d.id);
  R.leo.devices = (await A.call('link.devices')).filter((d) => d.person === leo.id).map((d) => d.id);
  const activity = async (phone, who) => {
    const r = R[who]; const w = `qz${who}`;
    await phone.call('chat.send', { conversation: r.conv, text: `${w} otra vez` });
    await phone.call('bots.send', { id: r.bot, text: `${w} dime algo` });
    await phone.call('bots.groups.send', { id: r.group, text: `${w} al grupo` }).catch(() => {});
    await phone.call('sessions.send', { id: r.session, text: `${w} en la sesión` }).catch(() => {});
    await phone.call('tasks.cancel', { id: r.task }).catch(() => {});
    await phone.call('bots.reminders.create', { id: r.bot, text: `${w} suena ya`, when: new Date(Date.now() + 1500).toISOString() });
    await until(async () => (await phone.call('bots.chat', { id: r.bot })).lines.some((l) => l.body?.includes(`${w} suena ya`)), `recordatorio de ${who}`, 30_000).catch(() => {});
    await until(async () => { const x = await phone.call('bots.chat', { id: r.bot }); return !x.state?.busy; }, `bot de ${who} libre`, 30_000);
    await wait(1500);
  };

  // Ana uses everything while Leo sits at this PC's window and has his phone and his Orb open.
  assert.equal((await A.call('persons.switch', { id: leo.id })).ok, true);
  const from = A.events.length; leoPhone.events.length = 0; leoOrb.events.length = 0; anaPhone.events.length = 0;
  try { await activity(anaPhone, 'ana'); } finally { assert.equal((await A.call('persons.switch', { id: ana.id })).ok, true); }
  const windowLeo = A.events.slice(from).filter((m) => m.event !== 'persons:switched');
  const check = (list, who, label) => {
    const bad = list.filter((x) => leaks(x, who).length);
    assert.deepEqual(bad.map((x) => x.e ?? x.event), [], `${label} recibe cosas de ${who}: ${JSON.stringify(bad).slice(0, 600)}`);
    // board:changed says only what changed (names of tables), never content.
    for (const x of list) if ((x.e ?? x.event) === 'board:changed') assert.ok((x.p ?? x.payload).every((s) => typeof s === 'string' && s.length < 40));
  };
  check(windowLeo, 'ana', 'la ventana de Leo');
  check(leoPhone.events, 'ana', 'el móvil de Leo');
  check(leoOrb.events, 'ana', 'el Orb de Leo');
  assert.ok(anaPhone.events.some((x) => leaks(x, 'ana').length), 'Ana sí recibe lo suyo');
  assert.ok(!pushes().some((x) => x.endpoint === leoPush.endpoint), 'ningún aviso al móvil de Leo');
  assert.ok(pushes().some((x) => x.endpoint === anaPush.endpoint), 'Ana sí recibe avisos');

  // And the other way round: Leo uses his things; Ana's window, phone and pushes get nothing of them.
  const from2 = A.events.length; anaPhone.events.length = 0; leoPhone.events.length = 0;
  const before = pushes().length;
  await activity(leoPhone, 'leo');
  check(A.events.slice(from2), 'leo', 'la ventana de Ana');
  check(anaPhone.events, 'leo', 'el móvil de Ana');
  assert.ok(leoPhone.events.some((x) => leaks(x, 'leo').length), 'Leo sí recibe lo suyo');
  const after2 = pushes().slice(before);
  assert.ok(!after2.some((x) => x.endpoint === anaPush.endpoint && leaks(x, 'leo').length), 'ningún aviso de Leo en el móvil de Ana');
  assert.ok(after2.some((x) => x.endpoint === leoPush.endpoint), 'Leo sí recibe sus avisos');
});

test('1d: el socket local de Orb Núcleo (control) no llega al contenido de nadie', () => {
  const ctl = principalOf(board, { control: true });
  for (const m of ['chat.list', 'bots.list', 'conversations.list', 'tasks.list', 'sessions.items', 'bots.memory.get', 'projects.list'])
    assert.throws(() => authorize(board, ctl, m, paramsFor(m, R.leo, leo.id)), (e) => e.status === 403 && e.reason === 'ceiling', m);
  assert.doesNotThrow(() => authorize(board, ctl, 'persons.list', {}));
});
