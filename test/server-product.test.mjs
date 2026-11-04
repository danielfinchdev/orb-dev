// 3.7 (WS1), Orb Server as a product of its own: its engine never loads programming, its API and its ceilings have no
// programming methods, it runs in one Node process (in-process host), and no agent may raise its privileges.
import { tempHome, until, ROOT } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { closure } from '../scripts/dist-servidor.mjs';
import { PROGRAMMING_MODULES, PROGRAMMING_METHOD, SERVER_SETS, serverAllows, serverCeiling, stripProgramming } from '../src/server/server-product.mjs';
import { PHONE_SET, policyOf } from '../src/core/policy.mjs';
import { escalates, decide } from '../src/core/guard.mjs';
import { createHost, prepareHome, defaultHome } from '../src/server/host.mjs';
import { watchdogInterval, startWatchdog } from '../src/server/watchdog.mjs';

test('el motor del Server no carga ningún módulo de programación', () => {
  const loaded = closure(ROOT, ['src/server/engine-server.mjs', 'src/server/orb-server.mjs']);
  assert.ok(loaded.includes('src/server/api-server.mjs') && loaded.includes('src/engine/bots.mjs') && loaded.includes('src/engine/remote.mjs'));
  for (const m of PROGRAMMING_MODULES) assert.ok(!loaded.includes(m), `${m} no debe cargarse en el Server`);
  // and engine-server reaches the API only through src/server/api-server.mjs
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src', 'server', 'engine-server.mjs'), 'utf8'), /(import\s*\(|from)\s*['"][^'"]*(engine\/api\.mjs|engine\/engine\.mjs|scheduler)/);
});

test('las listas de lo permitido en el Server no tienen métodos de programación', () => {
  for (const [name, set] of Object.entries(SERVER_SETS)) for (const m of set) assert.ok(!PROGRAMMING_METHOD.test(m) && serverAllows(m), `${name}: ${m}`);
  assert.ok(SERVER_SETS.phone.has('bots.chat') && SERVER_SETS.phone.has('inbox.list'));
  assert.ok(!SERVER_SETS.phone.has('chat.send') && !SERVER_SETS.phone.has('tasks.create') && !SERVER_SETS.phone.has('whiteboard.save'));
  assert.ok(SERVER_SETS.console.has('server.update.apply') && SERVER_SETS.control.has('link.connect'));
  assert.ok(stripProgramming(PHONE_SET).size < PHONE_SET.size);
  assert.equal(serverCeiling({ channel: 'phone' }), SERVER_SETS.phone);
  assert.equal(serverCeiling({ channel: 'phone', rights: { admin: true } }), SERVER_SETS.console);
  assert.equal(serverCeiling({ channel: 'system' }), null);
  for (const m of ['taller.tasks.list', 'bots.send', 'agents.login', 'server.status', 'backup.now']) assert.ok(serverAllows(m), m);
  for (const m of ['chat.send', 'tasks.list', 'expert.tree', 'opti.stats', 'agents.install', 'projects.list', 'usage.now']) assert.ok(!serverAllows(m), m);
});

test('nadie sube sus permisos: sudo y el ayudante de administración se deniegan, también con permiso total', () => {
  for (const c of ['sudo apt-get clean', 'ls && sudo -n true', 'echo x | doas sh', 'pkexec bash', 'su -c id', 'x; su root', '$(sudo id)', '/usr/local/libexec/orb-server-admin apt-clean', 'cat /etc/sudoers']) assert.ok(escalates(c), c);
  for (const c of ['git commit -m "fix su bug"', 'echo pseudo', 'suspend', 'npm test', 'resume.sh']) assert.ok(!escalates(c), c);
  for (const permission of ['total', 'editar', 'preguntar']) assert.equal(decide({ permission, tool: 'Bash', command: 'sudo systemctl restart nginx' }).decision, 'deny', permission);
});

test('el host del Server en un solo proceso: bots sí, programación no; y su vigilante de systemd', async () => {
  const t = tempHome();
  const home = prepareHome(path.join(t.base, 'orb-server'));
  const host = createHost({ home, version: '3.7.0', env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  assert.equal(host.mode, 'inproc');
  try {
    const info = await host.start();
    assert.equal(info.product, 'server');
    assert.equal(host.pid, process.pid, 'el motor corre en el mismo proceso');
    const s = await host.call('app.state');
    assert.equal(s.product, 'server'); assert.equal(s.layout, 'server');
    assert.ok(Array.isArray((await host.call('bots.list')).bots));
    for (const m of ['conversations.list', 'chat.send', 'tasks.list', 'schedules.list', 'expert.tree', 'agents.install']) await assert.rejects(host.call(m, {}), /servidor/, m);
    const st = await host.call('server.status');
    assert.equal(st.product, 'server');
    assert.deepEqual(st.engines.map((e) => e.id), ['claude', 'codex']);
    assert.ok(st.memory.rss > 0);
    // the server's own methods are the owner's: a control call (the server's console) may see them
    assert.ok(Array.isArray(await host.call('server.engines', {}, { as: 'control' })));
    await until(async () => (await host.call('remote.status')).running, 'acceso remoto');
  } finally {
    const r = await host.stop();
    assert.equal(r.clean, true);
    t.cleanup();
  }
  // The watchdog: only under systemd (NOTIFY_SOCKET + WATCHDOG_USEC), at half the interval, only while healthy.
  assert.equal(watchdogInterval({}), null);
  assert.equal(watchdogInterval({ NOTIFY_SOCKET: '/run/x', WATCHDOG_USEC: '180000000' }), 90_000);
  assert.equal(watchdogInterval({ NOTIFY_SOCKET: '/run/x', WATCHDOG_USEC: '1000000', WATCHDOG_PID: '1' }, 2), null);
  const sent = [];
  let ok = true;
  const w = startWatchdog({ env: { NOTIFY_SOCKET: '/run/x', WATCHDOG_USEC: '2000000' }, healthy: async () => ok, notify: (m) => sent.push(m) });
  await until(() => sent.includes('WATCHDOG=1'), 'latido');
  ok = false; const before = sent.filter((m) => m === 'WATCHDOG=1').length;
  await new Promise((r) => setTimeout(r, 2300));
  w.stop();
  assert.equal(sent[0], 'READY=1');
  assert.equal(sent.filter((m) => m === 'WATCHDOG=1').length, before, 'sin latido mientras el motor no contesta');
  // ~/orb-server by default; ~/orb only for an install from before 3.7 not migrated yet
  assert.equal(defaultHome({}, path.join(t.base, 'nadie')), path.join(t.base, 'nadie', 'orb-server'));
  assert.equal(defaultHome({ ORB_HOME: path.join(t.base, 'x') }), path.join(t.base, 'x'));
});

test('cada método del API del Server tiene su regla de permisos', async () => {
  const t = tempHome();
  try {
    const { Board } = await import('../src/core/board.mjs');
    const { buildServerApi } = await import('../src/server/api-server.mjs');
    const board = new Board();
    const api = buildServerApi({ board, emit: () => {}, log: () => {}, version: 'test' });
    const names = api.methodNames();
    assert.ok(names.length > 60, `${names.length}`);
    for (const m of names) { assert.ok(policyOf(m), `sin regla: ${m}`); assert.ok(serverAllows(m), m); assert.ok(!PROGRAMMING_METHOD.test(m), m); }
    board.db.close();
  } finally { t.cleanup(); }
});
