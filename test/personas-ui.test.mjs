// 3.6 «Personas», the interface (src/ui/lib/persons.js and the screens): with one person nothing of people shows; the
// devices grouped by person; loans and the bot's account picker; sharing; the wizard and its templates (generic, es+en);
// usage per person; the phone's lock; every text the new screens use exists in both languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, tempHome } from './helpers.mjs';
import * as P from '../src/ui/lib/persons.js';
import { botPayload, capsPayload, newBotDraft } from '../src/ui/lib/bots.js';
import { POLICY, PHONE_SET } from '../src/core/policy.mjs';
import es from '../src/core/locales/es.mjs';
import en from '../src/core/locales/en.mjs';

const ana = { id: 'p-ana', name: 'Ana', role: 'owner' };
const leo = { id: 'p-leo', name: 'Leo', role: 'user' };
const meAna = { person: ana, role: 'owner', personsCount: 2 };
const meLeo = { person: leo, role: 'user', personsCount: 2 };

test('con una sola persona no se ve nada de personas (como la 3.5.1)', () => {
  for (const me of [null, { person: ana, role: 'owner', personsCount: 1 }]) {
    assert.equal(P.personsOn(me), false);
    assert.equal(P.showPersonUi(me), false, 'sin menú, sin Mi perfil, sin insignias');
    assert.equal(P.isOwner(me), true, 'un Orb sin persons.me es del dueño');
  }
  // Ajustes › Personas sigue para el dueño en el PC (desde ahí se añade la segunda persona), nunca en un móvil.
  assert.equal(P.showPersonsSettings({ person: ana, role: 'owner', personsCount: 1 }), true);
  assert.equal(P.showPersonsSettings(meLeo), false);
  assert.equal(P.showPersonsSettings(meAna, { mobile: true }), false);
  assert.equal(P.showPersonUi(meLeo), true);
  // El editor de bots no manda topes si no se tocaron.
  assert.equal('caps' in botPayload({ ...newBotDraft(), name: 'X' }), false);
});

test('los dispositivos van agrupados por persona, el dueño primero; sin persona = del dueño', () => {
  const devices = [{ id: 'd1', name: 'Móvil de Leo', person: 'p-leo' }, { id: 'd2', name: 'Portátil', person: null }, { id: 'd3', name: 'Tablet', person: 'p-ana' }];
  const g = P.devicesByPerson(devices, [ana, leo]);
  assert.deepEqual(g.map((x) => x.name), ['Ana', 'Leo']);
  assert.deepEqual(g[0].devices.map((d) => d.id), ['d2', 'd3']);
  assert.equal(g[1].devices.length, 1);
});

test('cuentas: propias, prestadas y lo que queda del préstamo; el selector del bot solo ofrece las suyas y las prestadas para bots', () => {
  const accounts = [{ id: 'claude', agent: 'claude', label: 'Claude', person: null }, { id: 'claude-2', agent: 'claude', label: 'Claude Leo', person: 'p-leo' }, { id: 'codex', agent: 'codex', label: 'Codex', person: null }];
  const loans = { got: [{ account: 'claude', label: 'Claude', lender: 'p-ana', bots: true, dev: false, expired: false, left: { turns: 34, tokens: null, usd: null } }], given: [] };
  assert.equal(P.accountRole(accounts[0], meLeo, loans, 'p-ana'), 'borrowed');
  assert.equal(P.accountRole(accounts[1], meLeo, loans, 'p-ana'), 'own');
  assert.equal(P.accountRole(accounts[2], meLeo, loans, 'p-ana'), 'other');
  assert.equal(P.accountRole(accounts[0], meAna, null, 'p-ana'), 'own', 'una cuenta sin persona es del dueño');
  assert.deepEqual(P.loanLeftText(loans.got[0]), { key: 'persons.loan.leftTurns', vars: { n: 34 } });
  assert.equal(P.loanLeftText({ expired: true }).key, 'persons.loan.expired');
  const choices = P.botAccountChoices({ accounts, loans, me: meLeo, ownerId: 'p-ana', agent: 'claude' });
  assert.deepEqual(choices.map((c) => [c.id, c.lent]), [['claude-2', false], ['claude', true]]);
  assert.deepEqual(P.botAccountChoices({ accounts, loans: { got: [{ ...loans.got[0], bots: false }] }, me: meLeo, ownerId: 'p-ana', agent: 'claude' }).map((c) => c.id), ['claude-2'], 'un préstamo solo para programar no sirve a los bots');
  const lend = P.lendPayload('claude', { person: 'p-leo', turns: '40', tokens: '', usd: '', reserve: '30', bots: true, dev: false, days: '7' });
  assert.equal(lend.daily_turns, 40); assert.equal(lend.daily_tokens, null); assert.equal(lend.reserve_pct, 30);
  assert.ok(Date.parse(lend.expires_at) > Date.now() + 6 * 86_400_000);
  assert.equal(P.lendPayload('claude', { person: 'p-leo', reserve: '200' }).reserve_pct, 95);
  assert.equal(P.lendPayload('claude', { person: 'p-leo' }).expires_at, null);
  assert.deepEqual(capsPayload({ daily_turns: '20', daily_usd: '' }), { daily_turns: 20, daily_tokens: null, daily_usd: null });
  assert.equal(capsPayload({ daily_turns: '' }), null);
});

test('compartir: nunca con uno mismo ni con quien ya es el dueño; «Compartido conmigo» con sus nombres', () => {
  const rows = P.shareRows([ana, leo, { id: 'p-x', name: 'Xia' }], [{ person: 'p-leo', right: 'talk' }], { me: 'p-ana', owner: 'p-ana' });
  assert.deepEqual(rows, [{ id: 'p-leo', name: 'Leo', right: 'talk' }, { id: 'p-x', name: 'Xia', right: null }]);
  const withMe = [{ type: 'bot', id: '3', right: 'talk', by: 'Ana' }, { type: 'project', id: 'Web', right: 'view', by: 'Ana' }, { type: 'integration', id: 'ha', right: 'talk', by: 'Ana' }];
  const list = P.sharedWithMe(withMe, { bots: [{ id: 3, name: 'Casa', icon: '🏠' }], projects: [{ name: 'web' }] });
  assert.deepEqual(list.map((x) => [x.type, x.name, x.found]), [['bot', 'Casa', true], ['project', 'web', true]], 'las integraciones no van a la barra');
  assert.deepEqual(P.sharedBy(withMe, 'project', 'WEB'), { by: 'Ana', right: 'view' });
  assert.equal(P.sharedBy(withMe, 'bot', 9), null);
});

test('el PIN: 4 a 12 cifras, y los motivos de rechazo en palabras', () => {
  assert.ok(P.pinOk('1234')); assert.ok(!P.pinOk('12a4')); assert.ok(!P.pinOk('123')); assert.ok(!P.pinOk('1234567890123'));
  assert.equal(P.pinRefusal({ ok: true }), null);
  assert.deepEqual(P.pinRefusal({ ok: false, reason: 'wrong', triesLeft: 3 }), { key: 'persons.pin.wrongLeft', vars: { n: 3 } });
  assert.equal(P.pinRefusal({ ok: false, reason: 'locked', lockedUntil: new Date(Date.now() + 30_000).toISOString() }).key, 'persons.pin.locked');
  // El móvil pide el PIN al abrir y tras 5 minutos en segundo plano; sin PIN, nunca.
  const now = Date.now();
  assert.equal(P.phoneShouldLock({ hasPin: false, unlockedAt: null }), false);
  assert.equal(P.phoneShouldLock({ hasPin: true, unlockedAt: null }), true);
  assert.equal(P.phoneShouldLock({ hasPin: true, unlockedAt: now, hiddenAt: now - 60_000, now }), false);
  assert.equal(P.phoneShouldLock({ hasPin: true, unlockedAt: now, hiddenAt: now - 6 * 60_000, now }), true);
  assert.equal(P.needsAppUpdate({ min: 4 }), true); assert.equal(P.needsAppUpdate({ min: 2 }), false);
});

test('uso por persona: ordenado por hoy, con el total', () => {
  const { list, total } = P.usageRows([{ name: 'Ana', today: { turns: 2 }, month: { turns: 50, usd: 1.5 } }, { name: 'Leo', today: { turns: 9 }, month: { turns: 20, usd: 0.25 } }]);
  assert.deepEqual(list.map((r) => r.name), ['Leo', 'Ana']);
  assert.deepEqual(total, { today: 11, month: 70, usd: 1.75 });
});

test('la bienvenida es la de la 3.5.1 (nombre del asistente, cómo te llamo, carpeta, preparar el PC) y las plantillas están en «Nuevo bot»', async () => {
  const setup = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'setup.jsx'), 'utf8');
  for (const k of ['setup.nameLabel', 'setup.userLabel', 'setup.whereFolder', 'setup.prepareTitle', 'setup.prepareDesc']) assert.ok(setup.includes(`'${k}'`), k);
  assert.match(setup, /<Installer[ >]/, 'preparar el PC con los instaladores oficiales');
  assert.doesNotMatch(setup, /wizard\.|persons\.create|templates\.apply/, 'sin las pantallas de la 3.6');
  assert.ok(!Object.keys(es).some((k) => k.startsWith('wizard.')) && !Object.keys(en).some((k) => k.startsWith('wizard.')), 'sin textos del asistente de la 3.6');
  const create = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'bots', 'create.jsx'), 'utf8');
  assert.match(create, /'templates\.list'/); assert.match(create, /'templates\.apply'/);
  const t = tempHome();
  try {
    const { listTemplates, applyTemplate } = await import('../src/core/templates.mjs');
    for (const lang of ['es', 'en']) {
      const list = listTemplates(lang);
      assert.deepEqual(list.map((x) => x.id).sort(), ['casa', 'desarrollo', 'mantenimiento', 'negocio', 'vacio'], lang); // 3.7: «Mantenimiento del PC», opcional (no está en el asistente)
      // genéricas: ningún nombre de persona ni de casa concreta
      assert.doesNotMatch(JSON.stringify(list), /Dani|María|Ana|Leo/, `plantillas genéricas (${lang})`);
    }
    const casa = listTemplates('es').find((x) => x.id === 'casa');
    const { Board } = await import('../src/core/board.mjs');
    const board = new Board();
    const made = applyTemplate(board, { id: 'casa', lang: 'es', tz: 'Europe/Madrid' });
    assert.equal(made.bots.length, casa.bots.length);
    assert.equal(made.reminders.length, casa.reminders.length);
    board.close?.();
  } finally { t.cleanup(); }
});

test('el saludo y los avisos usan el nombre de quien está, no el del admin', async () => {
  const config = { userName: 'Ana' };
  assert.equal(P.userNameOf({ person: { id: 'p1', name: 'Ana' }, role: 'owner', personsCount: 2 }, config), 'Ana');
  assert.equal(P.userNameOf({ person: { id: 'p2', name: 'Leo' }, role: 'user', personsCount: 2 }, config), 'Leo');
  assert.equal(P.userNameOf(null, config), 'Ana');
  const { personConfig } = await import('../src/core/shape.mjs');
  assert.equal(personConfig({ userName: 'Ana', accounts: [] }, 'p2', 'Leo').userName, 'Leo');
});

test('los métodos nuevos tienen su regla y el móvil puede cambiar lo suyo', () => {
  for (const m of ['persons.update', 'persons.setCaps', 'persons.prefs.get', 'persons.prefs.set', 'persons.pauseBots']) assert.ok(POLICY[m], m);
  assert.equal(POLICY['persons.setCaps'].ownerOnly, true);
  assert.equal(POLICY['persons.pauseBots'].ownerOnly, true);
  for (const m of ['persons.update', 'persons.prefs.set', 'persons.setPin', 'persons.me']) assert.ok(PHONE_SET.has(m), m);
});

test('todos los textos de las pantallas nuevas existen en los dos idiomas (también los compuestos)', () => {
  const files = ['components/person-menu.jsx', 'components/lock-screen.jsx', 'components/share-dialog.jsx', 'views/persons.jsx', 'views/data.jsx', 'views/setup.jsx', 'views/agents.jsx', 'views/bots/more.jsx', 'views/bots/list.jsx', 'views/bots/create.jsx', 'views/magic-link.jsx'];
  const used = new Set();
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, 'src', 'ui', f), 'utf8');
    for (const m of code.matchAll(/\btr?\(\s*'([a-zA-Z]+(?:\.[\w]+)+)'/g)) used.add(m[1]);
  }
  const dynamic = [...P.CAPS.map((k) => `persons.cap.${k}`), ...['bots', 'groups', 'conversations', 'tasks', 'projects', 'schedules', 'reminders'].flatMap((k) => [`persons.count.${k}`, `persons.count.${k}One`]), 'persons.devicesNOne', 'persons.todayTurnsOne',
    ...P.ROLES.map((r) => `persons.role.${r}`), ...P.RIGHTS.map((r) => `share.right.${r}`), ...P.PREVIEWS.map((x) => `profile.preview.${x}`),
    ...['daily', 'manual', 'preupdate', 'premigration', 'move', 'other'].map((k) => `datos.kind.${k}`), ...['applied', 'pending', 'rejected', 'undone'].map((k) => `botsp.memStatus.${k}`), 'botsp.memOp.add', 'botsp.memOp.replace',
    'persons.pin.wrong', 'persons.pin.wrongLeft', 'persons.pin.locked', 'persons.loan.leftTurns', 'persons.loan.leftTokens', 'persons.loan.leftUsd', 'persons.loan.noCap', 'persons.loan.expired',
    ...['perfil', 'personas', 'datos'].flatMap((s) => [`settings.section.${s}`, `settings.sectionDesc.${s}`])];
  const missing = [...used, ...dynamic].filter((k) => !(k in es) || !(k in en));
  assert.deepEqual(missing, []);
});
