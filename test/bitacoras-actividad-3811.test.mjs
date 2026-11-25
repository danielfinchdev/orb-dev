// 3.8.11 paso 8: Bitácoras con una sola caja de búsqueda y Actividad con pestañas rápidas, una fila de filtros,
// etiquetas y «Ver detalles técnicos».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TABS, RANGES, EMPTY_VIEW, resolveFilters, rangeDates, activeChips, clearChip, isTechnical, visibleLines, buildQuery } from '../src/ui/lib/activity-filters.js';
import { countHits } from '../src/ui/lib/logbook.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOW = new Date(2026, 10, 25, 12, 0, 0);

test('Actividad: cada pestaña rápida se traduce a fuentes y nivel del motor', () => {
  assert.deepEqual(TABS, ['todo', 'tu', 'agentes', 'problemas']);
  const f = (tab) => resolveFilters({ ...EMPTY_VIEW, tab }, NOW);
  assert.deepEqual([f('todo').sources, f('todo').level], [[], 'info']);
  assert.deepEqual([f('tu').sources, f('tu').level], [['usuario'], 'info']);
  assert.deepEqual([f('agentes').sources, f('agentes').level], [['subagentes'], 'info']);
  // «Problemas» = avisos y errores, de cualquier fuente
  assert.deepEqual([f('problemas').sources, f('problemas').level], [[], 'warn']);
  // «Orb» y «App» se piden juntos: ninguna pestaña filtra por una sola de las dos
  assert.deepEqual(buildQuery(f('todo')).sources, ['orb', 'subagentes', 'usuario', 'app']);
  assert.equal(buildQuery(f('problemas')).level, 'warn');
});

test('Actividad: las fechas de Hoy, 7 y 30 días incluyen hoy; Elegir fechas usa las suyas', () => {
  assert.deepEqual(rangeDates('0', {}, NOW), { from: '2026-11-25', to: '' });
  assert.deepEqual(rangeDates('7', {}, NOW), { from: '2026-11-19', to: '' });
  assert.deepEqual(rangeDates('30', {}, NOW), { from: '2026-10-27', to: '' });
  assert.deepEqual(rangeDates('all', {}, NOW), { from: '', to: '' });
  assert.deepEqual(rangeDates('custom', { from: '2026-11-01', to: '2026-11-10' }, NOW), { from: '2026-11-01', to: '2026-11-10' });
  assert.deepEqual(RANGES, ['0', '7', '30', 'all', 'custom']);
  const q = buildQuery(resolveFilters({ ...EMPTY_VIEW, range: '0', project: 'orb-dev', q: ' hola ' }, NOW));
  assert.equal(q.project, 'orb-dev');
  assert.equal(q.q, 'hola');
  assert.ok(new Date(q.from).getTime() <= NOW.getTime());
});

test('Actividad: las etiquetas salen solo de lo que no es lo de siempre y cada × quita la suya', () => {
  assert.deepEqual(activeChips(EMPTY_VIEW), []);
  const v = { ...EMPTY_VIEW, tab: 'tu', project: 'blog', range: '30', q: 'carrito' };
  assert.deepEqual(activeChips(v).map((c) => c.key), ['project', 'range', 'q']);
  assert.equal(clearChip(v, 'project').project, '');
  assert.equal(clearChip(v, 'range').range, '7');
  assert.equal(clearChip(v, 'q').q, '');
  // quitar una etiqueta no toca la pestaña
  assert.equal(clearChip(v, 'q').tab, 'tu');
});

test('Actividad: la regla de «técnico» solo oculta líneas informativas del registro de Orb o de la app', () => {
  const line = (text, o = {}) => ({ id: text, source: 'app', level: 'info', text, ...o });
  assert.equal(isTechnical(line('pantalla de bloqueo (sin usar)')), true);
  assert.equal(isTechnical(line('pantalla de bloqueo', { source: 'orb' })), true);
  assert.equal(isTechnical(line('agentes: claude=C:\\Users\\yo\\AppData\\Local\\claude\\claude.exe · codex=C:\\npm\\codex.cmd · cursor=no')), true);
  assert.equal(isTechnical(line('C:\\Users\\yo\\AppData\\Roaming\\npm\\codex.cmd')), true);
  // lo que cuenta algo a una persona se queda
  assert.equal(isTechnical(line('tarea #15 terminó (código 0, estado done)')), false);
  assert.equal(isTechnical(line('Claude Code empezó la tarea #42', { source: 'subagentes' })), false);
  assert.equal(isTechnical(line('Cambiaste el modo', { source: 'usuario' })), false);
  // un aviso o un error nunca se oculta, aunque diga lo mismo
  assert.equal(isTechnical(line('pantalla de bloqueo (sin usar)', { level: 'warn' })), false);
  assert.equal(isTechnical(line('agentes: claude=no', { level: 'error' })), false);
  assert.equal(isTechnical(null), false);
  const all = [line('pantalla de bloqueo (sin usar)'), line('tarea #1 terminó')];
  assert.equal(visibleLines(all, false).length, 1);
  assert.equal(visibleLines(all, true).length, 2);
});

test('Actividad: el interruptor está apagado por defecto y copiar toma todas las líneas cargadas', () => {
  const a = read('src/ui/views/activity.jsx');
  assert.match(a, /useState\(false\);\s*const \[page/);
  assert.match(a, /visibleLines\(page\.items, technical\)/);
  // copiar y el informe no pasan por el ocultado
  assert.match(a, /const copy = \(\) => navigator\.clipboard\.writeText\(page\.items\.map/);
  assert.match(a, /data-testid="activity-technical"/);
  assert.match(a, /counts\.levels\.warn \+ counts\.levels\.error/);
  assert.doesNotMatch(a, /<DateField [^>]*data-testid="activity-from"[\s\S]*<DateField [^>]*data-testid="activity-to"[\s\S]*activity-search/);
});

test('Bitácoras: una sola caja con selector, «También en», total real y pie «Viendo las N más recientes»', () => {
  const l = read('src/ui/views/logs.jsx');
  assert.equal((l.match(/<SearchInput /g) ?? []).length, 1);
  assert.match(l, /data-testid="log-scope"/);
  assert.match(l, /data-testid="log-also"/);
  assert.match(l, /Number\.isFinite\(mine\?\.entries\) \? mine\.entries : loaded/);
  assert.match(l, /t\('logbooks\.entriesOf', \{ n: entries\?\.length \?\? 0, total \}\)/);
  assert.match(l, /data-testid="log-viewing"/);
  assert.match(l, /logbooks\.viewing/);
  for (const k of ['logbooks.scope.here', 'logbooks.scope.all', 'logbooks.alsoIn', 'logbooks.entriesOf', 'logbooks.viewing', 'logbooks.viewMore', 'logbooks.tab.problemas', 'logbooks.technical', 'logbooks.range.custom']) {
    assert.ok(es[k] && en[k], k);
  }
  assert.equal(es['logbooks.source.app'], es['logbooks.source.orb']);
  assert.equal(en['logbooks.source.app'], en['logbooks.source.orb']);
});

test('Bitácoras: los aciertos en las otras bitácoras salen con su número y sin la actual', () => {
  const bodies = { general: '### a\ncarrito\n### b\nnada', 'tienda-online': '### c\ncarrito\n### d\ncarrito', 'orb-dev': '### e\notra cosa' };
  const hits = countHits(bodies, 'carrito');
  assert.deepEqual(hits, { general: 1, 'tienda-online': 2 });
  const also = Object.keys(hits).filter((n) => n !== 'general');
  assert.deepEqual(also, ['tienda-online']);
});

test('resaltado: parte el texto sin mayúsculas ni acentos y busca texto plano, no patrones', async () => {
  const { splitMatches } = await import('../src/ui/lib/highlight.js');
  const hits = (t, q) => splitMatches(t, q).filter((p) => p.hit).map((p) => p.text);
  assert.deepEqual(hits('El Carrito y el carro', 'CARR'), ['Carr', 'carr']);
  assert.deepEqual(hits('Corazón y corazon', 'corazon'), ['Corazón', 'corazon']);
  assert.deepEqual(hits('buscar canción', 'CANCION'), ['canción']);
  // caracteres especiales de regex: se buscan tal cual
  assert.deepEqual(hits('a.b a+b (x) [y] a*b', 'a.b'), ['a.b']);
  assert.deepEqual(hits('f(x) = [y]+ \d', '(x)'), ['(x)']);
  assert.deepEqual(hits('1 + 1 * 2', '+ 1 *'), ['+ 1 *']);
  assert.deepEqual(hits('texto', ''), []);
  assert.deepEqual(hits('texto', '   '), []);
  // las partes juntas son el texto original
  const parts = splitMatches('Ñandú ñandú', 'nandu');
  assert.equal(parts.map((p) => p.text).join(''), 'Ñandú ñandú');
  assert.equal(parts.filter((p) => p.hit).length, 2);
  // la vista marca solo nodos de texto: nada de innerHTML y se saltan enlaces y código
  const l = read('src/ui/views/logs.jsx');
  assert.match(l, /highlightIn\(ref\.current, query\)/);
  const h = read('src/ui/lib/highlight.js');
  assert.doesNotMatch(h, /innerHTML/);
  assert.match(h, /'A', 'CODE', 'PRE'/);
});
