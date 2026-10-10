// 2.6: the models of every agent, asked to the agent itself (src/agents/*.mjs discoverModels) and kept for the brain
// selector (src/engine/catalog.mjs): what each agent's listing looks like, the throttle (once every 12 h), «Comprobar»
// forcing it, and the catalog naming a non-Claude agent's models and its default.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, fake, until, startEngine } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { cursorModels } from '../src/agents/cursor.mjs';
import { codexModels } from '../src/agents/codex.mjs';
import { acpAgent, acpModels } from '../src/agents/acp.mjs';
import { rememberModels, refreshModels, modelCatalog, MODELS_EVERY } from '../src/engine/catalog.mjs';

const t = tempHome({ agents: { cursor: { enabled: true } } });
const asked = path.join(t.base, 'preguntas.log');
process.env.ORB_FAKE_MODELS_LOG = asked;
after(() => { delete process.env.ORB_FAKE_MODELS_LOG; t.cleanup(); });
const questions = () => { try { return fs.readFileSync(asked, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };

test('Cursor: una entrada por modelo (sin variantes de esfuerzo ni «fast»), con su nombre y el que usa por defecto', () => {
  const out = ['Available models', '', 'auto - Auto (default)', 'gpt-9-codex-low - Codex 9 Low', 'gpt-9-codex - Codex 9', 'gpt-9-codex-fast - Codex 9 Fast',
    'composer-7 - Composer 7 (current)', 'composer-7-fast - Composer 7 Fast', 'claude-x-9-thinking-high - Claude X 9 1M Thinking (NO ZDR)',
    'claude-x-9-high - Claude X 9 1M (NO ZDR)', 'claude-x-9-high-fast - Claude X 9 1M Fast (NO ZDR)', 'grok-9-low - Grok 9  Low', 'grok-9-medium-fast - Grok 9  Medium Fast​​',
    'grok-9-medium - Grok 9  Medium', 'kimi-z-max - Kimi Z', 'kimi-z-low - Kimi Z Low', '', 'Tip: use --model <id> to switch.'].join('\r\n');
  assert.deepEqual(cursorModels(out), [
    { id: 'auto', label: 'Auto' },
    { id: 'gpt-9-codex', label: 'Codex 9' },
    { id: 'composer-7', label: 'Composer 7', default: true },
    { id: 'claude-x-9-high', label: 'Claude X 9 1M (NO ZDR)' },
    { id: 'grok-9-medium', label: 'Grok 9' },
    { id: 'kimi-z-max', label: 'Kimi Z' }
  ]);
  assert.equal(cursorModels('auto - Auto (default)\nx-1 - X 1').find((m) => m.default)?.id, 'auto', 'sin «current», el de Cursor');
  assert.deepEqual(cursorModels('error: not logged in'), []);
});

test('Codex: los modelos visibles de model/list con su nombre y el predeterminado', () => {
  const r = { data: [{ id: 'm1', model: 'm1', displayName: 'M-Uno', hidden: false, isDefault: true }, { id: 'oculto', model: 'oculto', displayName: 'Interno', hidden: true }, { model: 'm2', displayName: 'M-Dos' }], nextCursor: null };
  assert.deepEqual(codexModels(r), [{ id: 'm1', label: 'M-Uno', default: true }, { id: 'm2', label: 'M-Dos' }]);
  assert.deepEqual(codexModels(null), []);
});

test('ACP: modelos de la opción «model» (también en grupos) o del campo models, y el que está en uso', async () => {
  assert.deepEqual(acpModels({ configOptions: [{ id: 'm', category: 'model', currentValue: 'b', options: [{ group: 'g', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] }] }] }),
    [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', default: true }]);
  assert.deepEqual(acpModels({ models: { currentModelId: 'x', availableModels: [{ modelId: 'x', name: 'Equis' }, { modelId: 'y', name: 'Y' }] } }), [{ id: 'x', label: 'Equis', default: true }, { id: 'y', label: 'Y' }]);
  assert.deepEqual(acpModels({}), []);
  // The real code path against a minimal ACP agent: hello, an empty session (no prompt) and closed.
  const spec = { label: 'ACP de prueba', pkg: 'no-existe-en-npm', bin: 'no-existe', acpArgs: [], login: [], loginArgs: [], install: '', models: [] };
  const list = await acpAgent('prueba', spec).discoverModels({ cmd: process.execPath, pre: [fake('fake-acp.mjs')] }, {}, { FAKE_ACP_MODELS: '1' });
  assert.deepEqual(list, [{ id: 'acp-a', label: 'Modelo A de prueba' }, { id: 'acp-b', label: 'Modelo B de prueba', default: true }]);
  assert.equal(await acpAgent('prueba', spec).discoverModels({ cmd: process.execPath, pre: [fake('fake-acp.mjs')] }, {}, {}), null, 'sin modelos que decir: nada');
});

test('rememberModels: valida, quita repetidos, un solo predeterminado, hasta 40, y avisa solo si cambia', () => {
  const board = new Board();
  const changes = []; board.onChange((w) => changes.push(w));
  assert.equal(rememberModels(board, 'noexiste', [{ id: 'a' }]), false);
  const many = [{ id: 'a', label: 'A​', default: true }, { id: 'a', label: 'otra A' }, { id: 'mal id!' }, { id: 'b', label: 'B', default: true }, ...Array.from({ length: 50 }, (_, i) => `m${i}`)];
  assert.equal(rememberModels(board, 'gemini', many), true);
  const saved = board.settingJson('models:gemini');
  assert.equal(saved.length, 40);
  assert.deepEqual(saved.slice(0, 3), [{ id: 'a', label: 'A', default: true }, { id: 'b', label: 'B' }, { id: 'm0', label: 'm0' }]);
  assert.deepEqual(changes, ['models']);
  assert.equal(rememberModels(board, 'gemini', many), false, 'la misma lista no avisa otra vez');
  assert.deepEqual(changes, ['models']);
});

test('refreshModels: pregunta al agente una vez cada 12 h; «Comprobar» (force) vuelve a preguntar', async () => {
  const board = new Board();
  fs.rmSync(asked, { force: true });
  assert.equal(await refreshModels(board, 'codex'), true, 'la primera vez pregunta y guarda');
  assert.deepEqual(questions(), ['codex']);
  assert.deepEqual(board.settingJson('models:codex').map((m) => m.id), ['fake-codex-1', 'fake-codex-2', 'fake-codex-3']);
  assert.equal(await refreshModels(board, 'codex'), false);
  assert.deepEqual(questions(), ['codex'], 'dentro de las 12 h no se pregunta otra vez');
  // Twelve hours later it asks again (same list: nothing changes, but it was asked).
  board.setting('models_at:codex', String(Date.now() - MODELS_EVERY - 1000)); board.setting('models_try:codex', String(Date.now() - MODELS_EVERY - 1000));
  assert.equal(await refreshModels(board, 'codex'), false);
  assert.deepEqual(questions(), ['codex', 'codex']);
  await refreshModels(board, 'codex', { force: true });
  assert.deepEqual(questions(), ['codex', 'codex', 'codex'], '«Comprobar» pregunta aunque sea pronto');
  // Two questions at the same time are one.
  await Promise.all([refreshModels(board, 'cursor', { force: true }), refreshModels(board, 'cursor', { force: true })]);
  assert.equal(questions().filter((a) => a === 'cursor').length, 1);
  assert.equal(await refreshModels(board, 'gemini', { force: true }), false, 'un agente apagado no se pregunta');
});

test('el catálogo nombra los modelos de un agente que no es Claude y su predeterminado', () => {
  const board = new Board();
  rememberModels(board, 'codex', [{ id: 'gpt-x', label: 'GPT-X', default: true }, { id: 'gpt-y', label: 'GPT-Y' }]);
  rememberModels(board, 'claude', [{ id: 'opus', label: 'Opus 5.5', resolved: 'claude-opus-5-5', default: true }, { id: 'fable', label: 'Fable 5.1', resolved: 'claude-fable-5-1' }, { id: 'haiku', label: 'Haiku 4.5', resolved: 'claude-haiku-4-5' }]);
  const catalog = modelCatalog(board);
  const codex = catalog.find((a) => a.id === 'codex');
  assert.deepEqual(codex.models.map((m) => [m.id, m.label]), [['', 'GPT-X'], ['gpt-x', 'GPT-X'], ['gpt-y', 'GPT-Y']]);
  assert.equal(codex.models[0].defaultOf, 'GPT-X', 'el predeterminado lleva el nombre del modelo que dice el agente');
  const claude = catalog.find((a) => a.id === 'claude');
  assert.deepEqual(claude.models.map((m) => m.id), ['claude-sonnet-5-5', 'claude-opus-5-5', 'fable', 'haiku'], 'sin repetir los alias que ya están con su id completo');
  assert.equal(claude.models.find((m) => m.id === 'haiku').label, 'Haiku 4.5');
  assert.ok(claude.models.find((m) => m.id === 'fable').heavy, 'Fable gasta más cupo');
  // Cursor without a list yet: its default and the configured «auto»; asked in the background when the selector wants it.
  fs.rmSync(asked, { force: true });
  board.setting('models_try:cursor', ''); board.setting('models_at:cursor', ''); board.setting('models:cursor', '');
  const cursor = modelCatalog(board, { discover: true }).find((a) => a.id === 'cursor');
  assert.deepEqual(cursor.models.map((m) => m.id), ['', 'auto']);
  assert.equal(cursor.models[0].defaultOf, null);
  return until(() => board.settingJson('models:cursor')?.length === 3 && questions().includes('cursor'), 'Cursor preguntado en segundo plano');
});

test('el motor pregunta los modelos al arrancar y el selector los recibe (con un aviso a la ventana)', async () => {
  const home = tempHome();
  const engine = await startEngine(home.home, { env: { ORB_MODELS_DELAY_MS: '0' } });
  try {
    const known = (catalog, agent) => catalog.find((a) => a.id === agent && a.models.some((m) => m.id === `fake-${agent}-1`));
    const catalog = await until(async () => { const c = await engine.call('models.catalog'); return known(c, 'codex') && known(c, 'claude') && c; }, 'modelos de Claude y Codex');
    const codex = known(catalog, 'codex');
    assert.equal(codex.models[0].id, '');
    assert.equal(codex.models[0].defaultOf, 'Modelo de prueba 1');
    await until(() => engine.events.some((e) => e.event === 'board:changed' && e.payload.includes('models')), 'la ventana se entera', 5000);
    // The Claude model Claude Code offered can be the assistant's brain (it joins its models).
    const info = await engine.call('chat.settings', { agent: 'claude', model: 'fake-claude-2' });
    assert.equal(info.model, 'fake-claude-2'); assert.equal(info.modelLabel, 'Modelo de prueba 2');
    await assert.rejects(engine.call('chat.settings', { agent: 'claude', model: 'inventado-9' }));
  } finally { await engine.stop(); home.cleanup(); }
});
