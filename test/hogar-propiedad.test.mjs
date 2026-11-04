// 3.7 (WS3): a property test of one home per bot. Two engines on loopback (a Server and a PC) and one bot; a seeded
// random run of moves, messages from both sides, crashes (kill -9) in the middle of anything, restarts and forced
// takeovers. When both are on again and settled: exactly one of them runs the bot, both agree on where and with which
// epoch, both have the same chat lines (by uid), and every message that was accepted is there exactly once.
// ORB_PROP_SEED=<n> repeats one run; ORB_PROP_STEPS=<n> makes it longer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine, until, wait, ROOT } from './helpers.mjs';
import { paths } from '../src/core/home.mjs';
import { orbIdOf } from '../src/core/backup.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const env = { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1', ORB_REPLICA_MS: '400', ORB_MOVE_TURN_MS: '800', ORB_FORWARD_MS: '5000' };
const SEED = Number(process.env.ORB_PROP_SEED) || (Date.now() % 100000);
const STEPS = Number(process.env.ORB_PROP_STEPS) || 16;
const rand = (() => { let a = SEED >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const pick = (list) => list[Math.floor(rand() * list.length)];
const rows = (home, sql, ...args) => { const d = new DatabaseSync(paths(home).db); d.exec('PRAGMA busy_timeout = 8000'); try { return d.prepare(sql).all(...args); } finally { d.close(); } };
let port; const side = {}; const tmp = [];
const key = (s) => orbIdOf(s.t.home).orbId;

async function up(s) { if (s.e) return; s.e = await startEngine(s.t.home, { env }); }
async function crash(s) { if (!s.e) return; const e = s.e; s.e = null; await e.kill(); }
const other = (s) => (s === side.srv ? side.pc : side.srv);
// Where s thinks the bot is not: a move from s goes there (from its home, or asked to its home from the copy).
const away = (s, uid) => { const r = rows(s.t.home, 'SELECT home FROM bots WHERE uid = ?', uid)[0]; return r?.home === key(side.srv) ? key(side.pc) : key(side.srv); };
const row = (s, uid) => rows(s.t.home, 'SELECT id, home, home_epoch, home_state FROM bots WHERE uid = ?', uid)[0];
const userLines = (s, uid) => rows(s.t.home, "SELECT c.uid, c.body FROM chat c JOIN conversations v ON v.id = c.conversation_id JOIN bots b ON b.id = v.bot_id WHERE b.uid = ? AND c.role = 'usuario'", uid);
const allLines = (s, uid) => rows(s.t.home, 'SELECT c.uid FROM chat c JOIN conversations v ON v.id = c.conversation_id JOIN bots b ON b.id = v.bot_id WHERE b.uid = ? ORDER BY c.uid', uid).map((r) => r.uid);
const waiting = (s) => rows(s.t.home, "SELECT COUNT(*) AS n FROM link_queue WHERE status = 'pendiente-hogar'")[0].n;

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  port = 20000 + Math.floor(Math.random() * 20000);
  side.srv = { name: 'srv', t: tempHome({ role: 'centro', mobile: { enabled: true, port, name: 'Servidor' } }) };
  side.pc = { name: 'pc', t: tempHome({ mobile: { name: 'Portátil' } }) };
  tmp.push(side.srv.t, side.pc.t);
  await up(side.srv); await up(side.pc);
  await until(async () => (await side.srv.e.call('remote.status')).running, 'acceso del servidor');
  const q = await side.srv.e.call('link.qr', { device: 'orb' });
  await side.pc.e.call('link.connect', { code: q.code, address: `127.0.0.1:${port}` });
  for (const s of [side.srv, side.pc]) await until(async () => (await s.e.call('bots.homes')).some((h) => h.key === key(other(s)) && h.online), `${s.name} ve al otro`, 20000);
});
after(async () => {
  for (const s of [side.srv, side.pc]) await s?.e?.stop();
  for (const t of tmp) t.cleanup();
});

test(`un solo Orb ejecuta el bot, sin líneas perdidas ni repetidas (semilla ${SEED})`, { timeout: 400_000 }, async () => {
  const bot = await side.pc.e.call('bots.create', { name: 'Prueba', tools: [] });
  const uid = bot.uid;
  const accepted = new Set(); let n = 0; const trace = [];
  const idOn = (s) => row(s, uid)?.id;
  await until(() => idOn(side.srv), 'la copia en el Server', 20000);
  const send = async (s) => {
    const text = `m-${++n}`;
    try { await s.e.call('bots.send', { id: idOn(s), text }); accepted.add(text); trace.push(`${s.name} envía ${text}`); }
    catch (error) { trace.push(`${s.name} no envía ${text}: ${error.message}`); }
  };
  for (let i = 0; i < STEPS; i++) {
    const live = [side.srv, side.pc].filter((s) => s.e);
    const s = pick(live);
    const op = pick(['send', 'send', 'move', 'move', 'crash', 'crashDuringMove', 'takeover', 'restart']);
    try {
      if (op === 'send') await send(s);
      else if (op === 'move') {
        const r = await s.e.call('bots.move', { id: idOn(s), to: away(s, uid) }).catch((e) => ({ error: e.message }));
        trace.push(`${s.name} pasa al otro: ${JSON.stringify(r).slice(0, 120)}`);
      } else if (op === 'crash' && live.length === 2) { await crash(s); trace.push(`${s.name} se cae`); }
      else if (op === 'crashDuringMove' && live.length === 2) {
        const mover = pick(live); const victim = pick(live);
        const p = mover.e.call('bots.move', { id: idOn(mover), to: away(mover, uid) }).catch((e) => ({ error: e.message }));
        await wait(Math.floor(rand() * 400));
        await crash(victim); trace.push(`${mover.name} pasa y ${victim.name} se cae en medio`);
        if (victim !== mover) trace.push(`  → ${JSON.stringify(await p).slice(0, 120)}`);
      } else if (op === 'takeover' && live.length === 1) {
        const r = await s.e.call('bots.move', { id: idOn(s), to: 'here', force: true }).catch((e) => ({ error: e.message }));
        trace.push(`${s.name} toma el control: ${JSON.stringify(r).slice(0, 120)}`);
        await send(s);
      } else if (op === 'restart') {
        for (const x of [side.srv, side.pc]) if (!x.e) { await up(x); trace.push(`${x.name} vuelve`); }
      } else await send(s);
    } catch (error) { trace.push(`${s.name} ${op}: ${error.message}`); }
    await wait(150 + Math.floor(rand() * 300));
  }
  for (const x of [side.srv, side.pc]) if (!x.e) { await up(x); trace.push(`${x.name} vuelve`); }
  const settled = () => {
    const a = row(side.srv, uid); const b = row(side.pc, uid);
    if (!a || !b) return false;
    const runners = [side.srv, side.pc].filter((s) => row(s, uid).home === key(s)).length;
    return runners === 1 && a.home === b.home && a.home_epoch === b.home_epoch && a.home_state === 'active' && b.home_state === 'active'
      && waiting(side.srv) === 0 && waiting(side.pc) === 0 && allLines(side.srv, uid).join() === allLines(side.pc, uid).join()
      && [...accepted].every((t) => userLines(side.srv, uid).some((l) => l.body.endsWith(t)));
  };
  try { await until(settled, 'los dos de acuerdo', 60_000); }
  catch (error) {
    const st = [side.srv, side.pc].map((s) => ({ name: s.name, key: key(s).slice(0, 6), row: row(s, uid), lines: allLines(s, uid).length, waiting: waiting(s) }));
    throw new Error(`${error.message}\n${JSON.stringify(st)}\n${trace.join('\n')}`);
  }
  if (process.env.ORB_PROP_TRACE) console.log(`${trace.join('\n')}\nfinal: ${JSON.stringify([side.srv, side.pc].map((x) => row(x, uid)))}`);
  // Exactly one executor; both the same; every accepted message once in each.
  for (const s of [side.srv, side.pc]) {
    const users = userLines(s, uid);
    for (const t of accepted) assert.equal(users.filter((l) => l.body === t || l.body.endsWith(` ${t}`) || l.body === t).length, 1, `${t} una vez en ${s.name}\n${trace.join('\n')}`);
    assert.equal(new Set(users.map((l) => l.uid)).size, users.length, 'sin uids repetidos');
  }
  const home = row(side.pc, uid).home;
  assert.ok([key(side.srv), key(side.pc)].includes(home));
  // The one that runs it answers.
  const runner = home === key(side.srv) ? side.srv : side.pc;
  const before = allLines(runner, uid).length;
  await runner.e.call('bots.send', { id: idOn(runner), text: 'último' });
  await until(() => allLines(runner, uid).length >= before + 2, 'contesta quien lo ejecuta', 20000);
});
