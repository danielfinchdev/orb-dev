// 3.8.8 paso 11b (G1), interfaz: la tarjeta «Skills y MCP del proyecto» del Resumen y la insignia «Solo en» de Ajustes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';
import { projectExtensions, extensionLabel } from '../src/ui/lib/project-extensions.js';

const read = (f) => fs.readFileSync(path.join(import.meta.dirname, '..', f), 'utf8');
const data = {
  skills: [
    { name: 'revisar-checkout', enabled: true, valid: true, projects: ['tienda'], scoped: true },
    { name: 'tono', enabled: true, valid: true, projects: [] },
    { name: 'apagada', enabled: false, valid: true, projects: [] },
    { name: 'rota', enabled: false, valid: false, projects: [] }
  ],
  mcp: [
    { name: 'playwright', enabled: true, startable: true, connector: 'playwright', projects: ['tienda', 'blog'], scoped: true },
    { name: 'de-blog', enabled: true, startable: true, connector: 'de-blog', projects: ['blog'], scoped: true },
    { name: 'pesada', enabled: false, startable: true, needsInstall: true, projects: [] },
    { name: 'sin-conector', enabled: false, startable: true, connector: null, projects: [] },
    { name: 'raro', enabled: true, startable: true, connector: 'raro', projects: [], scoped: true },
    { name: 'enlace', enabled: false, startable: true, linked: true, projects: [] }
  ],
  connectors: [{ name: 'github', enabled: true, projects: [] }, { name: 'apagado', enabled: false, projects: [] }]
};

test('la tarjeta lista lo que solo recibe este proyecto y cuenta lo que recibe de todos', () => {
  const r = projectExtensions(data, 'tienda');
  assert.deepEqual(r.mine.map((x) => `${x.kind}:${x.name}`), ['skill:revisar-checkout', 'mcp:playwright']);
  assert.equal(r.sharedCount, 2, 'tono y github');
});

test('«Añadir» ofrece lo instalado que el proyecto aún no recibe, y nada que no pueda activarse', () => {
  const names = projectExtensions(data, 'tienda').candidates.map((x) => `${x.kind}:${x.name}`);
  assert.deepEqual(names.filter((n) => n !== 'mcp:raro'), ['skill:apagada', 'mcp:de-blog', 'connector:apagado']);
  assert.deepEqual(projectExtensions(data, 'sin-nada').mine, []);
  assert.deepEqual(projectExtensions(null, 'tienda'), { mine: [], sharedCount: 0, candidates: [], blocked: [] });
  // a limit the engine does not understand (scoped, no names) reaches nobody: not «de todos», and offered to add
  assert.ok(projectExtensions(data, 'tienda').candidates.some((x) => x.name === 'raro'));
  assert.equal(projectExtensions(data, 'tienda').sharedCount, 2);
  // a server of core with no connector yet, or that needs packages, is not offered: Ajustes first
  assert.deepEqual(projectExtensions(data, 'tienda').blocked.map((x) => x.name), ['pesada', 'sin-conector']);
  assert.ok(!names.includes('mcp:pesada') && !names.includes('mcp:sin-conector'));
});

test('las etiquetas siguen la maqueta y los textos existen en es y en', () => {
  const t = (k, v) => es[k].replace(/\{(\w+)\}/g, (_, n) => v?.[n]);
  assert.equal(extensionLabel(t, { kind: 'mcp', name: 'playwright' }), 'MCP · playwright');
  assert.equal(extensionLabel(t, { kind: 'skill', name: 'revisar-checkout' }), 'Skill · revisar-checkout');
  assert.equal(es['projects.ext.title'], 'Extensiones del proyecto');
  assert.equal(es['projects.ext.none'], 'Este proyecto no tiene skills ni MCP propios.');
  assert.equal(es['projects.ext.remove'], 'Quitar de este proyecto');
  for (const k of Object.keys(es).filter((x) => x.startsWith('projects.ext.') || x === 'ext.scope')) assert.ok(en[k], k);
  assert.equal(es['ext.scope'].replace('{names}', 'tienda-web, blog'), 'Solo en: tienda-web, blog');
});

test('la página del proyecto monta la tarjeta, con sus data-testid, y Ajustes muestra la insignia sin cambiar nada más', () => {
  const page = read('src/ui/views/project-page.jsx');
  assert.match(page, /<ProjectExtensionsCard p=\{p\} Shell=\{PjCard\} \/>/);
  const card = read('src/ui/components/project-extensions.jsx');
  for (const id of ['project-extensions', 'project-ext-add', 'project-ext-row', 'project-ext-menu', 'project-ext-remove', 'project-ext-empty', 'project-ext-shared', 'project-ext-options', 'project-ext-detail', 'project-ext-install', 'project-ext-reserved', 'project-ext-blocked']) assert.ok(card.includes(`"${id}"`), id);
  assert.match(card, /extensions\.scope/);
  assert.doesNotMatch(card, /extensions\.(toggle|import|remove)|config\.save/, 'solo la llamada del ámbito');
  const ext = read('src/ui/views/extensions.jsx');
  assert.match(ext, /data-testid="ext-scope"/);
  assert.doesNotMatch(ext, /extensions\.scope/, 'en Ajustes el ámbito es de solo lectura');
});
