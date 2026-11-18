// 3.8.4 (piece 4): the activity read on demand (logs of Orb, agents, the user and the app), the user's own log and the report.
import './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { METHODS, principalOf } from '../src/domain/security/permissions.mjs';
import { shapeResult } from '../src/engine/transport/remote.mjs';
import { readActivity, buildReport, BLOCK, READ_CAP } from '../src/domain/activity/activity.mjs';
import { logUserAction, userLogFile } from '../src/domain/activity/user-log.mjs';
import { recordUserCall } from '../src/domain/activity/record.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { ensureDefaultRules } from '../src/domain/rules/rules.mjs';

const PASSWORD = 'una frase larga de prueba';
const desktop = principalOf();
const phone = principalOf({ device: { id: 'm1', kind: 'phone' } });
const FAKE = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
let t; let board; let api; let runs;

before(async () => {
  t = tempHome(); board = new Board(); ensureDefaultRules();
  const sessions = new Sessions(board, { emit: () => {} });
  const orchestrator = new Orchestrator(board, { emit: () => {} });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit: () => {}, log: () => {}, version: '9.9.9-test', remoteRef: { current: null } });
  await api.call('master.create', { password: PASSWORD }, desktop);
  for (const n of ['proy', 'viejo', 'pr', 'ap']) createProject(board, { name: n }, 'usuario');
  runs = ctx.paths.runs; fs.mkdirSync(runs, { recursive: true });
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const call = (m, p = {}, who = desktop) => api.call(m, p, who);
const file = (n) => path.join(runs, n);
const iso = (min) => new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString();
const reset = () => { for (const n of ['motor.log', 'motor.log.1', 'asistente.log', 'motor-salida.log', 'motor-salida.1.log', 'usuario.log', 'usuario.log.1']) fs.rmSync(file(n), { force: true }); board.run('DELETE FROM events'); };
const all = (params) => { const items = []; let cursor; for (let i = 0; i < 200; i++) { const r = readActivity(board, { ...params, cursor }); items.push(...r.items); if (!r.next) break; cursor = r.next; } return items; };
const rows = () => (fs.existsSync(userLogFile()) ? fs.readFileSync(userLogFile(), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('permissions: the phone may read activity.list and activity.report', () => {
  assert.equal(METHODS['activity.list'], 'remote'); assert.equal(METHODS['activity.report'], 'remote');
  assert.ok(api.methodNames().includes('activity.report'));
});

test('sources, levels, project, dates and text', () => {
  reset();
  fs.writeFileSync(file('motor.log'), [`${iso(1)} arranca el motor`, `${iso(2)} aviso: disco casi lleno`, `${iso(3)} fallo al abrir la base`].join('\n') + '\n');
  fs.writeFileSync(file('asistente.log'), '[c1] {"type":"assistant","text":"hola"}\n');
  fs.writeFileSync(file('motor-salida.log'), 'thread panicked: boom\nnormal stderr line\n');
  fs.writeFileSync(file('motor-salida.1.log'), 'old generation line\n');
  const task = board.createTask({ project: 'proy', title: 'Tarea uno', description: 'x', agent: 'claude' }, 'usuario');
  board.event(task.id, 'claude', 'agent.problem', 'se rompio');
  board.event(task.id, 'claude', 'agent.reply', 'todo bien');
  const every = all({});
  const by = (s) => every.filter((i) => i.source === s);
  assert.equal(by('orb').length, 4);
  assert.equal(by('app').length, 3, 'app = motor-salida.log + .1.log');
  assert.ok(by('subagentes').some((i) => i.project === 'proy' && i.kind === 'agent.problem' && i.level === 'error'));
  assert.equal(by('orb').find((i) => /disco/.test(i.text)).level, 'warn');
  assert.equal(by('orb').find((i) => /base/.test(i.text)).level, 'error');
  assert.equal(by('app').find((i) => /panicked/.test(i.text)).level, 'error');
  assert.deepEqual(all({ sources: ['app'] }).map((i) => i.source), ['app', 'app', 'app']);
  assert.ok(all({ level: 'error' }).every((i) => i.level === 'error'));
  assert.ok(all({ level: 'warn' }).length > all({ level: 'error' }).length);
  assert.ok(all({ project: 'proy' }).every((i) => i.project === 'proy') && all({ project: 'proy' }).length >= 2);
  const ranged = all({ sources: ['orb'], from: iso(2), to: iso(2) });
  assert.equal(ranged.length, 1); assert.match(ranged[0].text, /disco/);
  assert.equal(all({ q: 'ARRANCA' }).length, 1, 'text is case-insensitive');
  for (const i of every) assert.ok(i.id && i.source && i.level && 'at' in i && 'project' in i && i.kind && typeof i.text === 'string');
  assert.equal(new Set(every.map((i) => i.id)).size, every.length, 'stable unique ids');
});

test('a cursor walks the pages without duplicates or gaps', () => {
  reset();
  const lines = []; for (let i = 0; i < 700; i++) lines.push(`${iso(i)} linea ${i}`);
  fs.writeFileSync(file('motor.log'), lines.join('\n') + '\n');
  const ar = []; for (let i = 0; i < 90; i++) ar.push(`[c] mensaje ${i}`);
  fs.writeFileSync(file('asistente.log'), ar.join('\n') + '\n');
  for (let i = 0; i < 60; i++) board.event(null, 'claude', 'task.quiet', `evento ${i}`);
  const first = readActivity(board, { limit: 50 });
  assert.equal(first.items.length, 50); assert.ok(first.next);
  const seen = all({ limit: 50 });
  assert.equal(seen.length, 700 + 90 + 60);
  assert.equal(new Set(seen.map((i) => i.id)).size, seen.length, 'no duplicates');
  const motor = seen.filter((i) => i.source === 'orb' && /linea/.test(i.text)).map((i) => Number(/linea (\d+)/.exec(i.text)[1]));
  assert.deepEqual(motor, Array.from({ length: 700 }, (_, i) => 699 - i), 'newest first, no gap');
  assert.equal(readActivity(board, { limit: 1000 }).items.length, 500, 'limit is capped at 500');
});

test('a big log is read in blocks, not whole; the previous generation follows; a split line and missing files are fine', () => {
  reset();
  const filler = `${iso(1)} ${'x'.repeat(190)}\n`;
  const n = Math.ceil((6 * 1024 * 1024) / filler.length);
  fs.writeFileSync(file('motor.log'), `${iso(0)} la primera\n` + filler.repeat(n) + `${iso(9)} la ultima ñandú\n`);
  const stats = {};
  const r = readActivity(board, { sources: ['orb'], limit: 3 }, stats);
  assert.equal(r.items[0].text, 'la ultima ñandú');
  assert.ok(stats.bytes <= BLOCK * 2, `read ${stats.bytes} bytes for 3 lines`);
  // a filter that matches nothing is capped per call, and the cursor goes on
  const miss = {}; const rm = readActivity(board, { sources: ['orb'], q: 'zzz-nada' }, miss);
  assert.ok(miss.bytes <= READ_CAP + BLOCK, `capped: ${miss.bytes}`);
  assert.ok(rm.next, 'more to look at');
  let rest = readActivity(board, { sources: ['orb'], q: 'la primera', cursor: rm.next }); let calls = 1;
  while (!rest.items.length && rest.next && calls < 20) { rest = readActivity(board, { sources: ['orb'], q: 'la primera', cursor: rest.next }); calls += 1; }
  assert.equal(rest.items.length, 1, 'the cursor reaches the first line at the end of a >5 MB file');
  // generation .1 and a line longer than a block
  reset();
  fs.writeFileSync(file('motor.log.1'), `${iso(1)} vieja\n`);
  fs.writeFileSync(file('motor.log'), `${iso(2)} ${'y'.repeat(BLOCK + 500)}\n${iso(3)} nueva`);
  const items = all({ sources: ['orb'] });
  assert.deepEqual(items.map((i) => i.text.slice(0, 5)), ['nueva', 'yyyyy', 'vieja']);
  assert.ok(items[1].text.length <= 2001, 'long text is cut');
  assert.equal(items[0].id.split(':')[1], 'motor.log'); assert.equal(items[2].id.split(':')[1], 'motor.log.1');
  reset();
  assert.deepEqual(readActivity(board, { sources: ['orb', 'app', 'usuario'] }), { items: [], next: null });
});

test('activity.list: q/limit still gives the array of before; filters give { items, next }', async () => {
  reset();
  const task = board.createTask({ project: 'viejo', title: 'Hola', description: 'x', agent: 'claude' }, 'usuario');
  board.event(task.id, 'claude', 'agent.reply', `clave ${FAKE}`);
  const old = await call('activity.list', { q: 'clave', limit: 10 });
  assert.ok(Array.isArray(old)); assert.ok(old.length >= 1);
  assert.ok(!JSON.stringify(old).includes(FAKE)); assert.ok('actor' in old[0] && 'detail' in old[0]);
  assert.ok(Array.isArray(await call('activity.list', {})));
  const paged = await call('activity.list', { sources: ['subagentes'], q: 'clave' });
  assert.ok(Array.isArray(paged.items) && 'next' in paged); assert.ok(!JSON.stringify(paged).includes(FAKE));
  assert.ok(Array.isArray((await call('activity.list', { level: 'info' })).items));
});

test('activity.report: oldest first, header, secrets hidden, phone sees no PC paths', async () => {
  reset();
  fs.writeFileSync(file('motor.log'), `${iso(1)} primero ${FAKE}\n${iso(2)} ruta ${ctx.home}\\core\\x segundo\n${iso(3)} tercero\n`);
  const task = board.createTask({ project: 'pr', title: 'T', description: 'x', agent: 'claude' }, 'usuario');
  board.event(task.id, 'claude', 'agent.reply', `evento ${FAKE}`);
  const pc = (await call('activity.report', { lines: 50 })).text;
  assert.ok(!pc.includes(FAKE), 'secret hidden for the PC');
  assert.match(pc, /Orb 9\.9\.9-test/); assert.ok(pc.includes(process.platform));
  assert.ok(pc.indexOf('primero') < pc.indexOf('tercero'), 'chronological');
  assert.match(pc, /\[orb\] \[info\] - primero/); assert.match(pc, /\[subagentes\] \[info\] pr /);
  const ph = shapeResult('activity.report', await call('activity.report', { lines: 50 }, phone)).text;
  assert.ok(!ph.includes(FAKE) && !ph.includes(ctx.home) && ph.includes('<Orb>'), ph);
  const upto = (await call('activity.report', { at: iso(2), lines: 50 })).text;
  assert.ok(upto.includes('segundo') && !upto.includes('tercero'), 'up to `at`');
  assert.equal((await call('activity.report', { lines: 1 })).text.split('\n').filter((l) => l.startsWith('[')).length, 1);
  const huge = 'z'.repeat(1900);
  fs.writeFileSync(file('motor.log'), Array.from({ length: 200 }, (_, i) => `${iso(i)} ${i} ${huge}`).join('\n') + '\n');
  assert.ok((await call('activity.report', { lines: 500 })).text.length <= 61 * 1024);
});

test('the user log: settings, rules and rails are recorded with before and after, secrets hidden', async () => {
  reset();
  const u = (await call('master.unlock', { password: PASSWORD })).unlock;
  const fresh = async (purpose) => (await call('master.unlock', { password: PASSWORD, purpose })).unlock;
  await call('config.save', { patch: { userName: 'Bea', mcpServers: [{ name: 'x', command: 'node', env: { TOKEN: FAKE } }] }, unlock: u });
  let r = rows().find((x) => x.kind === 'settings.change');
  assert.ok(r, 'settings.change');
  assert.equal(JSON.parse(r.before).userName, 'Ana'); assert.equal(JSON.parse(r.after).userName, 'Bea');
  assert.equal(JSON.parse(r.after).mcpServers, 'changed');
  assert.ok(!JSON.stringify(r).includes(FAKE)); assert.ok(!JSON.stringify(r).includes('node'));
  const made = await call('rules.create', { titulo: 'Mia', para: 'orb', texto: `No uses sudo ${FAKE}`, unlock: u });
  r = rows().find((x) => x.kind === 'rules.create');
  assert.ok(r); assert.equal(r.before, 'null'); assert.match(r.after, /Mia/); assert.ok(!r.after.includes(FAKE));
  await call('rules.save', { id: made.after.id, titulo: 'Mia 2', para: 'ambos', texto: 'otro', unlock: u });
  r = rows().find((x) => x.kind === 'rules.save'); assert.match(r.before, /Mia/); assert.match(r.after, /Mia 2/);
  await call('rails.set', { id: 'publicar', enabled: false, unlock: await fresh('rails') });
  r = rows().find((x) => x.kind === 'rails.set');
  assert.match(r.text, /publicar/); assert.equal(JSON.parse(r.before).activo, true); assert.equal(JSON.parse(r.after).activo, false);
  await call('rails.restore', { unlock: await fresh('rails') });
  assert.ok(rows().some((x) => x.kind === 'rails.restore'));
  const got = all({ sources: ['usuario'] });
  assert.ok(got.length >= 5 && got.every((i) => i.source === 'usuario'));
  assert.ok(got.find((i) => i.kind === 'settings.change').before);
  const n = rows().length;
  await assert.rejects(call('rules.save', { id: 'no-existe', titulo: 'a', para: 'ambos', texto: 'b', unlock: u }));
  assert.equal(rows().length, n, 'a failed call writes nothing');
});

test('user actions: a message from the phone, an approval and an undo leave a line', async () => {
  reset();
  const task = board.createTask({ project: 'ap', title: 'Ap', description: 'x', agent: 'claude' }, 'usuario');
  board.run("UPDATE tasks SET status = 'awaiting_approval' WHERE id = ?", task.id);
  await call('tasks.approve', { id: task.id, decision: 'rejected', hash: 'h' });
  const a = rows().find((x) => x.kind === 'approval.decision');
  assert.ok(a); assert.equal(a.project, 'ap'); assert.match(a.text, /rejected/);
  // chat.send and tasks.undo would start an agent: their log lines are checked at the recorder, which the dispatcher calls
  recordUserCall({ board, method: 'chat.send', params: { text: 'b'.repeat(300), project: 'ap' }, out: {}, principal: phone });
  const sent = rows().find((x) => x.kind === 'chat.message');
  assert.ok(sent.text.length <= 220); assert.match(sent.text, /^\[movil\]/); assert.equal(sent.project, 'ap');
  recordUserCall({ board, method: 'tasks.undo', params: { id: task.id }, out: {}, principal: desktop });
  assert.equal(rows().find((x) => x.kind === 'undo.task').project, 'ap');
  recordUserCall({ board, method: 'conversations.restore', params: { id: 3 }, out: {}, principal: desktop });
  assert.ok(rows().some((x) => x.kind === 'trash.restore'));
  logUserAction({ kind: 'chat.message', text: 'a'.repeat(5000) });
  assert.ok(rows().at(-1).text.length <= 2001);
});

test('usuario.log rotates by size and keeps one generation', () => {
  reset();
  for (let i = 0; i < 30; i++) logUserAction({ kind: 'x', text: `n${i} ${'q'.repeat(100)}`, max: 2000 });
  assert.ok(fs.existsSync(`${userLogFile()}.1`)); assert.ok(fs.statSync(userLogFile()).size <= 2400);
  const items = all({ sources: ['usuario'] });
  assert.ok(items.length > 10); assert.ok(items[0].id.includes('usuario.log:'));
});

test('idle: the activity module starts no timers and no processes', () => {
  for (const f of ['activity.mjs', 'user-log.mjs', 'record.mjs']) {
    const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'domain', 'activity', f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/setInterval|setTimeout|spawn|(?<![.\w])exec(Sync|File)?\(|child_process|fs\.watch|chokidar/.test(src), f);
  }
});

test('activity.list for the phone hides this PC folders in the paged form; the desktop keeps them', async () => {
  reset();
  fs.writeFileSync(file('motor.log'), `${iso(1)} ruta ${path.join(ctx.home, 'core', 'x')} fin
`);
  const ph = await call('activity.list', { sources: ['orb'] }, phone);
  assert.ok(!ph.items[0].text.includes(ctx.home) && ph.items[0].text.includes('<Orb>'), ph.items[0].text);
  const pc = await call('activity.list', { sources: ['orb'] });
  assert.ok(pc.items[0].text.includes(ctx.home));
});

test('events: a filter that only matches the oldest rows does not repeat them on the next page', () => {
  reset();
  for (let i = 0; i < 100; i++) board.event(null, 'claude', 'task.quiet', `zeta ${i}`);
  for (let i = 0; i < 500; i++) board.event(null, 'claude', 'task.quiet', `otro ${i}`);
  const first = readActivity(board, { sources: ['subagentes'], q: 'zeta', limit: 150 });
  assert.equal(first.items.length, 100);
  assert.equal(first.next, null, 'nothing left to page');
  const seen = all({ sources: ['subagentes'], q: 'zeta', limit: 30 });
  assert.equal(seen.length, 100); assert.equal(new Set(seen.map((i) => i.id)).size, 100);
});

test('lines without a time: the report has them and they sit by the older timed line; recent events are not pushed out', () => {
  reset();
  fs.writeFileSync(file('motor.log'), `${iso(10)} a\nsuelta sin hora\n${iso(20)} b\n`);
  const range = readActivity(board, { sources: ['orb'], from: iso(5), to: iso(15) }).items.map((i) => i.text);
  assert.deepEqual(range, ['suelta sin hora', 'a']);
  fs.writeFileSync(file('asistente.log'), Array.from({ length: 90 }, (_, i) => `[c] mensaje ${i}`).join('\n') + '\n');
  fs.writeFileSync(file('motor-salida.log'), 'linea de la app\n');
  for (let i = 0; i < 10; i++) board.event(null, 'claude', 'task.quiet', `evento ${i}`);
  const big = buildReport(board, { lines: 500, version: 't' }).text;
  assert.ok(big.includes('mensaje 3') && big.includes('linea de la app'), 'the report includes the assistant and the app');
  const few = buildReport(board, { lines: 10, version: 't' }).text;
  assert.equal(few.split('\n').filter((l) => /\[subagentes\]/.test(l)).length, 10, 'timeless lines do not displace recent events');
});

test('a line longer than the read budget cannot keep the cursor in place', () => {
  reset();
  fs.writeFileSync(file('motor.log'), `${'x'.repeat(READ_CAP * 2 + 1000)}\n${iso(1)} fin\n`);
  let cursor; let pages = 0; const seen = [];
  do {
    const r = readActivity(board, { sources: ['orb'], limit: 5, cursor }); pages += 1; seen.push(...r.items.map((i) => i.text.slice(0, 3)));
    cursor = r.next;
  } while (cursor && pages < 10);
  assert.equal(cursor, null, `finished after ${pages} pages`);
  assert.equal(seen[0], 'fin');
});

test('a rotation between two pages neither repeats nor skips lines', () => {
  reset();
  const lines = Array.from({ length: 10 }, (_, i) => `${iso(i)} linea numero ${i} con relleno para pasar el fingerprint`);
  fs.writeFileSync(file('motor.log'), lines.join('\n') + '\n');
  const p1 = readActivity(board, { sources: ['orb'], limit: 4 });
  assert.deepEqual(p1.items.map((i) => i.text.match(/numero (\d)/)[1]), ['9', '8', '7', '6']);
  fs.renameSync(file('motor.log'), file('motor.log.1'));
  fs.writeFileSync(file('motor.log'), `${iso(30)} nueva generacion con texto largo suficiente para el fingerprint\n`);
  const p2 = readActivity(board, { sources: ['orb'], limit: 20, cursor: p1.next });
  assert.deepEqual(p2.items.map((i) => i.text.match(/numero (\d)/)?.[1]), ['5', '4', '3', '2', '1', '0']);
});

test('a forged cursor cannot make the engine loop: out-of-range positions restart from the newest line', () => {
  reset();
  fs.writeFileSync(file('motor.log'), Array.from({ length: 10 }, (_, i) => `${iso(i)} linea ${i}`).join('\n') + '\n');
  const enc = (c) => Buffer.from(JSON.stringify(c)).toString('base64url');
  const clean = readActivity(board, { sources: ['orb'], limit: 5 });
  for (const bad of [{ f: -1e15 }, { f: 1e15 }, { f: 1.5 }, { f: 'x' }, { f: 0, o: -5 }, { f: 0, o: 1e400 }, { f: -1e15, h: 'AAAA' }]) {
    const t0 = Date.now();
    const r = readActivity(board, { sources: ['orb'], limit: 5, cursor: enc({ motor: bad }) });
    assert.ok(Date.now() - t0 < 2000, JSON.stringify(bad));
    assert.deepEqual(r.items.map((i) => i.text), clean.items.map((i) => i.text), JSON.stringify(bad));
  }
});

test('a filter that matches no event scans a capped number of rows per call and the cursor reaches the oldest match', () => {
  reset();
  board.event(null, 'claude', 'task.quiet', 'aguja-unica');
  for (let i = 0; i < 6000; i++) board.event(null, 'claude', 'task.quiet', `paja ${i}`);
  const first = {}; const r1 = readActivity(board, { sources: ['subagentes'], q: 'aguja-unica' }, first);
  assert.ok(first.rows <= 5000 + 500, `scanned ${first.rows}`);
  assert.equal(r1.items.length, 0); assert.ok(r1.next, 'more to look at');
  const r2 = readActivity(board, { sources: ['subagentes'], q: 'aguja-unica', cursor: r1.next });
  assert.equal(r2.items.length, 1); assert.equal(r2.next, null);
});
