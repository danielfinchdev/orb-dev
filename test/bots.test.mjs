// 3.5: bots a medida. Nada de bots fijos: solo «Asistente» la primera vez. Cada bot con su cerebro, sus herramientas y sus
// exclusivas; el jefe reparte con bot_send; crear un bot pide tarjeta; los recordatorios llegan al chat y al móvil; la
// memoria no guarda secretos; lo protegido (config.protected, p. ej. Vaultwarden) no se toca; y una base de datos de antes se migra sin perder nada.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, until, startEngine } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { openDb } from '../src/core/db.mjs';
import { ctx } from '../src/core/context.mjs';
import * as B from '../src/core/bots.mjs';
import { decide } from '../src/core/guard.mjs';
import { checkServerAction, serverLogs } from '../src/core/server-admin.mjs';
import { Bots, botPersona } from '../src/engine/bots.mjs';

const t = tempHome();
after(() => t.cleanup());
const board = new Board();
const pushes = []; const events = [];
const bots = new Bots(board, { emit: (e, p) => events.push([e, p]), push: (n) => pushes.push(n) }).start();
after(() => bots.shutdown());

const lines = (bot) => board.chat(B.botConversation(board, B.getBot(board, bot)), 200);
const botLines = (bot, name) => lines(bot).filter((l) => l.role === 'bot' && l.meta?.name === name && l.meta?.kind !== 'relay');

test('una base de datos de antes de la 3.5 se migra: sus conversaciones siguen y aparecen las tablas de los bots', () => {
  const file = path.join(t.base, 'vieja.db');
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, titled INTEGER NOT NULL DEFAULT 0, project TEXT, agent TEXT NOT NULL DEFAULT 'claude', account TEXT, model TEXT,
      reasoning TEXT NOT NULL DEFAULT 'medium', session_id TEXT, turns INTEGER NOT NULL DEFAULT 0, context TEXT, status TEXT NOT NULL DEFAULT 'open', done_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO conversations (title, created_at, updated_at) VALUES ('Mi web', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z');
    INSERT INTO settings (key, value) VALUES ('conversations_migrated', '1');`);
  old.close();
  const db = openDb(file);
  const cols = db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
  assert.ok(cols.includes('bot_id') && cols.includes('group_id'));
  for (const table of ['bots', 'bot_groups', 'bot_group_members', 'bot_requests', 'bot_reminders']) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), table);
  const b2 = new Board(db);
  assert.deepEqual(b2.conversations().map((c) => c.title), ['Mi web']);
  const first = B.seedStarter(b2);
  assert.equal(first.name, 'Asistente', 'solo un bot inicial vacío');
  assert.equal(first.role_text, '');
  assert.equal(B.seedStarter(b2), null, 'una sola vez');
  B.deleteBot(b2, first.id);
  assert.equal(B.seedStarter(b2), null, 'borrado, no vuelve');
  assert.equal(B.listBots(b2).length, 0);
  db.close();
});

test('tres bots: el cerebro, las herramientas y las exclusivas de cada uno van en su prompt, sin bots fijos en el código', () => {
  assert.deepEqual(B.listBots(board).map((b) => b.name), ['Asistente'], 'la primera vez, solo el inicial');
  B.deleteBot(board, 'Asistente');
  B.createBot(board, { name: 'Jefe', role_text: 'Reparte el trabajo', is_chief: true, tools: ['recordatorios'] });
  B.createBot(board, { name: 'Carl', role_text: 'Calendario y agenda', tools: ['calendario', 'recordatorios'], exclusive: ['calendario'], agent: 'codex', effort: 'high' });
  B.createBot(board, { name: 'Shop', role_text: 'Compras', tools: ['calendario', 'navegador', 'internet'] });
  assert.equal(B.listBots(board).length, 3);
  const shop = B.getBot(board, 'Shop');
  assert.deepEqual(B.effectiveTools(board, shop), ['navegador', 'internet'], 'el calendario es exclusivo de Carl');
  assert.ok(B.effectiveTools(board, B.getBot(board, 'Jefe')).includes('gestion'), 'el jefe gestiona bots');
  const prompt = botPersona(board, shop);
  assert.match(prompt, /Carl: Calendario y agenda\. Exclusivo de: calendario/);
  assert.match(prompt, /Nada se envía, compra ni reserva sin mi aprobación/, 'la regla de oro por defecto');
  assert.match(prompt, /Jefe \(jefe\)/);
  assert.throws(() => B.createBot(board, { name: 'carl' }), /Ya hay un bot/);
  assert.throws(() => B.createBot(board, { name: 'X', tools: ['bash'] }), /Herramientas no válidas/);
  // Only one chief.
  B.updateBot(board, 'Shop', { is_chief: true }); assert.equal(B.listBots(board).filter((b) => b.is_chief).length, 1);
  B.updateBot(board, 'Jefe', { is_chief: true });
  // The assistant's conversation list leaves the bots' out.
  B.botConversation(board, shop);
  assert.ok(!board.conversations().some((c) => c.bot_id != null));
});

test('el jefe reparte al especialista con bot_send y la respuesta le vuelve', async () => {
  const fakeLog = path.join(t.base, 'fake.jsonl'); process.env.ORB_FAKE_LOG = fakeLog;
  bots.send('Jefe', 'Organiza mi semana\nBOT_CALL bot_send {"to":"Carl","text":"Apunta el dentista el martes a las 10","topic":"calendario"}');
  await until(() => botLines('Carl', 'Carl').length >= 1, 'Carl contesta', 20000);
  assert.ok(lines('Carl').some((l) => l.meta?.kind === 'relay' && l.meta.name === 'Jefe' && /dentista/.test(l.body)), 'el encargo del jefe, en el chat de Carl');
  await until(() => botLines('Jefe', 'Jefe').length >= 2, 'el jefe recibe la respuesta y sigue', 20000);
  assert.ok(lines('Jefe').some((l) => l.meta?.kind === 'relay' && l.meta.name === 'Carl'), 'la respuesta de Carl, en el chat del jefe');
  // Carl runs with its own brain (Codex here) and in bot mode; Claude bots get the persona as system prompt.
  const log = fs.readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const carl = log.find((l) => l.fake === 'codex' && /dentista/.test(l.text ?? ''));
  assert.ok(carl && carl.bot === true && carl.mcp.includes('bot'));
  assert.match(carl.text, /Eres «Carl»/, 'un agente que no es Claude recibe sus instrucciones al empezar');
  const jefe = log.find((l) => l.fake === 'claude' && l.systemPrompt);
  assert.match(jefe.systemPrompt, /Eres «Jefe»/);
  assert.ok(jefe.tools.disallowed.includes('Bash') && !jefe.tools.allowed.includes('WebSearch'), 'sin internet si no lo tiene');
  delete process.env.ORB_FAKE_LOG;
});

test('las exclusivas se respetan: un tema de Carl no se manda a otro', async () => {
  const before = board.one('SELECT COUNT(*) AS n FROM bot_requests').n;
  bots.send('Shop', 'Quiero cita\nBOT_CALL bot_send {"to":"Jefe","text":"Pon una cita","topic":"calendario"}');
  await until(() => botLines('Shop', 'Shop').length >= 1, 'Shop contesta', 20000);
  assert.match(botLines('Shop', 'Shop')[0].body, /exclusivo de Carl/);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM bot_requests').n, before, 'no sale ningún mensaje');
});

test('crear un bot pide siempre una tarjeta; solo con el OK existe', async () => {
  bots.send('Jefe', 'Crea uno para el correo\nBOT_CALL bot_create {"name":"Correo","role_text":"Mira el correo","tools":["correo"]}');
  const card = await until(() => lines('Jefe').find((l) => l.meta?.kind === 'bot_card' && l.meta.card === 'admin'), 'la tarjeta', 20000);
  assert.equal(card.meta.status, 'pending');
  assert.equal(B.getBot(board, 'Correo'), null, 'todavía no existe');
  const out = await bots.decide(card.id, 'allow');
  assert.equal(out.status, 'done');
  assert.ok(B.getBot(board, 'Correo'));
  await until(() => lines('Jefe').some((l) => l.role === 'bot' && /AVISO DEL SISTEMA/.test(l.body)), 'el jefe sabe que se aprobó', 20000);
  await assert.rejects(() => bots.decide(card.id, 'allow'), /ya está respondida/);
  // A bot without «gestion» has no bot_create at all.
  bots.send('Shop', 'Crea otro\nBOT_CALL bot_create {"name":"Otro"}');
  await until(() => botLines('Shop', 'Shop').length >= 2, 'Shop contesta', 20000);
  assert.match(botLines('Shop', 'Shop').at(-1).body, /desconocida/);
  assert.equal(B.getBot(board, 'Otro'), null);
  // Denied: nothing happens and the bot is told.
  bots.send('Jefe', 'Pausa a Shop\nBOT_CALL bot_pause {"name":"Shop","reason":"no se usa"}');
  const pause = await until(() => lines('Jefe').find((l) => l.meta?.kind === 'bot_card' && l.meta.payload?.action === 'pause'), 'tarjeta de pausa', 20000);
  await bots.decide(pause.id, 'deny');
  assert.equal(B.getBot(board, 'Shop').paused, false);
});

test('un recordatorio llega al chat de su bot y al móvil; las repeticiones siguen su calendario', async () => {
  bots.send('Carl', 'Recuérdamelo\nBOT_CALL bot_remind {"text":"Llamar al dentista","when":"2099-03-10T09:30","every":"once"}');
  await until(() => B.listReminders(board, { bot: B.getBot(board, 'Carl').id }).length === 1, 'recordatorio creado', 20000);
  const r = B.listReminders(board, { bot: B.getBot(board, 'Carl').id })[0];
  bots.fireReminders(Date.parse(r.next_run) + 1000);
  const line = lines('Carl').find((l) => l.meta?.kind === 'reminder');
  assert.match(line.body, /Llamar al dentista/);
  assert.ok(pushes.some((p) => p.title === 'Carl' && /dentista/.test(p.body)), 'aviso al móvil');
  assert.equal(B.getReminder(board, r.id).enabled, false, 'una vez: se acaba');
  const start = new Date(2026, 0, 31, 8, 0).toISOString();
  assert.equal(new Date(B.nextRun({ every: 'monthly', start_at: start }, Date.parse(start) + 1000)).getDate(), 28, 'mensual: el último día si el mes es corto');
  assert.equal(new Date(B.nextRun({ every: 'yearly', start_at: start }, Date.parse(start) + 1000)).getFullYear(), 2027);
  const weekly = new Date(B.nextRun({ every: 'weekly', start_at: start, weekdays: [1, 3] }, Date.parse(start)));
  assert.ok([1, 3].includes(weekly.getDay()) && weekly.getHours() === 8);
  assert.throws(() => B.createReminder(board, { bot_id: 'Carl', text: 'x', when: '2001-01-01T10:00' }), /ya ha pasado/);
});

test('la memoria no guarda contraseñas, tarjetas, IBAN ni DNI', async () => {
  assert.throws(() => B.writeMemory(B.getBot(board, 'Carl').id, 'Su IBAN es ES91 2100 0418 4502 0005 1332'), /no se guarda/);
  B.writeMemory(B.getBot(board, 'Carl').id, 'Prefiere las citas por la mañana');
  bots.send('Carl', 'Guárdalo\nBOT_CALL bot_memory_write {"text":"contraseña: perro1234"}');
  await until(() => botLines('Carl', 'Carl').some((l) => /no se guarda/.test(l.body)), 'rechazado', 20000);
  const mem = B.readMemory(B.getBot(board, 'Carl').id);
  assert.match(mem, /por la mañana/); assert.doesNotMatch(mem, /perro1234/);
  assert.ok(fs.existsSync(path.join(ctx.home, 'bots', String(B.getBot(board, 'Carl').id), 'memoria.md')));
  // The global memory: the chief keeps it.
  assert.throws(() => B.writeMemory('global', 'tarjeta 4111 1111 1111 1111'), /no se guarda/);
});

test('lo protegido (de serie, Vaultwarden) no se toca nunca, y lo que envía o compra pide permiso', async () => {
  const deny = decide({ permission: 'leer', tool: 'Read', paths: ['/srv/vaultwarden/data/db.sqlite3'], bot: true });
  assert.equal(deny.decision, 'deny'); assert.match(deny.reason, /protegido \(vaultwarden\)/);
  assert.equal(decide({ permission: 'total', tool: 'Bash', command: 'docker exec vaultwarden ls' }).decision, 'deny', 'ni con acceso total');
  assert.equal(decide({ permission: 'total', tool: 'Read', paths: ['C:\\Users\\u\\.ssh\\id_ed25519'] }).decision, 'deny', 'las claves de .ssh');
  assert.equal(decide({ permission: 'total', tool: 'Read', paths: ['/home/u/.ssh/known_hosts'] }).decision, 'allow', 'lo demás de .ssh sí');
  assert.equal(decide({ permission: 'total', tool: 'Bash', command: 'cat /data/keepassxc-notes.txt' }).decision, 'deny');
  assert.equal(decide({ permission: 'total', tool: 'Bash', command: 'npm run compass' }).decision, 'allow', 'una palabra entera, no un trozo');
  assert.throws(() => checkServerAction({ action: 'docker_restart', target: 'vaultwarden', reason: 'x' }), /protegido \(vaultwarden\)/);
  assert.throws(() => checkServerAction({ action: 'docker_update', target: '/opt/vaultwarden', reason: 'x' }), /protegido/);
  await assert.rejects(() => serverLogs({ name: 'vaultwarden' }), /protegido/);
  assert.throws(() => B.writeMemory('global', 'la carpeta de vaultwarden está en /opt'), /protegido \(vaultwarden\)/);
  assert.equal(decide({ permission: 'leer', tool: 'mcp__gmail__send_message', bot: true }).decision, 'ask');
  assert.equal(decide({ permission: 'leer', tool: 'mcp__calendar__create_event', bot: true }).decision, 'ask');
  assert.equal(decide({ permission: 'leer', tool: 'mcp__gmail__search_threads', bot: true }).decision, 'allow');
  assert.equal(decide({ permission: 'leer', tool: 'mcp__bot__bot_send', bot: true }).decision, 'allow');
  assert.equal(decide({ permission: 'leer', tool: 'Bash', command: 'ls', bot: true }).decision, 'deny', 'un bot no ejecuta comandos');
  assert.throws(() => checkServerAction({ action: 'rm_rf', reason: 'x' }), /no válida/);
});

test('lo protegido lo elige el usuario: una entrada suya se respeta y quitar una de serie la libera', async () => {
  const before = ctx.config.protected;
  try {
    ctx.config.protected = [...before.filter((x) => x !== 'vaultwarden'), '/srv/copias', 'mi-nas'];
    assert.equal(decide({ permission: 'total', tool: 'Bash', command: 'rm -r /srv/copias/2024' }).decision, 'deny');
    assert.match(decide({ permission: 'total', tool: 'Bash', command: 'docker restart mi-nas' }).reason, /mi-nas/);
    assert.throws(() => checkServerAction({ action: 'docker_restart', target: 'mi-nas', reason: 'x' }), /protegido \(mi-nas\)/);
    assert.throws(() => B.writeMemory('global', 'Las copias están en /srv/copias'), /protegido/);
    assert.equal(decide({ permission: 'total', tool: 'Bash', command: 'docker exec vaultwarden ls' }).decision, 'allow', 'ya no está en la lista');
    const persona = botPersona(board, B.getBot(board, 'Carl'));
    assert.match(persona, /mi-nas/); assert.match(persona, /\/srv\/copias/); assert.doesNotMatch(persona, /vaultwarden/);
  } finally { ctx.config.protected = before; }
});

test('en un grupo contesta primero el jefe y luego los demás', async () => {
  const g = B.createGroup(board, { name: 'Personal', members: ['Carl', 'Jefe'] });
  assert.deepEqual(B.groupMembers(board, g.id).map((b) => b.name), ['Jefe', 'Carl']);
  const r = bots.sendGroup(g.id, '¿Qué tengo mañana?');
  const replies = await r.done;
  assert.deepEqual(replies.map((x) => x.name), ['Jefe', 'Carl']);
  const said = board.chat(r.conversation).filter((l) => l.role === 'bot').map((l) => l.meta.name);
  assert.deepEqual(said, ['Jefe', 'Carl']);
  assert.ok(events.some(([e]) => e === 'bot.message'));
});

test('el motor: Asistente la primera vez, la API de los bots y los permisos del móvil', async () => {
  const t2 = tempHome();
  const engine = await startEngine(t2.home);
  try {
    const list = await engine.call('bots.list');
    assert.deepEqual(list.bots.map((b) => b.name), ['Asistente']);
    assert.ok(list.tools.includes('servidor'));
    const b = await engine.call('bots.create', { name: 'Casa', role_text: 'La domótica', tools: ['casa'] });
    await engine.call('bots.send', { id: b.id, text: 'Hola' });
    await until(async () => (await engine.call('bots.chat', { id: b.id })).lines.some((l) => l.role === 'bot'), 'respuesta', 20000);
    assert.ok(engine.events.some((e) => e.event === 'bot.message'));
    assert.deepEqual(await engine.call('bots.rules.set', { rules: ['Agrupa las preguntas'] }), ['Agrupa las preguntas']);
    assert.ok((await engine.call('bots.protected.get')).includes('vaultwarden'), 'de serie, los gestores de contraseñas');
    assert.deepEqual(await engine.call('bots.protected.set', { items: ['vaultwarden', ' /srv/copias ', 'VAULTWARDEN', 'x'] }), ['vaultwarden', '/srv/copias']);
    await engine.call('bots.memory.set', { id: 'global', text: 'Prefiere el té al café' });
    assert.equal((await engine.call('bots.memory.get', { id: 'global' })).text, 'Prefiere el té al café');
    await assert.rejects(() => engine.call('bots.memory.set', { id: b.id, text: 'DNI 12345678Z' }), /no se guarda/);
    const ha = await engine.call('bots.ha.set', { url: 'http://192.168.1.10:8123/', token: 'abc' });
    assert.deepEqual(ha, { url: 'http://192.168.1.10:8123', hasToken: true });
  } finally { await engine.stop(); t2.cleanup(); }
  // 3.5 (interface): a phone or a browser talks to the bots; changing them is for the PC.
  const { PHONE_SET } = await import('../src/core/policy.mjs');
  for (const m of ['bots.send', 'bots.decide', 'bots.chat']) assert.ok(PHONE_SET.has(m), m);
  for (const m of ['bots.create', 'bots.ha.set', 'bots.rules.set', 'bots.memory.set']) assert.ok(!PHONE_SET.has(m), `${m}: solo en el PC`);
});
