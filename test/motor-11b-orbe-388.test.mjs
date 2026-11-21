// 3.8.8 paso 11b (tanda 2), motor del chat con Orbe: «+» (chat.send admite adjuntos con las mismas comprobaciones que
// sessions.send) y la tarjeta «parada» (un turno que Orb mismo corta deja su mensaje con tipo y motivo en la conversación).
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator, assistantDir } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, METHODS, REMOTE_METHODS } from '../src/domain/security/permissions.mjs';
import { ctx } from '../src/platform/context.mjs';
import { git } from '../src/platform/git.mjs';

let t; let board; let api; let sessions; let orchestrator; let project; let outside;
const sent = [];
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

before(() => {
  t = tempHome(); board = new Board();
  orchestrator = new Orchestrator(board, { emit: () => {} });
  // the assistant's process is replaced by one that records what it receives
  const make = orchestrator.lane.bind(orchestrator);
  orchestrator.lane = (id) => {
    const l = make(id);
    l.ensureLive = () => {
      l.liveAgent = 'claude';
      l.live ??= { send: async (turn) => { sent.push(turn); return { text: 'hecho', final: 'hecho' }; }, isClosed: () => false, close() {}, interrupt() {} };
    };
    return l;
  };
  sessions = new Sessions(board, { emit: () => {} });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  project = path.join(t.home, 'web', 'orbe11b'); fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(project, 'a.txt'), 'one\n');
  board.addProject({ name: 'orbe11b', path: project }, 'usuario', { fromUser: true });
  outside = path.join(t.home, 'archivos-de-dani'); fs.mkdirSync(outside, { recursive: true });
});
after(() => { try { orchestrator.stopAll(); sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const conversations = () => board.all('SELECT id FROM conversations').length;

test('chat.send con un adjunto válido lo copia a la carpeta del chat, lo guarda en el mensaje y se lo da a Orbe', async () => {
  const file = path.join(outside, 'captura ñ (1).png'); fs.writeFileSync(file, png);
  const r = await call('chat.send', { text: 'mira esto', images: [file] });
  await settle();
  const row = board.chat(r.conversation).find((m) => m.role === 'usuario');
  assert.equal(row.body, 'mira esto');
  assert.equal(row.meta.images.length, 1);
  const kept = row.meta.images[0];
  assert.ok(kept.startsWith(path.join(assistantDir(), 'adjuntos', String(r.conversation))), 'in the conversation own folder');
  assert.match(path.basename(kept), /^[\w.-]+$/, 'the name is cleaned as in an agent chat');
  assert.deepEqual(fs.readFileSync(kept), png);
  assert.ok(fs.existsSync(file), 'the original stays where it was');
  // the conversation saved on disk keeps them on reload
  assert.deepEqual(board.chat(r.conversation).find((m) => m.role === 'usuario').meta.images, [kept]);
  const turn = sent.at(-1);
  assert.match(turn.text, /mira esto/);
  assert.ok(turn.text.includes(kept), 'the brain is told where the file is');
});

test('el segundo mensaje de la misma conversación también lleva su adjunto, y sin adjuntos nada cambia', async () => {
  const first = await call('chat.send', { text: 'uno' });
  await settle();
  assert.equal(board.chat(first.conversation).find((m) => m.role === 'usuario').meta, null, 'no attachments, no new field');
  const file = path.join(outside, 'nota.txt'); fs.writeFileSync(file, 'hola');
  await call('chat.send', { text: 'dos', conversation: first.conversation, images: [file] });
  await settle();
  const mine = board.chat(first.conversation).filter((m) => m.role === 'usuario');
  assert.equal(mine[0].meta, null);
  assert.equal(mine[1].meta.images.length, 1);
  assert.match(sent.at(-1).text, /nota\.txt/);
});

test('un adjunto demasiado grande, una ruta no permitida o una lista fuera de límites se rechazan sin crear nada', async () => {
  const before = conversations(); const lines = board.all('SELECT id FROM chat').length;
  const big = path.join(outside, 'enorme.bin'); fs.closeSync(fs.openSync(big, 'w')); fs.truncateSync(big, 101 * 1024 * 1024);
  await assert.rejects(call('chat.send', { text: 'x', images: [big] }), /enorme\.bin|supera|too large|exceeds/i);
  // a path inside Orb's own data
  const secret = path.join(ctx.paths.internal, 'secreto.txt'); fs.mkdirSync(ctx.paths.internal, { recursive: true }); fs.writeFileSync(secret, 'no');
  await assert.rejects(call('chat.send', { text: 'x', images: [secret] }));
  // a folder, a missing file and a relative path
  await assert.rejects(call('chat.send', { text: 'x', images: [outside] }));
  await assert.rejects(call('chat.send', { text: 'x', images: [path.join(outside, 'no-existe.png')] }));
  await assert.rejects(call('chat.send', { text: 'x', images: ['relativa.png'] }));
  // eleven files, and something that is not a list of paths
  const ok = path.join(outside, 'ok.png'); fs.writeFileSync(ok, png);
  await assert.rejects(call('chat.send', { text: 'x', images: Array(11).fill(ok) }));
  await assert.rejects(call('chat.send', { text: 'x', images: [{ path: ok }] }));
  assert.equal(conversations(), before, 'no empty conversation is left behind');
  assert.equal(board.all('SELECT id FROM chat').length, lines, 'no line is saved');
  // an existing conversation keeps its lines too
  const c = (await call('chat.send', { text: 'base' })).conversation; await settle();
  const n = board.chat(c).length;
  await assert.rejects(call('chat.send', { text: 'otra', conversation: c, images: [big] }));
  assert.equal(board.chat(c).length, n);
});

test('una conversación nueva con el cerebro elegido tampoco queda vacía si su adjunto se rechaza', async () => {
  const before = conversations();
  await assert.rejects(call('chat.send', { text: 'x', brain: { agent: 'claude' }, images: [outside] }));
  assert.equal(conversations(), before, 'the conversation made for the message goes with it');
  const ok = path.join(outside, 'con-cerebro.png'); fs.writeFileSync(ok, png);
  const r = await call('chat.send', { text: 'con cerebro', brain: { agent: 'claude' }, images: [ok] }); await settle();
  assert.equal(board.chat(r.conversation).find((m) => m.role === 'usuario').meta.images.length, 1);
});

test('al borrar la conversación se borran las copias de sus adjuntos, y solo las suyas', async () => {
  const file = path.join(outside, 'privado.png'); fs.writeFileSync(file, png);
  const a = (await call('chat.send', { text: 'a', images: [file] })).conversation; await settle();
  const b = (await call('chat.send', { text: 'b', images: [file] })).conversation; await settle();
  const dir = (id) => path.join(assistantDir(), 'adjuntos', String(id));
  assert.ok(fs.existsSync(dir(a)) && fs.existsSync(dir(b)));
  await call('conversations.remove', { id: a });
  assert.equal(fs.existsSync(dir(a)), false, 'its copies are gone');
  assert.ok(fs.existsSync(dir(b)), 'another conversation keeps its own');
  assert.ok(fs.existsSync(file), 'the original is never touched');
  // nothing but a conversation's number reaches the folder name
  for (const bad of ['..', '../..', 0, -1, 1.5, null]) orchestrator.forgetAttachments(bad);
  assert.ok(fs.existsSync(dir(b)) && fs.existsSync(path.join(assistantDir(), 'adjuntos')));
});

test('«/compact» con adjuntos es un mensaje normal, no el comando', async () => {
  const c = (await call('chat.send', { text: 'base2' })).conversation; await settle();
  const file = path.join(outside, 'c.png'); fs.writeFileSync(file, png);
  const r = await call('chat.send', { text: '/compact', conversation: c, images: [file] });
  assert.equal(r.conversation, c);
  assert.equal(board.chat(c).filter((m) => m.role === 'usuario').at(-1).body, '/compact');
});

test('el móvil: chat.send sigue siendo de la misma clase que sessions.send y el guard de `images` del enlace es el mismo', () => {
  assert.ok(REMOTE_METHODS.has('chat.send'));
  assert.ok(REMOTE_METHODS.has('sessions.send'));
  assert.equal(METHODS['chat.send'], METHODS['sessions.send']);
});

test('una parada real (la guardia corta el turno de una tarea) deja su mensaje en la conversación con tipo y motivo', async () => {
  const conv = board.createConversation({ title: 'Pide', project: 'orbe11b' }).id;
  const task = board.createTask({ project: 'orbe11b', title: 'Limpiar', description: 'x', conversation_id: conv }, 'orb');
  const s = sessions.create({ kind: 'task', agent: 'codex', cwd: project, title: 'Limpiar', taskId: task.id });
  const why = 'lee los datos de Orb';
  sessions.onLiveEvent(s.id, { type: 'item', role: 'system', kind: 'status', body: `Orb ha parado el turno: ${why}.`, stop: { cause: 'guard', why } });
  const line = board.chat(conv).find((m) => m.meta?.kind === 'turn-stopped');
  assert.ok(line, 'the conversation has the line');
  assert.equal(line.role, 'system');
  assert.equal(line.meta.cause, 'guard'); assert.equal(line.meta.why, why); assert.equal(line.meta.task, task.id); assert.equal(line.meta.agent, 'codex');
  assert.match(line.body, /Orb ha parado el turno/, 'a plain line for whoever does not know the type');
  // the session keeps its own item as ever
  assert.ok(sessions.items(s.id).some((i) => i.kind === 'status' && /parado el turno/.test(JSON.stringify(i.body))));
  // an item that does not stop anything says nothing in the conversation
  const count = board.chat(conv).length;
  sessions.onLiveEvent(s.id, { type: 'item', role: 'system', kind: 'status', body: 'otra cosa' });
  assert.equal(board.chat(conv).length, count);
});

test('la parada de una tarea sin conversación o de una conversación directa no escribe nada en el chat con Orbe', () => {
  const lines = board.all('SELECT id FROM chat').length;
  const direct = sessions.create({ kind: 'chat', agent: 'codex', cwd: project, title: 'directo' });
  sessions.onLiveEvent(direct.id, { type: 'item', role: 'system', kind: 'status', body: 'parado', stop: { cause: 'guard', why: 'x' } });
  assert.equal(board.all('SELECT id FROM chat').length, lines);
});

test('el límite de tiempo de un turno de Orbe queda como parada con su tipo', async () => {
  const conv = board.createConversation({ title: 'Larga' }).id;
  const lane = orchestrator.lane(conv);
  const src = fs.readFileSync(new URL('../src/engine/orchestrator.mjs', import.meta.url), 'utf8');
  assert.match(src, /tr\('msg\.orch\.timeLimit'\), \{ kind: 'turn-stopped', cause: 'time' \}/);
  assert.ok(lane);
});
