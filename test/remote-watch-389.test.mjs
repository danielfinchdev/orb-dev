// The watcher that keeps the phone entries open (src/engine/transport/remote-watch.mjs), with fake clocks, a fake network and
// a fake Tailscale: nothing real is asked, and what already works is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkWatcher, WATCH_MS } from '../src/engine/transport/remote-watch.mjs';

function rig(over = {}) {
  const w = { clock: 1_000_000, lan: '192.168.1.5', openedLan: '192.168.1.5', adapter: false, tsOpen: false, served: false, alive: true, calls: [], logs: [], failOpen: false, ...over };
  const d = {
    every: WATCH_MS, now: () => w.clock, log: (m) => w.logs.push(m),
    wifiOn: () => true, tailscaleOn: () => w.tsOn ?? true,
    lanKey: () => w.lan, openedLan: () => w.openedLan,
    tsOpen: () => w.tsOpen, tsServed: () => w.served, tsAdapter: () => { w.calls.push('adapter'); return w.adapter; },
    reopenWifi: async () => { w.calls.push('reopenWifi'); w.openedLan = w.lan; },
    openTailscale: async () => { w.calls.push('openTailscale'); if (!w.failOpen) { w.tsOpen = true; w.served = true; } },
    tsServeAlive: async () => { w.calls.push('serveAlive'); return w.alive; },
    reserve: async () => { w.calls.push('reserve'); return true; },
    seen: (kind) => w.calls.push(`seen:${kind}`),
  };
  const lw = createLinkWatcher(d);
  const tick = async (ms = WATCH_MS) => { w.clock += ms; await lw.tick(); };
  const only = (...names) => w.calls.filter((c) => names.includes(c));
  return { w, tick, only };
}

test('Tailscale que llega tarde: sin adaptador no se pregunta nada, y cuando aparece se abre solo su entrada', async () => {
  const { w, tick, only } = rig();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(only('openTailscale', 'reopenWifi', 'reserve', 'serveAlive'), [], 'sin Tailscale no se lanza nada caro');
  w.adapter = true;
  await tick();
  assert.deepEqual(only('openTailscale', 'reopenWifi'), ['openTailscale'], 'se abre Tailscale y la Wi-Fi no se toca');
  await tick(); await tick();
  assert.equal(only('openTailscale').length, 1, 'abierta, no se vuelve a abrir');
});

test('si abrir Tailscale falla, espera un minuto antes de volver a intentarlo', async () => {
  const { w, tick, only } = rig({ adapter: true, failOpen: true });
  await tick();
  await tick(); await tick(); await tick(); // 15, 30 and 45 s later
  assert.equal(only('openTailscale').length, 1);
  await tick();
  assert.equal(only('openTailscale').length, 2, 'a los 60 s lo intenta otra vez');
  w.failOpen = false; await tick(60_000);
  assert.equal(w.tsOpen, true);
});

test('si cambia la IP de la Wi-Fi se rehace solo esa entrada', async () => {
  const { w, tick, only } = rig({ tsOpen: true, served: false });
  w.lan = '192.168.1.77';
  await tick();
  assert.deepEqual(only('reopenWifi', 'openTailscale', 'reserve'), ['reopenWifi']);
  await tick();
  assert.deepEqual(only('reopenWifi'), ['reopenWifi'], 'ya está al día');
});

test('si no cambia nada no toca nada, y `serve` se mira cada minuto como mucho', async () => {
  const { w, tick, only } = rig({ tsOpen: true, served: true });
  await tick(); // first look
  for (let i = 0; i < 8; i++) await tick(); // two more minutes
  assert.deepEqual(only('openTailscale', 'reopenWifi', 'reserve'), []);
  assert.ok(only('serveAlive').length <= 3, `serve mirado ${only('serveAlive').length} veces en 135 s`);
  assert.ok(only('seen:wifi').length >= 8, 'y la entrada se da por buena');
  assert.equal(w.logs.length, 0, 'sin ruido en el registro');
});

test('si `tailscale serve` se perdió lo rehace; si no se sabe, no toca', async () => {
  const { w, tick, only } = rig({ tsOpen: true, served: true });
  w.alive = null; await tick(60_000);
  assert.deepEqual(only('reserve'), [], 'respuesta dudosa: nada');
  w.alive = false; await tick(60_000);
  assert.deepEqual(only('reserve'), ['reserve']);
  assert.ok(w.logs.some((l) => /serve/.test(l)));
});

test('un salto de reloj (suspensión) comprueba todo al momento', async () => {
  const { w, tick, only } = rig({ tsOpen: true, served: true });
  await tick();
  const before = only('serveAlive').length;
  w.alive = false;
  await tick(10 * 60_000); // the PC slept ten minutes
  assert.equal(only('serveAlive').length, before + 1);
  assert.deepEqual(only('reserve'), ['reserve']);
  assert.ok(w.logs.some((l) => /reloj/.test(l)));
  // and a Tailscale that is not open is asked about even if its adapter is not seen yet
  const r2 = rig();
  await r2.tick(10 * 60_000);
  assert.deepEqual(r2.only('openTailscale'), ['openTailscale']);
});

test('con Tailscale apagado en los ajustes no se mira', async () => {
  const { tick, only } = rig({ adapter: true, tsOn: false });
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(only('openTailscale', 'adapter'), []);
});

test('dos vueltas a la vez no se pisan', async () => {
  const { w, only } = rig({ adapter: true });
  let release; const gate = new Promise((r) => { release = r; });
  const d = { every: WATCH_MS, now: () => w.clock, log: () => {}, wifiOn: () => false, tailscaleOn: () => true, lanKey: () => '', openedLan: () => '', tsOpen: () => false, tsServed: () => false, tsAdapter: () => true,
    reopenWifi: async () => {}, openTailscale: async () => { w.calls.push('openTailscale'); await gate; }, tsServeAlive: async () => true, reserve: async () => true, seen: () => {} };
  const lw = createLinkWatcher(d);
  w.clock += WATCH_MS;
  const a = lw.tick(); w.clock += WATCH_MS; const b = lw.tick();
  release(); await Promise.all([a, b]);
  assert.equal(only('openTailscale').length, 1);
});
