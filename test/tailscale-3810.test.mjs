// 3.8.10: Tailscale as Orb's «account». Invented data only: the shape of `tailscale status --json`, never a real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { parseTailscaleStatus, tailscaleInfo, tailscaleLogin, markLinked } from '../src/engine/transport/tailscale-status.mjs';

const STATUS = {
  BackendState: 'Running',
  Self: { HostName: 'torre', DNSName: 'torre.example-tailnet.ts.net.', OS: 'windows', Online: true, UserID: 7, TailscaleIPs: ['100.64.0.1', 'fd7a:115c:a1e0::1'] },
  CurrentTailnet: { Name: 'persona@example.com', MagicDNSSuffix: 'example-tailnet.ts.net' },
  User: { 7: { LoginName: 'persona@example.com', DisplayName: 'Persona' } },
  Peer: {
    k1: { HostName: 'movil', DNSName: 'movil.example-tailnet.ts.net.', OS: 'android', Online: true, TailscaleIPs: ['100.64.0.2'], LastSeen: '0001-01-01T00:00:00Z' },
    k2: { HostName: 'portatil', DNSName: 'portatil.example-tailnet.ts.net.', OS: 'macOS', Online: false, TailscaleIPs: ['100.64.0.3'], LastSeen: '2026-11-20T10:00:00Z' },
    k3: { HostName: 'tablet', DNSName: 'tablet.example-tailnet.ts.net.', OS: 'iOS', Online: true, TailscaleIPs: ['100.64.0.4'] }
  }
};

test('lee la lista de dispositivos: nombre, sistema, en línea y última conexión', () => {
  const r = parseTailscaleStatus(JSON.stringify(STATUS));
  assert.equal(r.state, 'running');
  assert.equal(r.self.dns, 'torre.example-tailnet.ts.net');
  assert.equal(r.account, 'persona@example.com');
  assert.deepEqual(r.devices.map((d) => [d.name, d.os, d.online]), [['movil', 'android', true], ['tablet', 'ios', true], ['portatil', 'macos', false]]);
  assert.equal(r.devices[2].lastSeen, '2026-11-20T10:00:00Z');
  assert.equal(r.devices[0].lastSeen, null, 'la fecha cero de Tailscale no es una conexión');
});

test('sesión sin iniciar, parado, sin instalar y basura', async () => {
  assert.equal(parseTailscaleStatus({ BackendState: 'NeedsLogin' }).state, 'needsLogin');
  assert.equal(parseTailscaleStatus({ BackendState: 'Stopped' }).state, 'stopped');
  assert.equal(parseTailscaleStatus('no es json').state, 'unknown');
  assert.equal((await tailscaleInfo({ exec: async () => ({ ok: false, missing: true, out: '' }) })).installed, false);
  assert.equal((await tailscaleInfo({ exec: async () => ({ ok: false, out: JSON.stringify({ BackendState: 'NeedsLogin' }) }) })).state, 'needsLogin', 'status sale con error mientras no hay sesión y aun así informa');
  assert.equal((await tailscaleInfo({ exec: async () => ({ ok: true, out: JSON.stringify(STATUS) }) })).devices.length, 3);
});

test('iniciar sesión solo acepta la página de Tailscale y no toca nada más', async () => {
  const calls = [];
  const ok = await tailscaleLogin({ exec: async (args) => { calls.push(args); return { ok: true, url: 'https://login.tailscale.com/a/abc123' }; } });
  assert.deepEqual(ok, { started: true, url: 'https://login.tailscale.com/a/abc123' });
  assert.deepEqual(calls, [['up']]);
  assert.equal((await tailscaleLogin({ exec: async () => ({ ok: true, url: 'https://evil.example/a/abc' }) })).url, null, 'una dirección ajena no se abre');
  assert.equal((await tailscaleLogin({ exec: async () => ({ ok: false, missing: true }) })).missing, true);
});

test('marca los móviles enlazados a Orb por dirección o, si no, por nombre', () => {
  const devices = parseTailscaleStatus(STATUS).devices;
  const marked = markLinked(devices, [{ name: 'Mi móvil', ip: '100.64.0.2' }, { name: 'Tablet', ip: '127.0.0.1' }]);
  assert.deepEqual(marked.map((d) => [d.name, d.orbDevice]), [['movil', 'Mi móvil'], ['tablet', 'Tablet'], ['portatil', null]]);
});

test('estar en la tailnet no enlaza: ni el módulo ni el método de la lista tocan el emparejamiento ni la clave', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/engine/transport/tailscale-status.mjs'), 'utf8');
  assert.doesNotMatch(src, /(^|[^a-z])pair[(]|public_key|saveConfig|devices SET|INSERT/i);
  assert.doesNotMatch(src, /\blog\(|console\./, 'sin registros: ni IP ni correo');
  const link = fs.readFileSync(path.join(ROOT, 'src/engine/api/link.mjs'), 'utf8');
  const m = link.slice(link.indexOf("'tailscale.status'"), link.indexOf("'remote.pair'"));
  assert.doesNotMatch(m, /pair\(|revoke|rename/);
  const perms = fs.readFileSync(path.join(ROOT, 'src/domain/security/permissions.mjs'), 'utf8');
  assert.match(perms, /'tailscale\.status': 'pc', 'tailscale\.login': 'pc'/, 'solo este PC, nunca un móvil');
});
