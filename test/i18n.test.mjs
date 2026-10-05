// i18n (2.3): es y en tienen las mismas claves, todas las claves usadas existen y el inglés no deja textos en español.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import es from '../src/core/locales/es.mjs';
import en from '../src/core/locales/en.mjs';
import { translate, createT, localeOf } from '../src/core/i18n.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const sources = walk(root).filter((f) => /\.(m?js|jsx|cjs)$/.test(f) && !f.includes(`${path.sep}locales${path.sep}`) && !f.endsWith('i18n.mjs'));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('es y en tienen exactamente las mismas claves', () => {
  const missingEn = Object.keys(es).filter((k) => !(k in en));
  const missingEs = Object.keys(en).filter((k) => !(k in es));
  assert.deepEqual(missingEn, [], `faltan en en.mjs: ${missingEn.join(', ')}`);
  assert.deepEqual(missingEs, [], `faltan en es.mjs: ${missingEs.join(', ')}`);
});

test('cada texto usa los mismos marcadores {…} en los dos idiomas y ninguno está vacío', () => {
  for (const k of Object.keys(es)) {
    assert.ok(es[k] && en[k], `texto vacío en ${k}`);
    assert.equal(placeholders(en[k]), placeholders(es[k]), `marcadores distintos en ${k}`);
  }
});

test('toda clave usada con t(\'…\') o translate(…, \'…\') existe en el diccionario', () => {
  const used = new Map();
  for (const f of sources) {
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/(?<![\w.$])(?:t|translate\([^,()]+,)\(?\s*'([a-zA-Z]+(?:\.[\w]+)+)'/g)) used.set(m[1], path.relative(root, f));
  }
  const missing = [...used].filter(([k]) => !(k in es)).map(([k, f]) => `${k} (${f})`);
  assert.deepEqual(missing, [], `claves sin traducir: ${missing.join(', ')}`);
});

test('el inglés no deja español: sin tildes ni ñ ni signos de apertura, y sin palabras típicas', () => {
  const words = /\b(el|la|los|las|para|con|sin|una|tu|tus|hace|hay|ahora|archivos?|tarea|tareas|proyecto|agente|ajustes|error al|elige|nueva|crear)\b/i;
  const bad = Object.entries(en).filter(([, v]) => /[áéíóúñ¿¡]/i.test(v) || words.test(v)).map(([k, v]) => `${k}: ${v}`);
  assert.deepEqual(bad, [], `parece español en en.mjs:\n${bad.join('\n')}`);
});

test('translate: idioma, marcadores y respaldo', () => {
  assert.equal(translate('es', 'nav.tasks'), 'Tareas');
  assert.equal(translate('en', 'nav.tasks'), 'Tasks');
  assert.equal(translate('xx', 'nav.tasks'), 'Tareas');
  assert.equal(translate('en', 'clave.que.no.existe'), 'clave.que.no.existe');
  assert.equal(createT('en')('time.minAgo', { n: 5 }), '5 min ago');
  assert.equal(createT('es')('time.minAgo', { n: 5 }), 'hace 5 min');
  assert.equal(localeOf('en'), 'en-GB');
  assert.equal(localeOf('es'), 'es-ES');
});
