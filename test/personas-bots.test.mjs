// 3.6 «Personas» (WS4): bots por persona. Ana (dueña) y Leo, cada uno con sus bots, grupos, recordatorios y memorias.
// Pruebas de aceptación 4 (bot compartido: conversación y sesión de cada uno, la memoria de Ana nunca en los turnos de
// Leo, dejar de compartir corta en menos de 1 s), 5 (grupo compartido con autores; al borrar a Leo, «(mensaje borrado)»),
// 10 (tarjetas: solo sus aprobadores, con PIN cuando es sensible), 13 (A5: memoria pendiente hasta aprobarla, deshacer),
// 14 (A7: Home Assistant con lista de permitidos y tarjeta siempre para lo peligroso), 15 (A14: «Llevar mis bots» en dos
// fases, con el paso de cuentas, el informe, sin estados a medias) y que nada de los bots de Ana llega a Leo.
import { tempHome, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/core/board.mjs';
import { createPerson, setPin, verifyPin, setCaps } from '../src/core/persons.mjs';
import { principalOf, AuthzError, audienceOf, reaches } from '../src/core/authz.mjs';
import { lendAccount } from '../src/core/budget.mjs';
import { deletePerson } from '../src/core/export.mjs';
import * as B from '../src/core/bots.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { Bots, botPersona } from '../src/engine/bots.mjs';
import { buildApi } from '../src/engine/api.mjs';

let t; let board; let bots; let api; let ana; let leo; let asAna; let asLeo;
const events = []; const pushes = []; const logs = [];
const remoteRef = { current: null, link: null };
const ids = {};
const call = (who, method, params = {}) => api.call(method, params, who);
const denied = (p) => assert.rejects(p, (e) => e instanceof AuthzError || /no tienes acceso|no la puedes aprobar|no puedes/i.test(e.message));
// What the fake agents received (test/fixtures/fake-live.mjs writes every turn to ORB_FAKE_LOG), for one bot's folder.
const promptsOf = (botId) => { let text = ''; try { text = fs.readFileSync(process.env.ORB_FAKE_LOG, 'utf8'); } catch { return []; } return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && path.basename(String(r.cwd ?? '')) === String(botId) && path.basename(path.dirname(String(r.cwd ?? ''))) === 'bots'); };
const botLines = (conv) => board.chat(conv, 200).filter((l) => l.role === 'bot');

before(async () => {
  t = tempHome();
  process.env.ORB_FAKE_LOG = path.join(t.base, 'agentes.jsonl');
  board = new Board();
  const emit = (event, payload) => events.push({ event, payload });
  const sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, 'clave', { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  bots = new Bots(board, { emit, log: (l) => logs.push(l), push: (n) => pushes.push(n) }).start();
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef, bots });
  ana = board.ownerId();
  leo = createPerson(board, { name: 'Leo', tz: 'Europe/Madrid' }).id;
  asAna = principalOf(board, { desktop: true });
  asLeo = principalOf(board, { desktop: true, person: leo });
  // Ana lends Leo her Claude account for bots (Leo has none of his own).
  lendAccount(board, { account: 'claude', lender: ana, person: leo, bots: true, dev: false });
  // Ana's own, private bot and its things (marked SECRETO-ANA), and her shared bot «Casa».
  ids.anaBot = (await call(asAna, 'bots.create', { name: 'Privado', role_text: 'SECRETO-ANA papel', tools: ['recordatorios'] })).id;
  await call(asAna, 'bots.memory.set', { id: ids.anaBot, text: 'SECRETO-ANA memoria del bot' });
  await call(asAna, 'bots.memory.set', { id: 'global', text: 'SECRETO-ANA memoria global' });
  ids.anaReminder = (await call(asAna, 'bots.reminders.create', { id: ids.anaBot, text: 'SECRETO-ANA recordatorio', when: new Date(Date.now() + 86_400_000).toISOString() })).id;
  ids.anaGroup = (await call(asAna, 'bots.groups.create', { name: 'SECRETO-ANA grupo', members: [ids.anaBot] })).id;
  ids.casa = (await call(asAna, 'bots.create', { name: 'Casa', role_text: 'La casa', tools: ['recordatorios', 'casa'] })).id;
  await call(asAna, 'bots.memory.set', { id: ids.casa, text: 'Memoria comun de Casa' });
  await call(asAna, 'bots.memory.set', { id: ids.casa, which: 'mine', text: 'SECRETO-ANA-PERSONAL le gusta el té' });
});
after(() => { bots.shutdown(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('lo creado lleva la persona de quien lo crea (B6: el nombre es único para cada persona)', async () => {
  const mine = await call(asLeo, 'bots.create', { name: 'Privado', role_text: 'Bot de Leo', tools: ['recordatorios'] });
  ids.leoBot = mine.id;
  assert.equal(board.one('SELECT person_id FROM bots WHERE id = ?', mine.id).person_id, leo, 'Leo puede llamar «Privado» a su bot');
  assert.equal(B.getBot(board, 'Privado', { person: leo }).id, mine.id);
  assert.equal(B.getBot(board, 'Privado', { person: ana }).id, ids.anaBot);
  await assert.rejects(call(asLeo, 'bots.create', { name: 'privado' }), /Ya hay un bot/);
  ids.leoGroup = (await call(asLeo, 'bots.groups.create', { name: 'Grupo de Leo', members: [mine.id] })).id;
  assert.equal(board.one('SELECT person_id FROM bot_groups WHERE id = ?', ids.leoGroup).person_id, leo);
  await assert.rejects(call(asLeo, 'bots.groups.create', { name: 'Con lo de Ana', members: [ids.anaBot] }), /No hay ningún bot/);
  const r = await call(asLeo, 'bots.reminders.create', { id: mine.id, text: 'Regar', when: '2099-03-01T09:00' });
  assert.equal(r.person_id, leo); assert.equal(r.tz, 'Europe/Madrid'); assert.equal(r.local_at, '2099-03-01T09:00');
  assert.equal(r.next_run, '2099-03-01T08:00:00.000Z', 'las 09:00 en Madrid');
  await call(asLeo, 'bots.memory.set', { id: 'global', text: 'Global de Leo' });
  assert.equal((await call(asLeo, 'bots.memory.get', { id: 'global' })).text, 'Global de Leo', 'su propia memoria global');
  assert.match((await call(asAna, 'bots.memory.get', { id: 'global' })).text, /SECRETO-ANA memoria global/);
});

test('nada de los bots de Ana llega a Leo: listas, llamadas con sus ids y eventos', async () => {
  const seen = JSON.stringify(await Promise.all([call(asLeo, 'bots.list'), call(asLeo, 'bots.groups.list'), call(asLeo, 'bots.reminders.list', { all: true }),
    call(asLeo, 'bots.memory.get', { id: 'global' }), call(asLeo, 'bots.cards'), call(asLeo, 'bots.memory.pending'), call(asLeo, 'bots.where')]));
  assert.ok(!seen.includes('SECRETO-ANA'), 'nada de Ana en sus listas');
  assert.ok(!seen.includes('"Casa"'), 'Casa aún no está compartido');
  for (const [m, p] of [['bots.get', { id: ids.anaBot }], ['bots.chat', { id: ids.anaBot }], ['bots.send', { id: ids.anaBot, text: 'hola' }], ['bots.memory.get', { id: ids.anaBot }],
    ['bots.memory.set', { id: ids.anaBot, text: 'x' }], ['bots.reminders.cancel', { id: ids.anaReminder }], ['bots.groups.chat', { id: ids.anaGroup }], ['bots.groups.send', { id: ids.anaGroup, text: 'x' }],
    ['bots.update', { id: ids.anaBot, role_text: 'x' }], ['bots.memory.history', { id: ids.anaBot }], ['bots.reminders.list', { id: ids.anaBot }]]) await denied(call(asLeo, m, p));
  assert.ok(board.all("SELECT * FROM audit WHERE person_id = ? AND decision = 'deny'", leo).length >= 10, 'quedan en la auditoría');
  // Ana talks to her private bot: none of those events reaches Leo.
  await call(asAna, 'bots.send', { id: ids.anaBot, text: 'SECRETO-ANA hola bot' });
  await until(() => botLines(B.botConversation(board, B.getBot(board, ids.anaBot))).length, 'la respuesta');
  const anaEvents = events.filter((e) => JSON.stringify(e.payload ?? '').includes('SECRETO-ANA') || (e.event === 'bot.state' && e.payload?.bot === ids.anaBot));
  assert.ok(anaEvents.length > 0);
  for (const e of anaEvents) assert.ok(!reaches(board, audienceOf(board, e.event, e.payload), leo), `${e.event} no le llega a Leo`);
  assert.ok(!pushes.some((p) => p.person === leo), 'ni un aviso al móvil de Leo');
});

test('4: Casa compartido para hablar: conversación y sesión de cada uno, y la memoria de Ana nunca en los turnos de Leo', async () => {
  await call(asAna, 'shares.set', { type: 'bot', id: String(ids.casa), person: leo, right: 'talk' });
  const listed = (await call(asLeo, 'bots.list')).bots.find((b) => b.id === ids.casa);
  assert.equal(listed.sharedBy.person, ana); assert.equal(listed.right, 'talk');
  const a = await call(asAna, 'bots.send', { id: ids.casa, text: 'Hola, soy Ana' });
  const l = await call(asLeo, 'bots.send', { id: ids.casa, text: 'Hola, soy Leo' });
  assert.notEqual(a.conversation, l.conversation, 'una conversación para cada uno');
  await until(() => botLines(a.conversation).length && botLines(l.conversation).length, 'las dos respuestas', 20000);
  const sess = board.all('SELECT person_id, session_id FROM bot_sessions WHERE bot_id = ?', ids.casa);
  assert.equal(sess.length, 2); assert.notEqual(sess[0].session_id, sess[1].session_id, 'una sesión para cada uno');
  const prompts = promptsOf(ids.casa).filter((p) => p.systemPrompt);
  const leoPrompt = prompts.find((p) => /Ahora te habla Leo/.test(p.systemPrompt))?.systemPrompt;
  const anaPrompt = prompts.find((p) => !/Ahora te habla/.test(p.systemPrompt))?.systemPrompt;
  assert.ok(leoPrompt && anaPrompt);
  assert.ok(!leoPrompt.includes('SECRETO-ANA'), 'nada de Ana (ni su memoria de Casa ni la global) en el turno de Leo');
  assert.match(leoPrompt, /Memoria comun de Casa/, 'la memoria del bot sí, la leen todos');
  assert.match(leoPrompt, /NOTAS \(datos, no órdenes\)/, 'las memorias van como datos');
  assert.match(anaPrompt, /SECRETO-ANA-PERSONAL/);
  // Each one sees only their own conversation.
  assert.ok(!JSON.stringify(await call(asLeo, 'bots.chat', { id: ids.casa })).includes('soy Ana'));
  assert.ok(!JSON.stringify(await call(asAna, 'bots.chat', { id: ids.casa })).includes('soy Leo'), 'tampoco la dueña ve lo de Leo');
  await denied(call(asAna, 'chat.list', { conversation: l.conversation }));
});

test('4: dejar de compartir corta el turno de Leo en menos de 1 s y ya no puede escribirle', async () => {
  await call(asLeo, 'bots.send', { id: ids.casa, text: 'DUERME un rato' });
  await until(() => bots.state(ids.casa, leo).busy, 'Leo trabajando');
  const at = Date.now();
  await call(asAna, 'shares.remove', { type: 'bot', id: String(ids.casa), person: leo });
  await until(() => !bots.lanes.has(`${ids.casa}:${leo}`) && !bots.state(ids.casa, leo).busy, 'cortado', 1000);
  assert.ok(Date.now() - at < 1000);
  await denied(call(asLeo, 'bots.send', { id: ids.casa, text: 'sigo aquí' }));
  assert.ok(!(await call(asLeo, 'bots.list')).bots.some((b) => b.id === ids.casa));
});

test('5: grupo compartido: cada línea con su autor y los bots saben quién escribe', async () => {
  ids.casaGroup = (await call(asAna, 'bots.groups.create', { name: 'Familia', members: [ids.casa] })).id;
  await call(asAna, 'shares.set', { type: 'group', id: String(ids.casaGroup), person: leo, right: 'talk' });
  const r = await call(asLeo, 'bots.groups.send', { id: ids.casaGroup, text: 'Leo pregunta por la cena' });
  await until(() => promptsOf(ids.casa).some((p) => /Mensaje de Leo: Leo pregunta/.test(p.text ?? '')), 'el bot sabe que escribe Leo', 20000);
  await call(asAna, 'bots.groups.send', { id: ids.casaGroup, text: 'Ana contesta' });
  const lines = (await call(asLeo, 'bots.groups.chat', { id: ids.casaGroup })).lines.filter((x) => x.role === 'usuario');
  assert.deepEqual(lines.map((x) => x.author), ['Leo', 'Ana']);
  assert.equal(board.chatRow(lines[0].id).person_id, leo);
  ids.groupConv = r.conversation;
});

test('10: las tarjetas: solo sus aprobadores, solo a ellos el aviso, y con PIN si es sensible', async () => {
  // Leo's own bot asks to buy something: the card is Leo's to answer, not Ana's (she cannot even see it).
  await call(asLeo, 'bots.send', { id: ids.leoBot, text: 'BOT_CALL bot_confirm {"action":"comprar","detail":"Leche","url":"https://tienda.example"}' });
  const conv = B.botConversation(board, B.getBot(board, ids.leoBot), { person: leo });
  const card = await until(() => board.chat(conv).find((x) => x.meta?.kind === 'bot_card' && x.meta.card === 'confirm'), 'la tarjeta', 20000);
  assert.deepEqual(card.meta.approvers, [leo]);
  assert.ok(pushes.filter((p) => p.conversation === conv && /permiso/.test(p.body)).every((p) => p.person === leo), 'el aviso, solo a Leo');
  await denied(call(asAna, 'bots.decide', { item: card.id, decision: 'allow' }));
  assert.ok((await call(asLeo, 'bots.cards')).some((c) => c.id === card.id), 'Leo la tiene entre las suyas');
  // With a PIN, a sensitive card needs it typed (a strong ticket).
  setPin(board, leo, '4321');
  await assert.rejects(call(asLeo, 'bots.decide', { item: card.id, decision: 'allow' }), /PIN/);
  const v = verifyPin(board, leo, '4321', {});
  assert.equal(v.ok, true);
  const strong = principalOf(board, { desktop: true, person: leo, strongUntil: v.until });
  assert.equal((await call(strong, 'bots.decide', { item: card.id, decision: 'allow' })).status, 'done');
  // Five wrong PINs lock it.
  for (let i = 0; i < 5; i++) verifyPin(board, leo, '0000', {});
  assert.equal(verifyPin(board, leo, '4321', {}).reason, 'locked');
  setPin(board, leo, null);
  // A lock of the house from Leo's turn: without «aprobar la casa», the card is for whoever may edit the house (Ana).
  await call(asAna, 'shares.set', { type: 'integration', id: 'ha', person: leo, right: 'talk' });
  await call(asLeo, 'bots.update', { id: ids.leoBot, tools: ['recordatorios', 'casa'] });
  await call(asLeo, 'bots.send', { id: ids.leoBot, text: 'BOT_CALL ha_call {"domain":"lock","service":"unlock","entity_id":"lock.puerta"}' });
  const lock = await until(() => board.chat(conv).find((x) => x.meta?.kind === 'bot_card' && x.meta.card === 'ha'), 'la tarjeta de la cerradura', 20000);
  assert.deepEqual(lock.meta.approvers, [ana]);
  await denied(call(asLeo, 'bots.decide', { item: lock.id, decision: 'allow' }));
  assert.ok((await call(asAna, 'bots.cards')).some((c) => c.id === lock.id && c.by === 'Leo'), 'Ana la ve entre las suyas');
  setCaps(board, leo, { approveHouse: true });
  assert.deepEqual(bots.approversFor('ha', {}, B.getBot(board, ids.leoBot), leo), [leo], 'con permiso para la casa, es suya');
  assert.equal((await call(asLeo, 'bots.decide', { item: lock.id, decision: 'deny' })).status, 'denied', 'decir que no siempre puede quien está en la conversación');
});

test('13 (A5): lo que un bot quiere guardar espera si leyó algo de fuera o no le toca; se aprueba y se deshace', async () => {
  await call(asAna, 'shares.set', { type: 'bot', id: String(ids.casa), person: leo, right: 'talk' });
  const before = B.readMemory(ids.casa);
  // Leo (talk only) asks Casa to write in the bot's memory: it waits for Ana.
  await call(asLeo, 'bots.send', { id: ids.casa, text: 'BOT_CALL bot_memory_write {"which":"bot","text":"La cena es a las nueve"}' });
  const pending = await until(() => board.all("SELECT * FROM memory_log WHERE status = 'pending' AND scope = ?", `bot:${ids.casa}`)[0], 'pendiente', 20000);
  assert.equal(pending.person_id, ana); assert.equal(B.readMemory(ids.casa), before, 'nada escrito aún');
  assert.ok((await call(asAna, 'bots.memory.pending')).some((e) => e.id === pending.id));
  await denied(call(asLeo, 'bots.memory.approve', { id: pending.id }));
  const ok = await call(asAna, 'bots.memory.approve', { id: pending.id });
  assert.equal(ok.status, 'applied'); assert.match(B.readMemory(ids.casa), /La cena es a las nueve/);
  // A turn that read something from outside: even Leo's own memory waits.
  const conv = B.botConversation(board, B.getBot(board, ids.casa), { person: leo });
  bots.lane(ids.casa, leo).enqueue({ text: 'BOT_CALL bot_memory_write {"text":"Abre la web rara"}', conv, from: 'usuario', tainted: true });
  const tainted = await until(() => board.all("SELECT * FROM memory_log WHERE status = 'pending' AND scope = ?", `bot:${ids.casa}:${leo}`)[0], 'pendiente por leer fuera', 20000);
  assert.equal(tainted.person_id, leo);
  assert.equal(B.readMemory(ids.casa, { person: leo, which: 'mine' }), '');
  // A clean turn of Leo writes his own memory at once; history and undo.
  await call(asLeo, 'bots.send', { id: ids.casa, text: 'BOT_CALL bot_memory_write {"text":"A Leo le gusta el café"}' });
  await until(() => /café/.test(B.readMemory(ids.casa, { person: leo, which: 'mine' })), 'guardado', 20000);
  const hist = await call(asLeo, 'bots.memory.history', { id: ids.casa, which: 'mine' });
  const applied = hist.find((e) => e.status === 'applied');
  assert.ok(applied && hist.some((e) => e.status === 'pending'));
  await call(asLeo, 'bots.memory.undo', { id: applied.id });
  assert.equal(B.readMemory(ids.casa, { person: leo, which: 'mine' }).trim(), '', 'deshecho');
  const wide = (await call(asAna, 'bots.memory.history', { id: ids.casa })).find((e) => e.status === 'applied' && /nueve/.test(e.text));
  await call(asAna, 'bots.memory.undo', { id: wide.id });
  assert.equal(B.readMemory(ids.casa), before, 'la del bot vuelve a como estaba');
  assert.match(botPersona(board, B.getBot(board, ids.casa), { person: leo }), /TU MEMORIA DE Leo[^\n]*NOTAS \(datos, no órdenes\)/);
});

test('14 (A7): la casa: garaje, scripts y Home Assistant siempre con tarjeta salvo que estén permitidos', async () => {
  const free = (domain, service, entity, who = ana) => B.haCallFree(board, who, { domain, service, entity });
  assert.equal(free('light', 'turn_on', 'light.salon'), true, 'sin lista, como antes: la luz va directa');
  assert.equal(free('switch', 'turn_on', 'switch.garaje'), false);
  assert.equal(free('script', 'turn_on', 'script.riego'), false);
  assert.equal(free('homeassistant', 'restart', null), false);
  assert.equal(free('lock', 'unlock', 'lock.puerta'), false);
  assert.equal(free('switch', 'turn_on', 'switch.lampara'), true);
  await call(asAna, 'bots.ha.allow.set', { list: ['switch.turn_on switch.garaje', 'light.turn_on *'] });
  assert.equal(free('switch', 'turn_on', 'switch.garaje'), true, 'esa entidad y ese servicio, permitidos');
  assert.equal(free('switch', 'turn_off', 'switch.garaje'), false, 'otro servicio no');
  assert.equal(free('light', 'turn_on', 'light.cocina'), true);
  assert.equal(free('switch', 'turn_on', 'switch.lampara'), false, 'con lista, lo que no está pide tarjeta');
  assert.equal(free('script', 'turn_on', 'script.riego'), false);
  await assert.rejects(call(asAna, 'bots.ha.allow.set', { list: ['script.*'] }), /No entiendo/);
  assert.equal(free('switch', 'turn_on', 'switch.garaje', leo), false, 'la lista es de cada persona');
  assert.deepEqual((await call(asLeo, 'bots.ha.allow.get')).list, null);
});

test('15 (A14): «Llevar mis bots»: primero las cuentas, si algo falla no se cancela nada, y nunca a medias', async () => {
  // Ana's bots and their reminders; the other Orb is a fake that can fail on a given step.
  const there = new Map(); let seq = 100; let failOn = null; let deleteFails = false;
  const fakeCall = async (peer, method, p) => {
    if (failOn && method === failOn) throw new Error(`falla ${method}`);
    if (method === 'bots.list') return { bots: [...there.values()] };
    if (method === 'bots.create') { const b = { ...p, id: ++seq, memory: '', mine: '', reminderList: [] }; there.set(b.id, b); return b; }
    if (method === 'bots.memory.set') { const b = there.get(p.id); if (b) { if (p.which === 'mine') b.mine = p.text; else b.memory = p.text; } return { text: p.text }; }
    if (method === 'bots.memory.get') return { text: '' };
    if (method === 'bots.reminders.create') { there.get(p.id).reminderList.push(p); return p; }
    if (method === 'bots.get') return there.get(p.id);
    if (method === 'bots.delete') { if (deleteFails) throw new Error('sin conexión'); there.delete(p.id); return true; }
    if (method === 'bots.history.import') return { lines: p.lines.length };
    throw new Error(`no esperado: ${method}`);
  };
  remoteRef.link = { peers: () => [{ id: 'orb-2', name: 'Sobremesa', role: 'centro', online: true }], call: fakeCall };
  await call(asAna, 'bots.update', { id: ids.anaBot, accounts: { account: 'claude' } });
  const remBefore = () => B.getReminder(board, ids.anaReminder);
  // 1) The mapping step first: nothing is copied, nothing changes.
  const plan = await call(asAna, 'bots.moveTo', { location: 'orb-2', bring: true });
  assert.equal(plan.step, 'mapping');
  assert.ok(plan.accounts.some((a) => a.id === 'claude'));
  assert.equal(there.size, 0); assert.equal(plan.location, 'local');
  const mapping = { accounts: { claude: 'claude-de-alla' }, connectors: {} };
  // 2) A failure while copying the reminders: the copies there go, the reminder here keeps ringing, a report says what.
  failOn = 'bots.reminders.create';
  const bad = await call(asAna, 'bots.moveTo', { location: 'orb-2', bring: true, mapping });
  assert.equal(bad.ok, false); assert.equal(bad.failed.step, 'reminders'); assert.equal(bad.location, 'local');
  assert.equal(there.size, 0, 'nada a medias allí');
  assert.equal(remBefore().enabled, true, 'el recordatorio sigue aquí');
  assert.equal(B.getBot(board, ids.anaBot).paused, false);
  // 3) Cut half way (the copies there could not be deleted, as if the app closed): nothing changed here, and the next
  // run cleans what was left there first.
  failOn = 'bots.memory.set'; deleteFails = true;
  const cut = await call(asAna, 'bots.moveTo', { location: 'orb-2', bring: true, mapping });
  assert.equal(cut.ok, false); assert.ok(there.size >= 1, 'quedó algo allí');
  assert.ok(board.settingJson('bots_move')?.copies?.length, 'y Orb lo apunta');
  assert.equal(remBefore().enabled, true); assert.equal(B.getBot(board, ids.anaBot).paused, false);
  // 4) Everything copied and checked: only then paused and cancelled here.
  failOn = null; deleteFails = false;
  const ok = await call(asAna, 'bots.moveTo', { location: 'orb-2', bring: true, mapping, history: true });
  assert.equal(ok.ok, true); assert.ok(ok.cleaned >= 1, 'limpió lo que quedó');
  assert.equal(ok.location, 'orb-2');
  const copy = [...there.values()].find((b) => b.name === 'Privado');
  assert.equal(copy.accounts.account, 'claude-de-alla', 'con la cuenta elegida allí');
  assert.match(copy.memory, /SECRETO-ANA memoria del bot/);
  assert.equal(copy.reminderList[0].tz, B.getReminder(board, ids.anaReminder).tz, 'el recordatorio con su zona');
  assert.equal([...there.values()].filter((b) => b.name === 'Privado').length, 1, 'una sola copia');
  assert.ok(ok.report.some((r) => r.bot === 'Privado' && r.reminders === 1 && r.history > 0), 'con su conversación');
  assert.equal(remBefore().enabled, false, 'aquí ya no suena');
  assert.equal(B.getBot(board, ids.anaBot).paused, true);
  assert.equal(board.settingJson('bots_move'), null);
  remoteRef.link = null;
});

test('recordatorios en la zona de cada uno: uno suelto que llega tarde dice cuánto; uno que se repite se salta esa vez', async () => {
  const once = B.createReminder(board, { bot_id: ids.leoBot, text: 'Llamar al médico', when: '2099-06-01T10:00' }, 'usuario', { person: leo });
  const daily = B.createReminder(board, { bot_id: ids.leoBot, text: 'Pastilla', every: 'daily', when: '2099-06-01T10:00' }, 'usuario', { person: leo });
  assert.equal(once.next_run, '2099-06-01T08:00:00.000Z', 'las 10:00 de Madrid en verano');
  const late = Date.parse(once.next_run) + 25 * 60_000; // the PC was off for a while
  const fired = bots.fireReminders(late);
  assert.ok(fired.some((r) => r.id === once.id) && !fired.some((r) => r.id === daily.id), 'el diario se salta esta vez');
  assert.equal(fired.find((r) => r.id === once.id).late, 25);
  const conv = B.botConversation(board, B.getBot(board, ids.leoBot), { person: leo });
  assert.ok(board.chat(conv).some((l) => /Llamar al médico \(con 25 min de retraso\)/.test(l.body)));
  assert.equal(B.getReminder(board, daily.id).next_run, '2099-06-02T08:00:00.000Z', 'y sigue mañana a su hora');
  assert.ok(B.getReminder(board, once.id).fired_late_ms >= 25 * 60_000);
  assert.ok(pushes.some((p) => p.person === leo && /Llamar al médico/.test(p.body)), 'el aviso, al móvil de Leo');
});

test('5: al borrar a Leo, sus líneas del grupo de Ana quedan como «(mensaje borrado)»', async () => {
  const id = board.all("SELECT id FROM chat WHERE conversation_id = ? AND role = 'usuario' AND person_id = ?", ids.groupConv, leo)[0].id;
  deletePerson(board, leo, { home: t.home });
  assert.equal(board.chatRow(id).body, '(mensaje borrado)');
  assert.ok(!fs.existsSync(B.memoryFile(ids.casa, { person: leo, which: 'mine' })), 'ni su memoria de Casa');
  assert.ok(board.chat(ids.groupConv).some((l) => l.role === 'usuario' && l.body === 'Ana contesta'), 'lo de Ana sigue');
});
