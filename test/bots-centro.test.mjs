// 3.5, one Orb per user: the bots live on the centre (the server). A workshop (the laptop) linked with it manages and
// talks to the centre's bots through centro.<method>, and what they say comes back live as centro:bot.*. A workshop on
// its own keeps its bots at home. Two engines on loopback with the fake agents.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine, until, ROOT } from './helpers.mjs';
import { allowedFor, CENTRO_FORWARD } from '../src/engine/remote.mjs';

let centro; let taller; let tCentro; let tTaller; let port;

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  port = 20000 + Math.floor(Math.random() * 20000);
  tCentro = tempHome({ role: 'centro', mobile: { enabled: true, port, name: 'Servidor' } });
  tTaller = tempHome({ role: 'taller', mobile: { name: 'Portátil' } });
  const env = { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1' };
  centro = await startEngine(tCentro.home, { env });
  taller = await startEngine(tTaller.home, { env });
  await until(async () => (await centro.call('remote.status')).running, 'acceso del centro');
});
after(async () => { await taller?.stop(); await centro?.stop(); tTaller?.cleanup(); tCentro?.cleanup(); });

test('lo que puede cada dispositivo: el móvil habla con los bots; el Orb del usuario y el navegador del servidor los gestionan', () => {
  assert.ok(!allowedFor('centro', 'phone').has('bots.create'), 'un móvil no crea bots');
  assert.ok(allowedFor('centro', 'orb').has('bots.create') && !allowedFor('centro', 'orb').has('link.qr'), 'el Orb enlazado gestiona bots, no enlaces');
  assert.ok(allowedFor('todo', 'orb').has('bots.create'), 'también en un Orb que lo hace todo');
  assert.ok(!allowedFor('taller', 'orb').has('bots.create'), 'un taller no guarda bots para otros');
  assert.ok(!allowedFor('centro', 'browser').has('link.qr') && !allowedFor('centro', 'browser').has('bots.rules.set'), 'ser un navegador no da permiso de administrar');
  assert.ok(allowedFor('centro', 'browser', true).has('link.qr') && allowedFor('centro', 'phone', true).has('bots.rules.set'), '«Puede administrar» sí');
  assert.ok(!allowedFor('taller', 'browser').has('bots.create'), 'en un PC, el navegador enlazado es como un móvil');
  assert.ok([...CENTRO_FORWARD].every((m) => m.startsWith('bots.')), 'al centro solo van los bots');
});

test('sin centro, los bots son los de este Orb', async () => {
  assert.deepEqual(await taller.call('centro.status'), { linked: false });
  await assert.rejects(taller.call('centro.bots.list'), /bots/i);
  const local = await taller.call('bots.list');
  assert.ok(local.bots.some((b) => b.name === 'Asistente'), 'el bot inicial, en casa');
});

test('enlazado con el centro: crear un bot desde el portátil lo crea en el servidor y sus mensajes llegan en directo', async () => {
  const q = await centro.call('link.qr');
  await taller.call('link.connect', { code: q.code, address: `127.0.0.1:${port}` });
  await until(async () => (await taller.call('centro.status')).online, 'el centro en línea');
  const st = await taller.call('centro.status');
  assert.equal(st.name, 'Servidor');
  assert.equal(st.active, false, 'enlazar no cambia dónde están los bots: lo elige el usuario');
  const where = await taller.call('bots.where');
  assert.equal(where.location, 'local');
  assert.equal(where.ask?.name, 'Servidor', 'se pregunta dónde los quiere');
  assert.ok((await taller.call('bots.list')).bots.some((b) => b.name === 'Asistente'), 'los bots de aquí siguen a la vista');

  const bot = await taller.call('centro.bots.create', { name: 'Agenda', icon: '📅', role_text: 'Calendario y citas', tools: ['recordatorios'] });
  assert.ok((await centro.call('bots.list')).bots.some((b) => b.id === bot.id && b.name === 'Agenda'), 'el bot está en el servidor');
  assert.ok(!(await taller.call('bots.list')).bots.some((b) => b.name === 'Agenda'), 'y no en el portátil');
  await taller.call('centro.bots.memory.set', { id: bot.id, text: 'Le gustan las citas por la mañana' });
  assert.match((await centro.call('bots.memory.get', { id: bot.id })).text, /por la mañana/);
  await assert.rejects(taller.call('centro.link.qr'), 'solo los bots pasan al centro');

  const before = taller.events.length;
  await taller.call('centro.bots.send', { id: bot.id, text: 'Hola Agenda' });
  const relayed = await until(() => taller.events.slice(before).find((e) => e.event === 'centro:bot.message' && e.payload?.role === 'bot' && e.payload?.meta?.name === 'Agenda'), 'la respuesta del bot, en directo', 30000);
  assert.match(relayed.payload.body, /Recibido/);
  assert.ok(taller.events.slice(before).some((e) => e.event === 'centro:bot.state'), 'y su estado');
  const chat = await taller.call('centro.bots.chat', { id: bot.id });
  assert.ok(chat.lines.some((l) => l.role === 'usuario' && /Hola Agenda/.test(l.body)));
});
