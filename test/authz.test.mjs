// 3.6 «Personas» (WS1): quién puede qué. Cada método de la API tiene su regla, cada evento su público, y lo de una
// persona no lo ve otra (tampoco el dueño), salvo lo que se comparte.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, ROOT } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { createPerson, setPin, verifyPin } from '../src/core/persons.mjs';
import { POLICY, PHONE_SET } from '../src/core/policy.mjs';
import { authorize, principalOf, audienceOf, hasAudienceRule, rightOn, can, must, scopeSql, ownerOf, AuthzError, reaches, shapeFor } from '../src/core/authz.mjs';
import { buildApi } from '../src/engine/api.mjs';

const home = tempHome();
after(() => home.cleanup());
const board = new Board();
const api = buildApi({ board, sessions: {}, orchestrator: {}, scheduler: {}, emit: () => {}, log: () => {}, version: 'test' });
const ana = board.ownerId();
const leo = createPerson(board, { name: 'Leo' }).id;
const asAna = principalOf(board, { desktop: true });
const asLeo = principalOf(board, { desktop: true, person: leo });
const denied = (fn, reason) => assert.throws(fn, (e) => e instanceof AuthzError && e.status === 403 && (!reason || e.reason === reason));

test('cada método de la API tiene su regla en POLICY, y ninguna regla sobra', () => {
  const names = api.methodNames();
  assert.ok(names.length > 150);
  const missing = names.filter((m) => !Object.hasOwn(POLICY, m));
  assert.deepEqual(missing, [], `sin regla: ${missing.join(', ')}`);
  const stale = Object.keys(POLICY).filter((k) => !k.endsWith('.*') && !names.includes(k));
  assert.deepEqual(stale, [], `reglas de métodos que no existen: ${stale.join(', ')}`);
  for (const [m, r] of Object.entries(POLICY)) {
    if (r.right) assert.ok(['view', 'talk', 'edit', 'own'].includes(r.right), `${m}: derecho desconocido`);
    if (r.res) assert.equal(typeof r.res, 'function', m);
  }
});

test('un método sin regla se niega; un evento sin regla va solo al dueño', () => {
  denied(() => authorize(board, asAna, 'nada.deEsto', {}), 'noPolicy');
  assert.deepEqual(audienceOf(board, 'algo:nuevo', { secreto: 1 }), { owner: true });
  denied(() => authorize(board, null, 'app.state', {}), 'noPrincipal');
});

test('cada evento que el motor emite tiene su regla de público', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = ['engine', 'core', 'agents', 'mcp'].flatMap((d) => walk(path.join(ROOT, 'src', d))).filter((f) => f.endsWith('.mjs'));
  const found = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/emit\??\.?\(?\s*(['`])([a-zA-Z][\w:.]*)(\$\{[^}]+\})?\1/g)) found.add(m[3] ? `${m[2]}x` : m[2]);
  assert.ok(found.size > 15, `eventos encontrados: ${[...found].join(', ')}`);
  const missing = [...found].filter((e) => !hasAudienceRule(e));
  assert.deepEqual(missing, [], `eventos sin regla: ${missing.join(', ')}`);
});

test('con una sola persona nada cambia: el dueño puede todo desde el PC y lo de siempre desde el móvil', () => {
  for (const m of api.methodNames()) assert.doesNotThrow(() => authorize(board, asAna, m, {}), m);
  const phone = principalOf(board, { device: { id: 'd1', kind: 'phone', person_id: ana, approve: 1 } });
  for (const m of PHONE_SET) assert.doesNotThrow(() => authorize(board, phone, m, {}), m);
  denied(() => authorize(board, phone, 'config.save', {}), 'ceiling');
  denied(() => authorize(board, phone, 'link.qr', {}), 'ceiling');
  // 3.8: «Puede administrar» and linked Orbs are gone: a device of before 3.8 marked so gets a phone's ceiling.
  const admin = principalOf(board, { device: { id: 'd2', kind: 'phone', person_id: null, admin: 1 } });
  assert.equal(admin.person, ana, 'un aparato sin persona es del dueño');
  denied(() => authorize(board, admin, 'link.qr', {}), 'ceiling');
  denied(() => authorize(board, principalOf(board, { device: { id: 'd3', kind: 'orb', kind_ok: 1 } }), 'bots.rules.set', {}), 'ceiling');
  const agent = principalOf(board, { agentToken: { agent: 'claude', person: ana } });
  denied(() => authorize(board, agent, 'app.state', {}), 'ceiling');
  assert.doesNotThrow(() => authorize(board, principalOf(board, { system: true }), 'config.save', {}));
});

test('lo de cada persona es suyo: ni el otro ni el dueño lo leen, y queda en la auditoría', () => {
  const mine = board.createConversation({ title: 'De Ana' });
  const his = board.createConversation({ title: 'De Leo', person: leo });
  assert.equal(ownerOf(board, { type: 'conversation', id: his.id }), leo);
  assert.doesNotThrow(() => authorize(board, asLeo, 'chat.list', { conversation: his.id }));
  denied(() => authorize(board, asLeo, 'chat.list', { conversation: mine.id }), 'right');
  denied(() => authorize(board, asAna, 'chat.list', { conversation: his.id }), 'right');
  // WS3: the lines of no conversation are each person's own (chat.list filters them by person)
  assert.doesNotThrow(() => authorize(board, asLeo, 'chat.list', {}));
  const row = board.one("SELECT * FROM audit WHERE method = 'chat.list' AND person_id = ? ORDER BY id DESC LIMIT 1", ana);
  assert.deepEqual([row.decision, row.reason, row.resource, row.channel], ['deny', 'right', `conversation:${his.id}`, 'desktop']);
  assert.ok(!JSON.stringify(board.all('SELECT * FROM audit')).includes('De Leo'), 'la auditoría no guarda contenido');
  // What does not exist: the owner gets the method's own error, anyone else only «no».
  assert.doesNotThrow(() => authorize(board, asAna, 'chat.list', { conversation: 9999 }));
  denied(() => authorize(board, asLeo, 'chat.list', { conversation: 9999 }), 'notFound');
  denied(() => authorize(board, asLeo, 'config.save', {}), 'ownerOnly');
  denied(() => authorize(board, asLeo, 'persons.rename', { id: ana, name: 'x' }), 'notYours');
  assert.doesNotThrow(() => authorize(board, asAna, 'persons.rename', { id: leo, name: 'x' }));
});

test('compartir: ver, hablar y editar, también a través del padre (las tareas de un proyecto)', () => {
  board.run("INSERT INTO bots (name, created_at, updated_at, person_id) VALUES ('Casa', 'now', 'now', ?)", ana);
  const bot = board.one("SELECT id FROM bots WHERE name = 'Casa'").id;
  denied(() => authorize(board, asLeo, 'bots.send', { id: bot, text: 'hola' }), 'right');
  board.run("INSERT INTO shares (resource_type, resource_id, person_id, right, granted_by) VALUES ('bot', ?, ?, 'talk', ?)", String(bot), leo, ana);
  assert.equal(rightOn(board, leo, { type: 'bot', id: bot }), 'talk');
  assert.equal(rightOn(board, leo, { type: 'bot', id: 'casa' }), 'talk', 'por nombre también');
  assert.doesNotThrow(() => authorize(board, asLeo, 'bots.send', { id: bot, text: 'hola' }));
  assert.doesNotThrow(() => authorize(board, asLeo, 'bots.get', { id: bot }));
  denied(() => authorize(board, asLeo, 'bots.update', { id: bot }), 'right');
  denied(() => authorize(board, asLeo, 'bots.delete', { id: bot }), 'right');
  assert.ok(can(board, asLeo, 'view', { type: 'bot', id: bot }));
  assert.throws(() => must(board, asLeo, 'edit', { type: 'bot', id: bot }), AuthzError);
  // A project shared to view: its tasks too, read only.
  board.run("INSERT INTO projects (name, path, created_at, person_id) VALUES ('web', '/w', 'now', ?)", ana);
  const t = Number(board.run("INSERT INTO tasks (project, title, description, status, created_by, created_at, updated_at, person_id) VALUES ('web', 't', 'd', 'done', 'usuario', 'now', 'now', ?)", ana).lastInsertRowid);
  denied(() => authorize(board, asLeo, 'tasks.get', { id: t }), 'right');
  board.run("INSERT INTO shares (resource_type, resource_id, person_id, right) VALUES ('project', 'web', ?, 'view')", leo);
  assert.doesNotThrow(() => authorize(board, asLeo, 'tasks.get', { id: t }));
  denied(() => authorize(board, asLeo, 'tasks.cancel', { id: t }), 'right');
  denied(() => authorize(board, asLeo, 'tasks.create', { project: 'web', title: 'x', description: 'y' }), 'right');
  // Lists: own and shared.
  const s = scopeSql(asLeo, 'bot', 'b');
  assert.deepEqual(board.all(`SELECT b.name FROM bots b WHERE ${s.where}`, ...s.args).map((r) => r.name), ['Casa']);
  const sa = scopeSql(asAna, 'conversation', 'c');
  assert.ok(board.all(`SELECT c.title FROM conversations c WHERE ${sa.where}`, ...sa.args).every((r) => r.title !== 'De Leo'));
});

test('público de los eventos: la conversación a su persona, el bot a quien lo puede ver, sin regla al dueño', () => {
  const his = board.one("SELECT id FROM conversations WHERE title = 'De Leo'").id;
  const a = audienceOf(board, 'chat:new', { conversation: his, body: 'x' });
  assert.deepEqual([...a.persons], [leo]);
  assert.ok(reaches(board, a, leo) && !reaches(board, a, ana), 'el dueño no recibe lo de Leo');
  const bot = board.one("SELECT id FROM bots WHERE name = 'Casa'").id;
  assert.deepEqual(new Set(audienceOf(board, 'bot.updated', { id: bot }).persons), new Set([ana, leo]));
  assert.deepEqual(audienceOf(board, 'board:changed', ['tasks']), { all: true });
  assert.deepEqual(audienceOf(board, 'notice', { body: 'x', person: leo }).persons, new Set([leo]));
  assert.deepEqual(audienceOf(board, 'notice', { body: 'x' }), { owner: true });
  assert.deepEqual(audienceOf(board, 'chat:new', { conversation: null }), { owner: true });
  assert.deepEqual(audienceOf(board, 'session:item', { session_id: 'no-existe' }), { owner: true });
});

test('acciones fuertes: con PIN puesto hace falta un ticket reciente', () => {
  setPin(board, leo, '5791');
  denied(() => authorize(board, asLeo, 'persons.setPin', { pin: '1111' }), 'strong');
  const { ticket, until } = verifyPin(board, leo, '5791', { device: 'desktop' });
  assert.ok(ticket);
  const strong = principalOf(board, { desktop: true, person: leo, strongUntil: until });
  assert.doesNotThrow(() => authorize(board, strong, 'persons.setPin', { pin: '1111' }));
  assert.doesNotThrow(() => authorize(board, asLeo, 'persons.setPin', { pin: '1111', current: '5791' }), 'o el PIN de ahora');
  assert.equal(Object.isFrozen(asLeo), true, 'un principal no se cambia por el camino');
  assert.deepEqual(shapeFor(principalOf(board, { device: { id: 'x', kind: 'phone' } }), 'persons.list', [{ id: 'a', pin_hash: 'h' }]), [{ id: 'a' }]);
  setPin(board, leo, null);
});
