// Eighth round of fidelity fixes: rule lines, the duplicated model, «Ordenar carpetas», the narrow task search and long paths.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { ruleBlurb } from '../src/ui/lib/rule-text.js';
import { shortPath } from '../src/shared/text.mjs';
import { DEFAULT_RULES } from '../src/domain/rules/defaults.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('1: a rule line is a description, or its first sentence in plain words', () => {
  for (const d of DEFAULT_RULES) {
    assert.ok(es[`rules.desc.${d.id}`], `es description of ${d.id}`);
    assert.ok(en[`rules.desc.${d.id}`], `en description of ${d.id}`);
    assert.doesNotMatch(es[`rules.desc.${d.id}`], /_|\{/);
  }
  const line = ruleBlurb('PREGUNTAS CON OPCIONES: cuando el usuario deba elegir entre 2-4 caminos claros, usa orb_ask (la opción recomendada primero) en vez de preguntarlo en texto. Después termina tu turno.');
  assert.doesNotMatch(line, /orb_|[{}]/);
  assert.match(line, /^Cuando el usuario deba elegir/);
  assert.ok(!line.includes('Después'));
  assert.equal(ruleBlurb('NO HAGAS PUSH SIN QUE SE LO PIDAN. Más texto.'), 'No hagas push sin que se lo pidan.');
  const long = ruleBlurb(`Una frase muy larga ${'que sigue y sigue '.repeat(12)}sin punto`);
  assert.ok(long.length <= 111 && long.endsWith('…'));
  const card = read('src/ui/views/rules-cards.jsx');
  assert.match(card, /ruleLine\(t, rule, /);
  assert.match(card, /\{rule\.texto\}<\/pre>/); // «Ver texto» keeps the whole text
});

test('2: the selector shows the conversation\'s model once when an alias names a listed model', () => {
  const s = read('src/ui/views/session.jsx');
  assert.match(s, /const same = models\.find\(\(m\) => m\.label === label\);/);
  assert.match(s, /if \(same\) selectedModel = same\.value; else models\.unshift/);
  assert.match(s, /models=\{models\} model=\{selectedModel\}/);
});

test('3: «Ordenar carpetas» has two buttons per row and the rest of the places under «⋯»', () => {
  const s = read('src/ui/views/layout.jsx');
  assert.match(s, /const shown = options\.filter\(\(o\) => o === main \|\| o\.value === 'keep'\)/);
  assert.match(s, /layout-more-\$\{it\.id\}/);
  assert.doesNotMatch(s, /<Select /);
  assert.match(s, /text-body leading-\[1\.45\] font-medium/);
  assert.ok(es['layout.otherPlaces'] && en['layout.otherPlaces']);
});

test('4: the task search cuts its hint with «…» and has a short hint for a very narrow field', () => {
  const p = read('src/ui/components/ui/primitives.jsx');
  assert.match(p, /placeholder:text-ellipsis/);
  assert.match(p, /narrow \? shortPlaceholder : placeholder/);
  assert.match(read('src/ui/views/tasks.jsx'), /shortPlaceholder=\{tr\('tasks\.searchShort'\)\}/);
  assert.equal(es['tasks.searchShort'], 'Buscar');
});

test('5: a long working folder is cut in the middle, keeping the disk start and the last folders', () => {
  assert.equal(shortPath('C:\\Users\\danip\\Proyectos\\clientes\\tienda-web', 34), 'C:\\Users\\…\\clientes\\tienda-web');
  assert.equal(shortPath('C:\\Users\\danip\\Proyectos\\tienda-web', 30), 'C:\\Users\\…\\tienda-web');
  assert.equal(shortPath('C:\\Orb\\web', 44), 'C:\\Orb\\web');
  assert.equal(shortPath('/home/dani/work/projects/shop', 22), '/home/…/projects/shop');
  assert.match(read('src/domain/tasks/board-projects.mjs'), /path: shortPath\(project\.path\)/);
});
