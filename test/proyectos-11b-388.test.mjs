// 3.8.8 paso 11b (tanda 4A), interfaz de Proyectos: el interruptor «Plantilla y git» al crear, «Ordenar carpetas» a
// demanda desde la cabecera y «Cambiar categoría» en el menú de cada proyecto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actions = read('src/ui/components/project-actions.jsx');
const flows = read('src/ui/components/project-flows.jsx');
const list = read('src/ui/views/projects-pc.jsx');
const layout = read('src/ui/views/layout.jsx');

test('crear: el interruptor «Plantilla y git» va encendido y solo manda template:false al apagarlo', () => {
  assert.match(actions, /initial: \{[^}]*template: true \}/);
  assert.match(actions, /<Switch checked=\{v\.template !== false\}[\s\S]*?data-testid="project-template"/);
  assert.match(actions, /\.\.\.\(v\.template \? \{\} : \{ template: false \}\)/);
});

test('Ordenar carpetas: el mismo plan y la misma revisión del arranque, desde el botón y desde el menú ⋯', () => {
  assert.match(list, /call\('projects\.layoutPlan'\)/);
  assert.match(list, /data-testid="projects-arrange"/);
  assert.match(list, /data-testid="projects-arrange-item"/);
  assert.match(list, /<LayoutReview plan=\{arrange\} applyMethod="projects\.layoutApply"/);
  assert.match(list, /plan\?\.busy\) notifyError\(t\('projects\.arrange\.busy'\)\)/);
  assert.match(list, /notifyOk\(t\('projects\.arrange\.none'\)\)/);
  assert.match(layout, /applyMethod = 'app\.layoutApply'/, 'el arranque sigue usando la llamada de siempre');
  assert.match(layout, /bridge\.call\(applyMethod,/);
});

test('Cambiar categoría: el diálogo dice de dónde a dónde, y el menú de cada proyecto lo ofrece', () => {
  assert.match(flows, /export async function changeCategory\(t, p, onMoved\)/);
  assert.match(flows, /call\('projects\.setCategory', \{ name: p\.name, category: v\.category \}\)/);
  assert.match(flows, /t\('projects\.category\.move', \{ from:/);
  assert.match(flows, /data-testid="project-category-select"/);
  assert.match(list, /changeCategory\(t, p\)\} data-testid="project-change-category"/);
  assert.match(list, /disabled=\{!p\.category\}/, 'una carpeta vinculada no ofrece moverse');
});

test('los textos nuevos están en español y en inglés', () => {
  const keys = ['projects.arrange', 'projects.arrange.hint', 'projects.arrange.none', 'projects.arrange.busy', 'projects.category.item', 'projects.category.title',
    'projects.category.desc', 'projects.category.label', 'projects.category.move', 'projects.category.same', 'projects.category.ok', 'projects.category.done',
    'projects.category.linked', 'comp.projects.template', 'comp.projects.moreOptions', 'comp.projects.templateHint', 'comp.projects.emptyFolderHint',
    'msg.projects.moveLinked', 'msg.projects.moveMulti', 'msg.projects.moveBusy', 'msg.projects.moveExists', 'msg.projects.moveInUse', 'msg.projects.arrangeBusy'];
  for (const k of keys) for (const l of [es, en]) assert.ok(l[k], k);
  assert.match(es['projects.arrange.none'], /ya están ordenadas/);
});
