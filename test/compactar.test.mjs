// 3.6, ola 1 de diseño: «Compactar» y el razonamiento «Extra». Con los agentes falsos (ORB_FAKE_AGENTS):
// - una conversación con Orbe al 80 % de su contexto se compacta con la compactación propia de su agente (la misma
//   conversación sigue, el contexto baja y el historial se queda); si el agente no puede, se renueva (empieza de cero con
//   el resumen de siempre: bitácoras y últimas líneas);
// - una conversación directa con Claude se compacta igual; con un agente que no sabe (Cursor), Orb lo dice;
// - el adaptador real de Codex pide thread/compact/start al app-server (el falso de test/fixtures) y, si no existe, falla
//   sin romper nada;
// - «Extra» (xhigh) solo con un modelo que lo admite; al pasar a uno que no, queda «Alto».
import { tempHome, until, startEngine, fake, fakeLog } from './helpers.mjs';
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as codex from '../src/agents/codex.mjs';

let t; let engine;
afterEach(async () => { await engine?.stop(); engine = null; t?.cleanup(); });
const lines = async (call, conversation) => call('chat.list', { conversation });
const assistantLog = (home) => { try { return fs.readFileSync(path.join(home, 'core', 'ejecuciones', 'asistente.log'), 'utf8'); } catch { return ''; } };

test('Orbe: con el contexto casi lleno, «Compactar» usa la compactación del agente y la conversación sigue', async () => {
  t = tempHome();
  engine = await startEngine(t.home);
  const { call } = engine;
  const { conversation } = await call('chat.send', { text: 'Hola, revisa todo CONTEXTO_LLENO' });
  await until(async () => (await lines(call, conversation)).some((m) => m.role === 'orb'), 'respuesta');
  const before = (await call('conversations.list')).find((c) => c.id === conversation);
  assert.ok(before.context?.size && before.context.used / before.context.size >= 0.7, `contexto casi lleno (${JSON.stringify(before.context)})`);

  const r = await call('chat.compact', { conversation });
  assert.deepEqual(r, { ok: true, how: 'compacted' });
  assert.match(assistantLog(t.home), /"compact":true/, 'el agente compactó');
  const after = (await call('conversations.list')).find((c) => c.id === conversation);
  assert.ok(after.context.used / after.context.size < 0.2, 'el contexto bajó');
  const list = await lines(call, conversation);
  assert.ok(list.some((m) => m.role === 'system' && /Conversación compactada/.test(m.body)), 'lo dice en la conversación');
  assert.ok(list.some((m) => m.role === 'usuario' && /revisa todo/.test(m.body)), 'el historial se queda');

  // The same conversation goes on (no fresh start with the briefing).
  await call('chat.send', { text: 'Y ahora sigue', conversation });
  await until(async () => (await lines(call, conversation)).filter((m) => m.role === 'orb').length === 2, 'segunda respuesta');
  const turns = assistantLog(t.home).split('\n').filter((l) => /"turn":2/.test(l));
  assert.ok(turns.length && !/## Mensaje/.test(turns.at(-1)), 'sigue la misma conversación del agente');
});

test('Orbe: si el agente no puede compactar, la conversación se renueva con su resumen', async () => {
  t = tempHome();
  engine = await startEngine(t.home, { env: { ORB_FAKE_COMPACT_FAILS: '1' } });
  const { call } = engine;
  const { conversation } = await call('chat.send', { text: 'Primera parte CONTEXTO_LLENO' });
  await until(async () => (await lines(call, conversation)).some((m) => m.role === 'orb'), 'respuesta');
  const r = await call('chat.compact', { conversation });
  assert.deepEqual(r, { ok: true, how: 'renewed' });
  assert.equal((await call('conversations.list')).find((c) => c.id === conversation).context, null, 'empieza con el contexto vacío');
  await call('chat.send', { text: 'Segunda parte', conversation });
  await until(async () => (await lines(call, conversation)).filter((m) => m.role === 'orb').length === 2, 'respuesta tras renovar');
  assert.match(assistantLog(t.home), /Primera parte/, 'la nueva conversación del agente parte de las últimas líneas');
});

test('conversación directa: Claude compacta; Cursor no sabe y Orb lo dice', async () => {
  t = tempHome();
  engine = await startEngine(t.home);
  const { call } = engine;
  await call('projects.create', { name: 'web' });
  const s = await call('sessions.create', { agent: 'claude', project: 'web' });
  await call('sessions.send', { id: s.id, text: 'Mira el proyecto CONTEXTO_LLENO' });
  await until(async () => { const x = (await call('sessions.list')).find((y) => y.id === s.id); return x.status === 'idle' && x.context?.used >= 140_000 && x; }, 'turno con el contexto casi lleno');
  const r = await call('sessions.compact', { id: s.id });
  assert.equal(r.ok, true);
  assert.ok(fakeLog(t.home, `conversaciones/${s.id}`).some((l) => l.compact === true), 'Claude compactó');
  const now = (await call('sessions.list')).find((y) => y.id === s.id);
  assert.equal(now.status, 'idle');
  assert.ok(now.context.used < 20_000, 'el contexto bajó');
  assert.ok((await call('sessions.items', { id: s.id })).some((i) => i.kind === 'status' && /Conversación compactada/.test(i.body)), 'lo dice en la conversación');

  const c = await call('sessions.create', { agent: 'cursor', project: 'web' });
  await call('sessions.send', { id: c.id, text: 'Hola' });
  await until(async () => (await call('sessions.list')).find((y) => y.id === c.id).status === 'idle', 'turno de Cursor');
  await assert.rejects(call('sessions.compact', { id: c.id }), /no permite compactar/);
});

test('razonamiento «Extra»: solo con un modelo que lo admite; al cambiar a otro queda «Alto»', async () => {
  t = tempHome();
  engine = await startEngine(t.home, { env: { ORB_MODELS_DELAY_MS: '0' } });
  const { call } = engine;
  const catalog = await until(async () => { const c = await call('models.catalog'); return c.find((a) => a.id === 'claude')?.models.some((m) => m.id === 'fake-claude-1') && c; }, 'modelos de Claude');
  const claude = catalog.find((a) => a.id === 'claude');
  assert.deepEqual(claude.models.find((m) => m.id === 'fake-claude-1').efforts, ['low', 'medium', 'high', 'xhigh'], 'el modelo dice sus niveles');
  assert.equal(claude.models.find((m) => m.id === 'fake-claude-2').efforts, undefined);
  assert.equal((await call('chat.settings', { agent: 'claude', model: 'fake-claude-1', reasoning: 'xhigh' })).reasoning, 'xhigh');
  assert.equal((await call('chat.settings', { model: 'fake-claude-2' })).reasoning, 'high', 'otro modelo sin Extra: Alto');
  await assert.rejects(call('chat.settings', { reasoning: 'xhigh' }), /no admite el razonamiento Extra/);
});

// ---- the real Codex adapter against the fake app-server
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-compactar-'));
const lives = [];
after(() => { for (const l of lives) { try { l.close(); } catch { /* gone */ } } try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp folder */ } });
const openCodex = (env = {}) => {
  const log = path.join(dir, `codex-${lives.length}.jsonl`);
  const events = [];
  const live = codex.createLive({ exe: { cmd: process.execPath, pre: [fake('fake-codex-app.mjs')] }, cwd: dir, permission: 'editar', env: { FAKE_LOG: log, ...env }, onEvent: (ev) => events.push(ev) });
  lives.push(live);
  return { live, events, sent: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
};

test('Codex: «Compactar» pide thread/compact/start del hilo y espera a que termine', async () => {
  const { live, events, sent } = openCodex();
  assert.equal(codex.caps.compact, true);
  assert.equal((await live.send({ text: 'hola' })).isError, false);
  const r = await live.compact();
  assert.deepEqual(r, { ok: true, error: null });
  const req = sent().find((m) => m.method === 'thread/compact/start');
  assert.equal(req?.params.threadId, 'hilo-nuevo', 'del hilo de la conversación');
  assert.ok(events.some((e) => e.type === 'compacted'));
  assert.deepEqual(events.filter((e) => e.type === 'context').at(-1), { type: 'context', used: 300, size: 272000 }, 'el contexto bajó');
  assert.equal((await live.send({ text: 'sigue' })).final, 'Codex: sigue', 'el hilo sigue después');
});

test('Codex sin thread/compact/start: falla con su mensaje y la sesión sigue viva', async () => {
  const { live } = openCodex({ FAKE_NO_COMPACT: '1' });
  await live.send({ text: 'hola' });
  const r = await live.compact();
  assert.equal(r.ok, false);
  assert.match(r.error, /method not found/);
  assert.equal((await live.send({ text: 'otra' })).final, 'Codex: otra');
});
