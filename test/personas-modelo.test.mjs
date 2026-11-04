// 3.6 «Personas» (WS1): las personas de un Orb, su PIN, sus ajustes y los ayudantes del tablero por persona.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { openDb } from '../src/core/db.mjs';
import { ctx, personSetting } from '../src/core/context.mjs';
import * as P from '../src/core/persons.mjs';
import { pickAccount, checkSpend, recordSpend } from '../src/core/budget.mjs';
import { principalOf } from '../src/core/authz.mjs';
import { buildApi } from '../src/engine/api.mjs';

const home = tempHome();
after(() => home.cleanup());
const board = new Board();
const owner = board.ownerId();
const api = buildApi({ board, sessions: {}, orchestrator: {}, scheduler: {}, emit: () => {}, log: () => {}, version: 'test' });

test('un Orb nuevo tiene un dueño: con el nombre de los ajustes, su idioma y la zona horaria del PC', () => {
  const list = P.listPersons(board);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, owner);
  assert.equal(list[0].role, 'owner');
  assert.equal(list[0].name, 'Ana');
  assert.equal(list[0].language, 'es');
  assert.ok(list[0].tz);
  assert.equal(ctx.owner, owner, 'el proceso sabe quién es el dueño');
  assert.equal(board.setting('persons_migrated'), '1');
  // Abrir otra vez la base no crea otro dueño.
  const again = new Board(openDb());
  assert.equal(again.ownerId(), owner);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM persons').n, 1);
  assert.throws(() => board.run("INSERT INTO persons (id, name, role, created_at) VALUES ('x', 'Otro', 'owner', 'now')"), /UNIQUE/, 'nunca dos dueños');
});

test('personas: crear, nombre único, renombrar, quitar (el dueño no) y nunca el PIN en lo que se devuelve', () => {
  const leo = P.createPerson(board, { name: 'Leo', tz: 'Europe/Madrid' });
  assert.equal(leo.role, 'user');
  assert.throws(() => P.createPerson(board, { name: 'leo' }), /ya está en uso/);
  assert.throws(() => P.createPerson(board, { name: '  ' }), /nombre/);
  assert.throws(() => P.createPerson(board, { name: 'Eva', tz: 'Marte/Base' }), /zona horaria/);
  assert.equal(P.renamePerson(board, leo.id, 'Leo M.').name, 'Leo M.');
  assert.equal(P.personName(board, leo.id), 'Leo M.');
  assert.equal(P.personName(board, owner), 'Ana');
  const eva = P.createPerson(board, { name: 'Eva' });
  P.removePerson(board, eva.id);
  assert.ok(!P.listPersons(board).some((p) => p.id === eva.id), 'quitada (de momento, marcada)');
  assert.throws(() => P.removePerson(board, owner), /dueño/);
  assert.ok(!('pin_hash' in P.getPerson(board, leo.id)) && !('pin_salt' in P.getPerson(board, leo.id)));
});

test('PIN: scrypt, 5 intentos y después un bloqueo que crece; el ticket vale 5 minutos y solo en ese aparato', () => {
  const p = P.createPerson(board, { name: 'Iris' });
  assert.throws(() => P.setPin(board, p.id, '12'), /4 a 12 cifras/);
  P.setPin(board, p.id, '4821');
  const row = board.one('SELECT pin_hash, pin_salt FROM persons WHERE id = ?', p.id);
  assert.ok(row.pin_hash && row.pin_salt && !row.pin_hash.includes('4821'));
  for (let i = 1; i <= 4; i++) assert.deepEqual(P.verifyPin(board, p.id, '0000'), { ok: false, reason: 'wrong', triesLeft: 5 - i });
  const fifth = P.verifyPin(board, p.id, '0000');
  assert.equal(fifth.reason, 'locked');
  const first = Date.parse(fifth.lockedUntil) - Date.now();
  assert.ok(first > 20_000 && first <= 30_000, 'el primer bloqueo es de 30 s');
  assert.equal(P.verifyPin(board, p.id, '4821').reason, 'locked', 'bloqueado, ni con el PIN bueno');
  board.run('UPDATE persons SET pin_locked_until = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), p.id);
  const sixth = P.verifyPin(board, p.id, '1111');
  assert.ok(Date.parse(sixth.lockedUntil) - Date.now() > 50_000, 'cada fallo más dobla la espera');
  board.run('UPDATE persons SET pin_locked_until = NULL WHERE id = ?', p.id);
  const ok = P.verifyPin(board, p.id, '4821', { device: 'tel-1' });
  assert.equal(ok.ok, true);
  assert.equal(board.one('SELECT pin_fails FROM persons WHERE id = ?', p.id).pin_fails, 0);
  assert.ok(P.checkTicket(ok.ticket, p.id, 'tel-1') > Date.now());
  assert.equal(P.checkTicket(ok.ticket, p.id, 'tel-2'), 0, 'otro aparato');
  assert.equal(P.checkTicket(ok.ticket, owner, 'tel-1'), 0, 'otra persona');
  P.dropTickets(p.id);
  assert.equal(P.checkTicket(ok.ticket, p.id, 'tel-1'), 0);
  P.setPin(board, p.id, null);
  assert.equal(P.getPerson(board, p.id).hasPin, false);
});

test('personSetting: lo de cada persona; el dueño sin fila lee donde estaba en 3.5.1', () => {
  const leo = P.listPersons(board).find((p) => p.name === 'Leo M.');
  assert.equal(personSetting(owner, 'language'), 'es', 'del orb.json');
  board.setting('active_project', 'web');
  assert.equal(board.personSetting(owner, 'active_project'), 'web', 'de settings');
  assert.equal(personSetting(leo.id, 'language'), undefined, 'otra persona no hereda lo del dueño');
  personSetting(leo.id, 'preview', 'none');
  assert.equal(personSetting(leo.id, 'preview'), 'none');
  board.personSetting(owner, 'preview', 'all');
  assert.equal(personSetting(owner, 'preview'), 'all', 'una fila gana a lo de antes');
  personSetting(owner, 'preview', null);
  assert.equal(personSetting(owner, 'preview'), undefined);
  assert.throws(() => personSetting(owner, 'cualquiera', 1), /unknown person setting/);
  board.setting('active_project', '');
});

test('tablero por persona: conversaciones y tareas con su persona, y las listas solo con lo suyo', () => {
  const leo = P.listPersons(board).find((p) => p.name === 'Leo M.');
  const mine = board.createConversation({ title: 'De Ana' });
  const his = board.createConversation({ title: 'Secreto de Leo', person: leo.id });
  assert.equal(board.conversation(mine.id).person_id, owner, 'sin persona: la del dueño');
  assert.equal(board.conversation(his.id).person_id, leo.id);
  const asLeo = principalOf(board, { desktop: true, person: leo.id });
  const asAna = principalOf(board, { desktop: true });
  assert.deepEqual(board.conversations({ principal: asLeo }).map((c) => c.id), [his.id]);
  assert.ok(!board.conversations({ principal: asAna }).some((c) => c.id === his.id), 'el dueño no ve lo de los demás');
  assert.equal(board.conversations().length, 2, 'sin principal, como antes');
  const line = board.addChat('usuario', 'hola', null, his.id, { person: leo.id });
  assert.equal(board.chatRow(line.id).person_id, leo.id);
  board.notice('aviso para Leo', 'info', { person: leo.id });
  assert.equal(board.one("SELECT meta FROM chat WHERE role = 'notice' ORDER BY id DESC LIMIT 1").meta, JSON.stringify({ tone: 'info', person: leo.id }));
  const hints = []; board.onChange((what, h) => hints.push([what, h]));
  board.event(null, 'usuario', 'nota', 'x', { person: leo.id });
  assert.deepEqual(hints.at(-1), ['events', { person: leo.id }]);
  assert.equal(board.one('SELECT person_id FROM events ORDER BY id DESC LIMIT 1').person_id, leo.id);
  board.run("INSERT INTO projects (name, path, created_at, person_id) VALUES ('web', '/x', 'now', ?)", owner);
  board.run("INSERT INTO tasks (project, title, description, status, created_by, created_at, updated_at, person_id) VALUES ('web', 't', 'd', 'done', 'usuario', 'now', 'now', ?)", owner);
  assert.equal(board.tasks({ principal: asLeo }).length, 0);
  assert.equal(board.tasks({ principal: asAna }).length, 1);
  board.run("INSERT INTO shares (resource_type, resource_id, person_id, right) VALUES ('project', 'web', ?, 'view')", leo.id);
  assert.equal(board.tasks({ principal: asLeo }).length, 1, 'las de un proyecto compartido');
});

test('resumen del dueño: solo números, nunca títulos ni contenido', () => {
  const o = P.overview(board);
  const leo = o.find((p) => p.name === 'Leo M.');
  assert.equal(leo.counts.conversations, 1);
  assert.ok(!JSON.stringify(o).includes('Secreto'), 'sin títulos');
  assert.ok(!JSON.stringify(o).includes('hola'), 'sin contenido');
});

test('cuentas: pickAccount hace lo de antes, checkSpend deja y recordSpend anota el gasto con el día de la persona', () => {
  assert.equal(pickAccount(board, { agent: 'claude' })?.agent, 'claude');
  assert.equal(pickAccount(board, { agent: 'claude', preferred: 'codex' })?.agent, 'claude', 'una cuenta de otro agente no vale');
  assert.deepEqual(checkSpend(board, { person: owner, account: 'claude' }), { ok: true });
  const { day } = recordSpend(board, { person: owner, account: 'claude', usage: { input_tokens: 10, output_tokens: 5 } });
  const r = board.one('SELECT * FROM usage_ledger ORDER BY id DESC LIMIT 1');
  assert.equal(r.day, day); assert.equal(r.turns, 1); assert.equal(r.tokens_in, 10); assert.equal(r.tokens_out, 5);
  assert.equal(P.overview(board).find((p) => p.id === owner).today.tokens, 15);
});

test('API de personas: crear solo el dueño, cambiar de persona con su PIN, y cada uno ve lo suyo', async () => {
  const desk = api.desktopPrincipal();
  assert.equal(desk.person, owner);
  const mia = await api.call('persons.create', { name: 'Mia' }, desk);
  await api.call('persons.switch', { id: mia.id }, desk);
  const asMia = api.desktopPrincipal();
  assert.equal(asMia.person, mia.id);
  assert.equal(asMia.rights.admin, false);
  await assert.rejects(api.call('persons.create', { name: 'Otro' }, asMia), /solo lo puede hacer el dueño/);
  await assert.rejects(api.call('config.save', { patch: {} }, asMia), /solo lo puede hacer el dueño/);
  await assert.rejects(api.call('persons.overview', {}, asMia), /dueño/);
  const seen = await api.call('persons.list', {}, asMia);
  assert.ok(seen.find((p) => p.id === owner) && !('caps' in seen.find((p) => p.id === owner)), 'los demás, solo su nombre');
  assert.equal((await api.call('persons.me', {}, asMia)).person.name, 'Mia');
  await api.call('persons.setPin', { pin: '2468' }, asMia);
  await assert.rejects(api.call('persons.setPin', { pin: '1357' }, asMia), /PIN para seguir/, 'cambiarlo pide el PIN de ahora');
  await assert.rejects(api.call('persons.setPin', { pin: '1357', current: '0000' }, asMia), /no es correcto/);
  await api.call('persons.setPin', { pin: '1357', current: '2468' }, asMia);
  await assert.rejects(api.call('persons.setPin', { id: owner, pin: '1111' }, asMia), /No tienes acceso/);
  await api.call('persons.switch', { id: owner }, asMia);
  const back = await api.call('persons.switch', { id: mia.id, pin: '9999' }, api.desktopPrincipal());
  assert.deepEqual([back.ok, back.reason], [false, 'wrong'], 'entrar como Mia pide su PIN');
  assert.equal(api.desktopPrincipal().person, owner);
  assert.equal((await api.call('persons.switch', { id: mia.id, pin: '1357' }, api.desktopPrincipal())).ok, true);
  await api.call('persons.switch', { id: owner }, api.desktopPrincipal());
  // El dueño solo puede quitar el PIN de otra persona, no ponérselo.
  await assert.rejects(api.call('persons.setPin', { id: mia.id, pin: '1111' }, api.desktopPrincipal()), /Solo esa persona/);
  assert.deepEqual(await api.call('persons.setPin', { id: mia.id, pin: null }, api.desktopPrincipal()), { hasPin: false });
  await assert.rejects(api.call('persons.switch', { id: mia.id }, principalOf(board, { device: { id: 'd1', kind: 'phone', person_id: owner } })), /solo se puede hacer desde el PC/);
});
