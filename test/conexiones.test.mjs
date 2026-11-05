// 3.7 (WS9): «Conexiones». Una lista de todo lo conectado, cada persona la suya (el admin, la de todos con solo los
// nombres), las acciones con su comprobación, los eventos, y que nada de connections.* arranca adb nunca.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import cp, { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { tempHome, wait } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { createPerson } from '../src/core/persons.mjs';
import { principalOf } from '../src/core/authz.mjs';
import { POLICY, PHONE_SET, ORB_SET, CONSOLE_SET, eventRule } from '../src/core/policy.mjs';
import { devForwards } from '../src/engine/remote.mjs';
import { serverAllows, SERVER_SETS } from '../src/server/server-product.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { connectionsSink, sshOpen, noteAdbDevices } from '../src/engine/api-connections.mjs';
import { markAdbUsed, adbInUse } from '../src/engine/android.mjs';

// Every program started from here on (spawn, execFile…, also by the modules already loaded: their bindings follow).
const started = [];
for (const fn of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  const orig = cp[fn];
  cp[fn] = function recorded(cmd, ...rest) { started.push(String(cmd)); return orig.call(this, cmd, ...rest); };
}
syncBuiltinESMExports();

const home = tempHome();
after(() => home.cleanup());
const board = new Board();
const ana = board.ownerId();
const leo = createPerson(board, { name: 'Leo' }).id;
const asAna = principalOf(board, { desktop: true });
const asLeo = principalOf(board, { desktop: true, person: leo });
const now = new Date().toISOString();

const revoked = []; const linkCalls = []; const retried = []; const disconnected = [];
const events = [];
const remoteRef = {
  current: {
    devices: () => [
      { id: 'd1', name: 'Móvil de Ana', kind: 'phone', person: ana, online: true, lastSeen: now, ip: '192.168.1.5', confirmed: true },
      { id: 'd2', name: 'Tableta de Leo', kind: 'phone', person: leo, online: false, lastSeen: now, ip: '192.168.1.9', confirmed: true },
      { id: 'd3', name: 'Portátil', kind: 'orb', person: ana, online: true, confirmed: false, role: 'taller' }
    ],
    revoke: (id) => { revoked.push(id); return true; }
  },
  link: {
    peers: () => [
      { id: 'p1', name: 'Servidor de casa', server: true, online: true, person: null, url: 'http://10.0.0.2:3131', remote: { version: '3.7.0' } },
      { id: 'p2', name: 'PC del taller', server: false, online: false, person: null, lastSeen: now }
    ],
    call: async (id, method, params) => {
      linkCalls.push({ id, method, params });
      if (method === 'connections.list') {
        return { self: { version: '3.7.0', memory: { total: 8 * 2 ** 30, free: 3 * 2 ** 30, rss: 90e6 } },
          rows: [
            { id: 'vault:x', source: 'vault', ref: 'x', kind: 'vault', name: 'Bóveda de contraseñas', status: 'online', person: 'ana-server', detail: { server: 'vault.casa' }, actions: ['reconnect'] },
            { id: 'device:s1', source: 'device', ref: 's1', kind: 'phone', name: 'Móvil en el Server', status: 'online', person: 'ana-server', detail: {}, actions: ['revoke'] },
            { id: 'device:app', source: 'device', ref: 'app', kind: 'orb', name: 'Este PC visto desde el Server', status: 'online', person: 'ana-server', detail: {}, actions: ['revoke'] }
          ] };
      }
      return true;
    },
    retry: (id) => { retried.push(id); return true; },
    disconnect: async (id) => { disconnected.push(id); return true; }
  }
};
const api = buildApi({ board, sessions: {}, orchestrator: {}, scheduler: {}, emit: (e, p) => events.push([e, p]), log: () => {}, version: 'test', remoteRef });
const list = (who) => api.call('connections.list', {}, who);

test('el admin ve todo lo conectado: Orb Server con su RAM, dispositivos, Orbs y lo que dice el Server', async () => {
  const { rows, self } = await list(asAna);
  const by = (name) => rows.find((r) => r.name === name);
  assert.ok(self.memory.total > 0);
  const server = by('Servidor de casa');
  assert.equal(server.kind, 'server'); assert.equal(server.status, 'online');
  assert.equal(server.detail.version, '3.7.0'); assert.equal(server.detail.memory.free, 3 * 2 ** 30);
  assert.deepEqual(server.actions, ['disconnect']);
  assert.deepEqual(by('PC del taller').actions, ['reconnect', 'disconnect']);
  assert.equal(by('Portátil').status, 'attention', 'un Orb sin confirmar pide atención');
  assert.equal(by('Móvil de Ana').detail.ip, '192.168.1.5');
  // de otra persona: el nombre y el estado, nunca su dirección
  const leos = by('Tableta de Leo');
  assert.equal(leos.personName, 'Leo'); assert.equal(leos.status, 'offline'); assert.deepEqual(leos.detail, {});
  // lo del Server: marcado como suyo, sin los Orbs (este mismo PC visto desde allí)
  assert.equal(by('Bóveda de contraseñas')?.where, 'server');
  assert.equal(by('Móvil en el Server')?.id, 'server:device:s1');
  assert.equal(by('Este PC visto desde el Server'), undefined);
  assert.ok(linkCalls.some((c) => c.method === 'connections.list' && c.params.nested === true));
  // ordenadas: Orbs primero
  assert.equal(rows[0].kind, 'server');
});

test('cada usuario ve solo lo suyo y no puede cerrar lo de otro', async () => {
  linkCalls.length = 0;
  const { rows, self } = await list(asLeo);
  assert.deepEqual(rows.map((r) => r.name), ['Tableta de Leo']);
  assert.equal(self.memory, undefined, 'la RAM del PC es del admin');
  assert.equal(linkCalls.length, 0, 'el enlace con el Server es del admin');
  await assert.rejects(api.call('connections.close', { kind: 'device', id: 'd1' }, asLeo), /no es tuya|no longer|ya no está/);
  assert.deepEqual(revoked, []);
  await api.call('connections.close', { kind: 'device', id: 'd2' }, asLeo);
  assert.deepEqual(revoked, ['d2']);
  await assert.rejects(api.call('connections.close', { kind: 'device', id: 'x', at: 'server' }, asLeo), /no es tuya/);
});

test('cerrar y reconectar: dispositivos, Orbs, lo del Server y los túneles SSH', async () => {
  await api.call('connections.close', { kind: 'peer', id: 'p1' }, asAna);
  assert.deepEqual(disconnected, ['p1']);
  await api.call('connections.reconnect', { kind: 'peer', id: 'p2' }, asAna);
  assert.deepEqual(retried, ['p2']);
  await api.call('connections.close', { kind: 'device', id: 's1', at: 'server' }, asAna);
  assert.deepEqual(linkCalls.at(-1), { id: 'p1', method: 'connections.close', params: { kind: 'device', id: 's1' } });
  await assert.rejects(api.call('connections.close', { kind: 'nada', id: 'x' }, asAna));
  // Un túnel SSH que Orb abrió (aquí sin abrir ninguna consola): aparece, se cierra, desaparece.
  const child = Object.assign(new EventEmitter(), { pid: null, unref() {} });
  sshOpen({ host: '192.168.1.20', user: 'dani', person: ana }, { spawnFn: () => child });
  let t = (await list(asAna)).rows.find((r) => r.kind === 'tunnel');
  assert.equal(t.name, 'dani@192.168.1.20'); assert.deepEqual(t.actions, ['closeTunnel']);
  assert.equal((await list(asLeo)).rows.some((r) => r.kind === 'tunnel'), false);
  await api.call('connections.close', { kind: 'tunnel', id: t.ref }, asAna);
  t = (await list(asAna)).rows.find((r) => r.kind === 'tunnel');
  assert.equal(t, undefined);
  // y si la consola se cierra sola, también se va
  const child2 = Object.assign(new EventEmitter(), { pid: null, unref() {} });
  sshOpen({ host: '192.168.1.21', user: 'dani' }, { spawnFn: () => child2 });
  assert.ok((await list(asAna)).rows.some((r) => r.kind === 'tunnel'));
  child2.emit('exit', 0);
  assert.equal((await list(asAna)).rows.some((r) => r.kind === 'tunnel'), false);
});

test('connections.* nunca arranca adb: las filas de Android son las guardadas y sin acciones si adb no está en marcha', async () => {
  started.length = 0;
  noteAdbDevices(board, [{ serial: '192.168.1.30:5555', state: 'device', model: 'Pixel 8', wireless: true }, { serial: 'R58M123', state: 'device', model: 'Por cable', wireless: false }]);
  markAdbUsed(); // aunque el usuario lo hubiera usado: en las pruebas adb está apagado (ORB_NO_ADB / agentes de prueba)
  assert.equal(adbInUse(), false);
  const rows = (await list(asAna)).rows.filter((r) => r.kind === 'adb');
  assert.deepEqual(rows.map((r) => r.name), ['Pixel 8'], 'solo los de Wi-Fi');
  assert.equal(rows[0].status, 'offline'); assert.deepEqual(rows[0].actions, []); assert.equal(rows[0].detail.cached, true);
  assert.equal((await list(asLeo)).rows.some((r) => r.kind === 'adb'), false, 'Android es del admin');
  await assert.rejects(api.call('connections.close', { kind: 'adb', id: '192.168.1.30:5555' }, asAna));
  await assert.rejects(api.call('connections.reconnect', { kind: 'adb', id: '192.168.1.30:5555' }, asAna));
  await api.call('android.devices', {}, asAna);
  for (let i = 0; i < 3; i++) await list(asAna);
  assert.deepEqual(started.filter((c) => /adb/i.test(c)), [], `programas: ${started.join(', ')}`);
  assert.deepEqual(started, [], 'connections.list no arranca nada (tampoco Tailscale en las pruebas)');
  // (y el registro de verdad ve lo que se arranca, también por los nombres importados de otros módulos)
  execFileSync(process.execPath, ['-e', '0'], { windowsHide: true });
  assert.equal(started.length, 1);
});

test('Tailscale y Home Assistant: su estado, solo para el admin', async () => {
  process.env.ORB_FAKE_TAILSCALE = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.tail1234.ts.net.', TailscaleIPs: ['100.101.102.103'] } });
  try {
    let ts = (await list(asAna)).rows.find((r) => r.kind === 'tailscale');
    assert.equal(ts.status, 'online'); assert.equal(ts.detail.dns, 'pc.tail1234.ts.net');
    process.env.ORB_FAKE_TAILSCALE = JSON.stringify({ BackendState: 'NeedsLogin' });
    ts = (await list(asAna)).rows.find((r) => r.kind === 'tailscale');
    assert.equal(ts.status, 'attention'); assert.equal(ts.detail.why, 'tailscaleLogin');
    assert.equal((await list(asLeo)).rows.some((r) => r.kind === 'tailscale'), false);
  } finally { delete process.env.ORB_FAKE_TAILSCALE; }
  assert.equal((await list(asAna)).rows.some((r) => r.kind === 'ha'), false, 'sin Home Assistant configurado, no hay fila');
});

test('reglas: los métodos y su evento, desde el móvil y en el Server, nunca reenviados al taller', async () => {
  for (const m of ['connections.list', 'connections.close', 'connections.reconnect']) {
    assert.ok(POLICY[m], m);
    assert.ok(PHONE_SET.has(m) && ORB_SET.has(m) && CONSOLE_SET.has(m), m);
    assert.equal(devForwards(m), false, m);
    assert.ok(serverAllows(m) && SERVER_SETS.orb.has(m) && SERVER_SETS.phone.has(m), m);
  }
  assert.equal(eventRule('connections:changed'), 'all');
  // el aviso llega solo una vez, poco después, cuando cambian los enlaces
  const got = [];
  const sink = connectionsSink((e) => got.push(e));
  sink('link:devices', []); sink('link:peers', []); sink('browser:live', { data: 'x' });
  await wait(450);
  assert.deepEqual(got, ['connections:changed']);
});
