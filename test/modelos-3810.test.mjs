// 3.8.10: the reasoning levels each agent and model really takes (minimal … max), a saved level the new model lacks
// dropping to the closest one, and the setting that hides «Recomendados» and the model guide from the selector.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { REASONING_LEVELS, knownLevels, nearestLevel } from '../src/shared/reasoning-levels.mjs';
import { codexModels, effort as codexEffort } from '../src/agents/codex.mjs';
import { claudeEffort } from '../src/agents/claude.mjs';
import { rememberModels, levelsOf } from '../src/engine/usage/catalog.mjs';
import { cleanBrain } from '../src/shared/favorite-brains.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const t = tempHome({});
after(() => t.cleanup());

test('the levels are ordered and anything else is dropped', () => {
  assert.deepEqual(REASONING_LEVELS, ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(knownLevels(['max', 'bogus', 'low']), ['low', 'max']);
});

test('a level the model lacks drops to the closest one it takes (the lower on a tie)', () => {
  assert.equal(nearestLevel('max', ['low', 'medium', 'high', 'xhigh']), 'xhigh');
  assert.equal(nearestLevel('xhigh', ['low', 'medium', 'high']), 'high');
  assert.equal(nearestLevel('minimal', ['low', 'medium', 'high']), 'low');
  assert.equal(nearestLevel('medium', ['low', 'high']), 'low');
  assert.equal(nearestLevel('high', ['low', 'medium', 'high']), 'high');
  assert.equal(nearestLevel('high', []), 'high');
});

test('Codex lists its own levels (minimal included) and Claude lists xhigh and max', () => {
  const rows = codexModels({ data: [{ model: 'gpt-x', supportedReasoningEfforts: [{ reasoningEffort: 'minimal' }, 'low', 'medium', 'high', 'xhigh', 'max'] }] });
  assert.deepEqual(rows[0].efforts, ['minimal', 'low', 'medium', 'high', 'xhigh']);
});

test('the level reaches each agent as the one it understands', () => {
  assert.equal(claudeEffort('max'), 'max');
  assert.equal(claudeEffort('xhigh'), 'xhigh');
  assert.equal(claudeEffort('minimal'), 'low');
  assert.equal(claudeEffort(undefined), 'medium');
  assert.equal(codexEffort('minimal'), 'minimal');
  assert.equal(codexEffort('max'), 'xhigh');
  assert.equal(codexEffort(null), 'medium');
});

test('the catalog keeps the levels an agent reported and Cursor offers none', () => {
  const board = new Board();
  rememberModels(board, 'claude', [{ id: 'm1', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, { id: 'm2', efforts: ['bogus'] }]);
  const known = board.settingJson('models:claude');
  assert.deepEqual(known.find((m) => m.id === 'm1').efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(known.find((m) => m.id === 'm2').efforts, undefined);
  const catalog = [{ id: 'claude', models: known }, { id: 'cursor', models: [{ id: '', label: 'Auto' }] }, { id: 'codex', models: [{ id: 'g', efforts: ['minimal', 'low'] }] }];
  assert.deepEqual(levelsOf(catalog, 'claude', 'm1'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf(catalog, 'claude', 'm2'), ['low', 'medium', 'high']);
  assert.deepEqual(levelsOf(catalog, 'codex', 'g'), ['minimal', 'low']);
  assert.deepEqual(levelsOf(catalog, 'cursor', ''), []);
  board.close?.();
});

test('a favourite brain keeps any known level', () => {
  assert.equal(cleanBrain({ agent: 'claude', model: '', reasoning: 'max' }).reasoning, 'max');
  assert.equal(cleanBrain({ agent: 'codex', model: '', reasoning: 'minimal' }).reasoning, 'minimal');
  assert.equal(cleanBrain({ agent: 'codex', model: '', reasoning: 'bogus' }).reasoning, 'medium');
});

test('the level names exist in both languages, Spanish ones as the interface says them', () => {
  const names = { minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo' };
  for (const l of REASONING_LEVELS) {
    assert.equal(es[`reasoning.${l}`], names[l]);
    for (const k of [`reasoning.${l}`, `reasoning.use.${l}`, `reasoning.tasks.${l}`, `msg.reasoning.${l}`, `guide.r.${l}`]) { assert.ok(es[k], `es ${k}`); assert.ok(en[k], `en ${k}`); }
  }
  for (const k of ['settings.hideModelHelp', 'settings.hideModelHelpHint']) { assert.ok(es[k]); assert.ok(en[k]); }
});

test('the selector hides «Recomendados» and the guide only when the user asks', () => {
  const src = fs.readFileSync(new URL('../src/ui/components/brain-picker.jsx', import.meta.url), 'utf8');
  assert.match(src, /ui\?\.hideModelHelp === true/);
  assert.match(src, /hide \? \[\] : catalog\.flatMap/);
  assert.match(src, /hide \? null : <>/);
  assert.match(fs.readFileSync(new URL('../src/ui/views/settings/general.jsx', import.meta.url), 'utf8'), /hide-model-help/);
});
