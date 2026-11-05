// 3.7: «Nueva versión disponible» for the app and «Orb Server {v} disponible» for the linked Server
// (src/ui/lib/server-update.js, src/ui/components/update-card.jsx): when the app asks the Server, when the card shows and
// which refusals hide it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as U from '../src/ui/lib/server-update.js';
import { createT } from '../src/core/i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linked = { linked: true, peer: { id: 'p1', name: 'casa-srv', online: true, features: [] } };
const now = Date.parse('2026-11-05T12:00:00Z');
const status = { version: '3.7.0', available: { version: '3.8.0', name: 'orb-server-3.8.0-linux-x64.tar.gz' }, checkedAt: new Date(now - 3600_000).toISOString(), applying: false, appDir: '/opt/orb-server/app', signed: true };

test('se pregunta al Server si nunca miró o hace mucho; no mientras se actualiza ni sin actualizador', () => {
  assert.equal(U.needsCheck(null, now), false, 'sin actualizador no hay nada que mirar');
  assert.equal(U.needsCheck({ ...status, checkedAt: null }, now), true);
  assert.equal(U.needsCheck(status, now), false, 'miró hace una hora');
  assert.equal(U.needsCheck({ ...status, checkedAt: new Date(now - U.STALE_MS - 1).toISOString() }, now), true);
  assert.equal(U.needsCheck({ ...status, checkedAt: null, applying: true }, now), false);
  assert.ok(U.POLL_MS >= 3600_000, 'una frecuencia baja');
});

test('la tarjeta del Server: solo con un Server enlazado y en línea, instalado, con versión nueva y no ocultada', () => {
  assert.deepEqual(U.serverOffer({ server: linked, status }), { version: '3.8.0', applying: false });
  assert.deepEqual(U.serverOffer({ server: linked, status: { ...status, applying: true } }), { version: '3.8.0', applying: true });
  assert.equal(U.serverOffer({ server: null, status }), null);
  assert.equal(U.serverOffer({ server: { linked: false }, status }), null);
  assert.equal(U.serverOffer({ server: { ...linked, peer: { ...linked.peer, online: false } }, status }), null, 'sin conexión no se ofrece');
  assert.equal(U.serverOffer({ server: { linked: true, direct: true, peer: { online: true } }, status }), null, 'en el propio Server no');
  assert.equal(U.serverOffer({ server: linked, status: { ...status, available: null } }), null, 'ya está al día');
  assert.equal(U.serverOffer({ server: linked, status: { ...status, appDir: null } }), null, 'una copia sin instalar no se actualiza sola');
  assert.equal(U.serverOffer({ server: linked, status, hidden: '3.8.0' }), null, 'la X la oculta para esa versión');
  assert.ok(U.serverOffer({ server: linked, status: { ...status, available: { version: '3.9.0' } }, hidden: '3.8.0' }), 'una versión más nueva vuelve a salir');
  assert.equal(U.serverOffer({ server: linked, status, denied: true }), null, 'quien no puede administrarlo no la ve');
  assert.equal(U.serverOffer(), null);
});

test('un rechazo del Server (403 o su texto, también envuelto por el puente) oculta la tarjeta; otros errores no', () => {
  const t = createT('es');
  const texts = [t('msg.authz.ownerOnly'), t('msg.remote.pcOnly')];
  assert.equal(U.isDenied(Object.assign(new Error('x'), { status: 403 }), texts), true);
  assert.equal(U.isDenied(new Error(`Error invoking remote method 'orb:call': Error: ${texts[0]}`), texts), true);
  assert.equal(U.isDenied(new Error('fetch failed'), texts), false);
  assert.equal(U.isDenied(null, texts), false);
});

test('los textos: «Nueva versión disponible X», «Descargar e instalar», «Orb Server X disponible» (es y en)', () => {
  const es = createT('es');
  const en = createT('en');
  assert.equal(es('update.title', { version: '3.8.0' }), 'Nueva versión disponible 3.8.0');
  assert.equal(es('update.update'), 'Descargar e instalar');
  assert.equal(es('update.restart'), 'Reiniciar e instalar');
  assert.equal(es('server.updateCardTitle', { v: '3.8.0' }), 'Orb Server 3.8.0 disponible');
  assert.equal(es('server.updateApply'), 'Actualizar el Server');
  assert.equal(en('update.title', { version: '3.8.0' }), 'New version available 3.8.0');
  assert.equal(en('update.update'), 'Download and install');
  for (const k of ['update.available', 'update.availablePortable', 'server.updateCardHint', 'server.updateCardBusy', 'server.updateFailed']) {
    assert.notEqual(es(k), k, `es: ${k}`); assert.notEqual(en(k), k, `en: ${k}`);
  }
});

test('las dos tarjetas van juntas arriba a la derecha, solo en el PC (como la de la app)', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src/ui/main.jsx'), 'utf8');
  assert.match(main, /bridge\.mobile \? null : <><UpdateCards \/>/);
  const card = fs.readFileSync(path.join(ROOT, 'src/ui/components/update-card.jsx'), 'utf8');
  assert.match(card, /<UpdateCard \/>\s*<ServerUpdateCard \/>/);
  for (const m of ['server.update.status', 'server.update.check', 'server.update.apply']) assert.ok(card.includes(`serverCall('${m}'`), m);
});
