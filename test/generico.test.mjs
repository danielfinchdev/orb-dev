// 3.5, Orb for anyone (not only «a laptop, a Linux server and a phone»): the role of an Orb is the user's choice («todo»,
// «centro» or «taller»), a PC on its own does everything with its own bots and no links, where the bots live is chosen
// (and «Llevar mis bots» takes them there with their memory and reminders), the Orb mode of a phone goes to the Orb that
// programs (or the one chosen in «Orb para programar»), and a linked device may administer only if it is marked so.
// Engines on loopback with the fake agents.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine, until, ROOT } from './helpers.mjs';
import { loadConfig, writeJson, paths, hostsBots, doesDev } from '../src/core/home.mjs';
import { createLink } from '../src/core/link.mjs';
import { botsPrefix, canManageBots, devChoices, botsLocationCard, roleKey } from '../src/ui/lib/bots.js';

const env = { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1' };
let hub; let laptop; let tHub; let tLaptop; let port; let dir; const links = [];
const newClient = (name, kind = 'browser') => { const l = createLink({ file: path.join(dir, `${crypto.randomUUID()}.json`), secret: crypto.randomBytes(32), identity: () => ({ name, kind }) }); links.push(l); return l; };

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  port = 20000 + Math.floor(Math.random() * 20000);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-generico-'));
  // The hub is a PC that does everything (no server anywhere); the laptop only programs.
  tHub = tempHome({ mobile: { enabled: true, port, name: 'Sobremesa' } });
  tLaptop = tempHome({ role: 'taller', mobile: { name: 'Portátil' } });
  hub = await startEngine(tHub.home, { env });
  laptop = await startEngine(tLaptop.home, { env });
  await until(async () => (await hub.call('remote.status')).running, 'acceso del sobremesa');
});
after(async () => {
  for (const l of links) l.stop();
  await laptop?.stop(); await hub?.stop();
  tLaptop?.cleanup(); tHub?.cleanup();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
});

test('el papel: sin él, «todo»; lo que Orb no conoce se quita; centro y taller se guardan', () => {
  const t = tempHome();
  try {
    const file = paths(t.home).config;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')); delete raw.role; writeJson(file, raw);
    assert.equal(loadConfig(t.home).role, undefined, 'sin papel en el archivo (el motor lo lee como «todo»)');
    writeJson(file, { ...raw, role: 'raro' });
    assert.equal(loadConfig(t.home).role, undefined, 'un papel desconocido se quita');
    for (const r of ['centro', 'taller', 'todo']) { writeJson(file, { ...raw, role: r }); assert.equal(loadConfig(t.home).role, r); }
    assert.equal(loadConfig(t.home).bots.location, 'local', 'los bots, en este Orb por defecto');
  } finally { t.cleanup(); }
  assert.deepEqual(['todo', 'centro', 'taller'].map(hostsBots), [true, true, false]);
  assert.deepEqual(['todo', 'centro', 'taller'].map(doesDev), [true, false, true]);
  assert.equal(roleKey(undefined), 'link.role.todo');
});

test('un solo PC: lo hace todo, con sus bots y sin enlaces', async () => {
  const st = await hub.call('app.state');
  assert.equal(st.role, 'todo');
  assert.ok((await hub.call('bots.list')).bots.some((b) => b.name === 'Asistente'), 'sus propios bots');
  assert.deepEqual(await hub.call('centro.status'), { linked: false });
  const where = await hub.call('bots.where');
  assert.deepEqual([where.location, where.peers, where.ask], ['local', [], null]);
  const ls = await hub.call('link.status');
  assert.equal(ls.dev, 'local', 'programa él mismo');
  assert.equal(ls.taller, null);
  const b = await hub.call('bots.create', { name: 'Notas', role_text: 'Apunta lo que le digo', tools: ['recordatorios'] });
  assert.equal(b.name, 'Notas');
  await hub.call('bots.delete', { id: b.id });
});

test('dónde viven los bots: se pregunta al enlazar y «Llevar mis bots» los lleva con memoria y recordatorios', async () => {
  const agenda = await laptop.call('bots.create', { name: 'Agenda', icon: '📅', role_text: 'Mis citas', tools: ['recordatorios'] });
  await laptop.call('bots.memory.set', { id: agenda.id, text: 'Prefiere las citas por la tarde' });
  const p2 = (x) => String(x).padStart(2, '0'); const d = new Date(Date.now() + 3 * 86_400_000);
  await laptop.call('bots.reminders.create', { id: agenda.id, text: 'Cita con el dentista', when: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T10:00` });

  const q = await hub.call('link.qr', { device: 'orb', dev: true });
  const peer = await laptop.call('link.connect', { code: q.code, address: `127.0.0.1:${port}` });
  assert.equal(peer.role, 'todo');
  await until(async () => (await laptop.call('centro.status')).online, 'el sobremesa en línea');
  const where = await laptop.call('bots.where');
  assert.equal(where.ask?.id, peer.id, 'la tarjeta pregunta por el Orb enlazado');
  assert.ok(where.localBots >= 2, 'y sabe que aquí hay bots');
  assert.equal(botsLocationCard(where).canBring, true);
  assert.equal(botsPrefix(await laptop.call('centro.status')), '', 'hasta que el usuario elija, los bots son los de aquí');

  const r = await laptop.call('bots.moveTo', { location: peer.id, bring: true });
  assert.equal(r.location, peer.id);
  assert.ok(r.moved >= 1);
  assert.deepEqual(r.skipped, ['Asistente'], 'el «Asistente» sin tocar no se duplica');
  const there = (await hub.call('bots.list')).bots.find((b) => b.name === 'Agenda');
  assert.ok(there, 'Agenda está en el sobremesa');
  assert.match((await hub.call('bots.memory.get', { id: there.id })).text, /por la tarde/);
  assert.ok((await hub.call('bots.reminders.list', { id: there.id })).some((x) => x.text === 'Cita con el dentista'), 'con su recordatorio');
  const here = (await laptop.call('bots.list')).bots.find((b) => b.name === 'Agenda');
  assert.equal(here.paused, true, 'aquí queda en pausa, a la vista');
  assert.equal((await laptop.call('bots.reminders.list', { id: here.id })).length, 0, 'y sin recordatorios que sonarían dos veces');
  const st = await laptop.call('centro.status');
  assert.equal(st.active, true);
  assert.equal(botsPrefix(st), 'centro.', 'la interfaz usa ahora los bots del sobremesa');
  assert.equal((await laptop.call('bots.where')).ask, null, 'ya no se pregunta');

  await laptop.call('bots.moveTo', { location: 'local' });
  assert.equal((await laptop.call('centro.status')).active, false, 'de vuelta en este Orb');
  await assert.rejects(laptop.call('bots.moveTo', { location: 'no-existe' }), /bots/);
});

test('«Puede administrar»: un navegador enlazado no gestiona nada hasta que se marca', async () => {
  const q = await hub.call('link.qr');
  const browser = newClient('Navegador de prueba', 'browser');
  const me = await browser.connect({ qr: q.url });
  assert.equal((await hub.call('link.devices')).find((x) => x.id === me.id).admin, false, 'apagado por defecto');
  await assert.rejects(browser.call(null, 'bots.create', { name: 'Intruso' }), (e) => e.status === 403);
  await assert.rejects(browser.call(null, 'link.qr'), (e) => e.status === 403);
  assert.equal((await browser.call(null, 'app.state')).access.bots, false);
  assert.equal(canManageBots({ mobile: true, access: (await browser.call(null, 'app.state')).access }), false);

  await hub.call('link.setAdmin', { id: me.id, admin: true });
  const b = await browser.call(null, 'bots.create', { name: 'Desde el navegador', tools: ['recordatorios'] });
  assert.ok(b.id);
  assert.ok((await browser.call(null, 'link.devices')).length >= 1, 'y los enlaces');
  assert.deepEqual((await browser.call(null, 'app.state')).access, { admin: true, bots: true, links: true, approve: true });
  await assert.rejects(browser.call(null, 'sessions.create', { agent: 'claude', permission: 'total' }), (e) => e.status === 403, 'nunca acceso total');

  await hub.call('link.setAdmin', { id: me.id, admin: false });
  await assert.rejects(browser.call(null, 'bots.delete', { id: b.id }), (e) => e.status === 403, 'quitado al momento');
  await hub.call('bots.delete', { id: b.id });
});

test('Orb para programar: el modo Orb del móvil va al Orb que programa, o al elegido', async () => {
  await laptop.call('projects.create', { name: 'del-portatil' });
  const q = await hub.call('link.qr');
  const phone = newClient('Móvil de prueba', 'phone');
  await phone.connect({ qr: q.url });
  await until(() => phone.peers()[0]?.online, 'eventos del móvil');
  const names = async () => (await phone.call(null, 'projects.list')).map((p) => p.name);

  // The hub does everything: by itself, the phone's Orb mode stays here.
  let ls = await hub.call('link.status');
  assert.equal(ls.dev, 'local');
  assert.ok(ls.tallers.some((d) => d.name === 'Portátil'), 'el portátil puede programar');
  assert.deepEqual(devChoices(ls).map((c) => c.value), ['local', ls.tallers[0].id]);
  assert.ok(!(await names()).includes('del-portatil'));

  // Chosen in «Orb para programar»: there it goes, with its live events under their own name.
  const seen = [];
  phone.on('board:changed', (p) => seen.push(p));
  await hub.call('config.save', { patch: { devTarget: ls.tallers[0].id } });
  ls = await hub.call('link.status');
  assert.equal(ls.dev, 'remote');
  assert.equal(ls.taller.name, 'Portátil');
  assert.equal((await phone.call(null, 'link.status')).taller.name, 'Portátil', 'el aviso del móvil lo nombra');
  await until(async () => (await names()).includes('del-portatil'), 'los proyectos del portátil', 20000);
  assert.ok((await phone.call(null, 'bots.list')).bots.length >= 1, 'los bots siguen siendo los del sobremesa');
  await laptop.call('projects.create', { name: 'otro-del-portatil' });
  await until(() => seen.length > 0, 'los eventos del portátil llegan al móvil', 20000);

  // A hub that does not program sends it there by itself.
  await hub.call('config.save', { patch: { devTarget: '', role: 'centro' } });
  assert.equal((await hub.call('link.status')).dev, 'remote');
  assert.ok((await names()).includes('del-portatil'));
  await hub.call('config.save', { patch: { role: 'todo' } });
  assert.equal((await hub.call('link.status')).dev, 'local');
  assert.ok(!(await names()).includes('del-portatil'), 'de vuelta aquí');
});

test('Orb Núcleo: el primer dispositivo de «orb-nucleo enlazar» puede administrar, el resto no; sin ventana no hay God mode', async () => {
  const p2 = port + 7;
  const t = tempHome({ role: 'centro', mobile: { enabled: true, port: p2, name: 'Servidor' } });
  const e = await startEngine(t.home, { env: { ...env, ORB_NUCLEO: '1' } });
  try {
    await until(async () => (await e.call('remote.status')).running, 'acceso del servidor');
    await assert.rejects(e.call('expert.status', {}), /servidor/);
    const first = newClient('Primer navegador');
    const a = await first.connect({ qr: (await e.call('link.qr', { admin: 'first' })).url });
    const second = newClient('Segundo navegador');
    const b = await second.connect({ qr: (await e.call('link.qr', { admin: 'first' })).url });
    const third = newClient('Móvil');
    const c = await third.connect({ qr: (await e.call('link.qr')).url });
    const list = await e.call('link.devices');
    assert.deepEqual([a, b, c].map((x) => list.find((d) => d.id === x.id).admin), [true, false, false]);
    assert.ok((await first.call(null, 'link.devices')).length === 3, 'el primero administra');
  } finally { await e.stop(); t.cleanup(); }
  // A PC with a window never hands it out by itself.
  const q = await hub.call('link.qr', { admin: true });
  const x = await newClient('Otro').connect({ qr: q.url });
  assert.equal((await hub.call('link.devices')).find((d) => d.id === x.id).admin, false);
});
