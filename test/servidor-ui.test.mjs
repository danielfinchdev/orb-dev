// 3.7 (WS4): the pure pieces of Orb Server in the interface (src/ui/lib/homes.js): where a bot runs and its badge, what can
// be done with a copy, the migration wizard's three choices and its report, who is who, the guide's steps, the
// «Reconectar Claude en el Server» banner and the phone's reminders (one per uid, only the ones its Orb rings).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../src/ui/lib/homes.js';
import { createT } from '../src/core/i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = createT('es');
const here = { id: 1, name: 'Agenda', uid: 'u1', homeKind: 'here', homeHere: true, homeName: 'Este PC', homeOnline: true, readOnly: false, homeState: 'active', home: 'pc' };
const server = { id: 2, name: 'Compras', uid: 'u2', homeKind: 'server', homeHere: false, homeName: 'casa-srv', homeOnline: true, readOnly: true, homeState: 'active', home: 'srv', agent: 'claude' };
const offline = { ...server, id: 3, name: 'Correo', uid: 'u3', homeOnline: false, queued: 2, agent: 'codex' };
const archived = { ...server, id: 4, name: 'Viejo', uid: 'u4', homeState: 'archived', homeKnown: false };
const homes = [{ key: 'pc', name: 'Este PC', here: true, online: true, server: false }, { key: 'srv', name: 'casa-srv', here: false, online: true, server: true, brains: ['claude', 'codex'] }];

test('una sola lista: la insignia dice dónde se ejecuta cada bot y si ese Orb responde', () => {
  assert.deepEqual(H.badgeOf(here, t), { kind: 'here', text: 'Este PC', offline: false });
  assert.deepEqual(H.badgeOf(server, t), { kind: 'server', text: 'Server', offline: false });
  assert.equal(H.badgeOf(offline, t).offline, true);
  // A bot of before 3.7 (no home fields) runs here; badges only once bots can run in two places.
  assert.equal(H.homeOf({ id: 9 }).here, true);
  assert.equal(H.showHomeBadges([here], false), false);
  assert.equal(H.showHomeBadges([here], true), true);
  assert.equal(H.showHomeBadges([here, server], false), true);
});

test('la copia de un bot: se habla con él (en cola si su Orb no responde), se cambia solo con su Orb encendido', () => {
  assert.deepEqual(H.replicaActions(here), { talk: true, change: true, move: true, restore: false, takeover: false, queued: false });
  const on = H.replicaActions(server);
  assert.equal(on.talk, true); assert.equal(on.change, true); assert.equal(on.queued, false);
  const off = H.replicaActions(offline);
  assert.equal(off.talk, true); assert.equal(off.change, false, 'sin cambios mientras su Orb no responde'); assert.equal(off.queued, true); assert.equal(off.takeover, true);
  const gone = H.replicaActions(archived);
  assert.equal(gone.talk, false); assert.equal(gone.change, false); assert.equal(gone.restore, true);
  assert.equal(H.homeOf(offline).queued, 2);
});

test('«Pasar al Server» / «Pasar a este PC»: los destinos sin el Orb donde ya está', () => {
  const toServer = H.moveTargets(here, homes);
  assert.deepEqual(toServer.map((x) => x.key), ['srv']);
  assert.equal(H.moveLabel(toServer[0], t), 'Pasar al Server');
  const toPc = H.moveTargets(server, homes);
  assert.deepEqual(toPc.map((x) => x.key), ['here']);
  assert.equal(H.moveLabel(toPc[0], t), 'Pasar a este PC');
});

test('asistente de migración: pasar todos, elegir cuáles o dejarlos en el PC', () => {
  const mine = H.movableHere([here, server, { ...here, id: 5, name: 'Otro', person_id: 'maria' }, { ...here, id: 6, homeState: 'archived' }], 'dani');
  assert.deepEqual(mine.map((b) => b.id), [1], 'solo los suyos que se ejecutan aquí');
  const list = [{ id: 1 }, { id: 7 }, { id: 8 }];
  assert.deepEqual(H.planMove(list, 'all'), [1, 7, 8]);
  assert.deepEqual(H.planMove(list, 'pick', [8, '1']), [1, 8]);
  assert.deepEqual(H.planMove(list, 'none', [1]), []);
});

test('el informe después de pasar: webs para volver a iniciar sesión, conectores que faltan y nombres repetidos', () => {
  const r = H.moveReport([
    { id: 1, name: 'Agenda', ok: true, uid: 'u1', sites: ['amazon.es', 'ikea.com'], missing: { connectors: ['gmail'], ha: false }, sameName: null },
    { id: 7, name: 'Compras', ok: true, uid: 'u7', sites: ['amazon.es'], missing: { connectors: [], ha: true }, sameName: { uid: 'x9', name: 'Compras' } },
    { id: 8, name: 'Correo', ok: false, failed: 'verify' }
  ]);
  assert.deepEqual(r.ok, ['Agenda', 'Compras']);
  assert.deepEqual(r.failed, [{ name: 'Correo', why: 'verify' }]);
  assert.deepEqual(r.sites, ['amazon.es', 'ikea.com']);
  assert.deepEqual(r.missing, ['gmail']);
  assert.equal(r.ha, true);
  assert.deepEqual(r.sameName, [{ id: 7, uid: 'u7', name: 'Compras', other: 'x9', otherName: 'Compras' }]);
});

test('quién es quién: una fila por usuario (no el admin), con las personas del Server aún libres', () => {
  const rows = H.mappingRows({
    here: [{ id: 'dani', name: 'Dani', fixed: true, mappedTo: 'srv-owner' }, { id: 'maria', name: 'María', mappedTo: 'srv-maria' }, { id: 'leo', name: 'Leo', mappedTo: null }],
    there: [{ id: 'srv-owner', name: 'Dani', fixed: true, mappedTo: 'dani' }, { id: 'srv-maria', name: 'María', mappedTo: 'maria' }, { id: 'srv-ana', name: 'Ana', mappedTo: null }]
  });
  assert.deepEqual(rows.map((r) => r.name), ['María', 'Leo']);
  assert.deepEqual(rows[0].choices.map((c) => c.value), ['srv-maria', 'srv-ana']);
  assert.deepEqual(rows[1].choices.map((c) => c.value), ['srv-ana'], 'María ya está enlazada con otra persona');
});

test('la guía: los pasos en orden, «Usuarios» solo con varios y los opcionales solo si el Server puede', () => {
  const guide = { steps: [{ id: 'agents', done: false, agents: [] }, { id: 'bots', done: true }, { id: 'vault', optional: true, available: false }, { id: 'browser', optional: true, available: true }] };
  assert.deepEqual(H.guideSteps(guide).map((s) => s.id), ['agents', 'bots', 'browser']);
  assert.deepEqual(H.guideSteps(guide, { personsCount: 2 }).map((s) => s.id), ['agents', 'bots', 'persons', 'browser']);
  assert.equal(H.firstOpenStep(H.guideSteps(guide)), 0);
  assert.equal(H.firstOpenStep([{ id: 'agents', done: true }, { id: 'bots', done: false }]), 1);
  assert.equal(H.firstOpenStep([{ id: 'agents', done: true }]), 0);
});

test('«Reconectar Claude en el Server»: solo los agentes de bots del Server sin sesión allí', () => {
  const agents = [{ agent: 'claude', signedIn: false }, { agent: 'codex', signedIn: true }];
  assert.deepEqual(H.expiredOnServer(agents, [here, server, offline]), ['claude']);
  assert.deepEqual(H.expiredOnServer(agents, [here]), [], 'los bots de este PC no cuentan');
  assert.deepEqual(H.expiredOnServer([], [server]), [], 'sin datos del Server, ningún aviso');
});

test('el móvil: un recordatorio por uid y solo los que suena el Orb al que está enlazado', () => {
  const list = H.dedupeReminders([
    { id: 1, uid: 'r-1', text: 'Dentista', executor: true },
    { id: 9, uid: 'r-1', text: 'Dentista (copia)', executor: true },
    { id: 2, uid: 'r-2', text: 'Copia de otro Orb', executor: false },
    { id: 3, text: 'De antes de 3.7' }
  ]);
  assert.deepEqual(list.map((r) => r.text), ['Dentista', 'De antes de 3.7']);
  assert.equal(list[0].id, H.dedupeReminders([{ id: 77, uid: 'r-1' }])[0].id, 'el mismo id en el móvil venga de donde venga');
  const once = H.onceByUid();
  assert.equal(once('m-1'), true); assert.equal(once('m-1'), false); assert.equal(once(null), true);
});

test('plurales y textos: «1 bot» y «2 bots»; nada de «Núcleo» en la interfaz', () => {
  assert.equal(H.tn(t, 'server.botsMove', 1), 'Pasar 1 bot');
  assert.equal(H.tn(t, 'server.botsMove', 3), 'Pasar 3 bots');
  assert.equal(H.tn(createT('en'), 'home.queued', 1), '1 message waiting to be sent');
  const files = ['src/ui/views/server.jsx', 'src/ui/views/bots/home.jsx', 'src/core/locales/es/servidor-ui.mjs', 'src/core/locales/en/servidor-ui.mjs'];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /n[uú]cleo/i, f);
  // No secret field is ever filled from what the Server answers (the vault's form starts empty and is emptied after).
  const ui = fs.readFileSync(path.join(ROOT, 'src/ui/views/server.jsx'), 'utf8');
  assert.match(ui, /setF\(\(x\) => \(\{ \.\.\.x, clientSecret: '', password: '' \}\)\)/);
  assert.match(ui, /type="password" value=\{f\.clientSecret\}/);
  assert.match(ui, /type="password" value=\{f\.password\}/);
});

test('Contraseñas: las webs aprobadas (una por web, la más reciente primero, sin nada de la bóveda)', async () => {
  const { boardApprovals, grantVault } = await import('../src/server/vault/fill.mjs');
  const rows = new Map();
  const board = {
    settingJson: (k, v) => { if (v === undefined) return rows.has(k) ? JSON.parse(rows.get(k)) : null; rows.set(k, JSON.stringify(v)); return v; },
    all: (sql, like) => { const pre = like.split(String.fromCharCode(92)).join('').replace(/%$/, ''); return [...rows].filter(([k]) => k.startsWith(pre)).map(([key, value]) => ({ key, value })); },
    run: () => {}
  };
  grantVault(board, 'ana', 'item-1', 'tienda.example');
  board.settingJson('vault_ok:ana:item-2:tienda.example', { at: '2026-11-04T10:00:00.000Z' });
  board.settingJson('vault_ok:ana:item-3:correo.example:8443', { at: '2026-11-01T10:00:00.000Z' });
  board.settingJson('vault_ok:maria:item-9:banco.example', { at: '2026-11-04T10:00:00.000Z' });
  const list = boardApprovals(board).list('ana');
  assert.deepEqual(list.map((x) => x.host), ['tienda.example', 'correo.example:8443']);
  assert.ok(list.every((x) => Object.keys(x).sort().join() === 'at,host'), 'solo la web y cuándo');
});
