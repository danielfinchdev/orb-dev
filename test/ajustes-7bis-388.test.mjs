// 3.8.8 paso 11b, repaso 7-bis de Ajustes: cuadrar cada sección con la maqueta sin perder funciones.
// Lee el código como texto: lo que importa es qué llamadas hace cada pieza y dónde queda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const link = read('src/ui/views/magic-link.jsx');
const dev = read('src/ui/views/settings/devices.jsx');
const index = read('src/ui/views/settings/index.jsx');
const general = read('src/ui/views/settings/general.jsx');

test('dispositivos: cada uno tiene un menú «…» con las mismas llamadas y la misma confirmación de peligro', () => {
  assert.match(link, /<DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost"[^>]*data-testid="link-menu"/);
  assert.match(link, /<DropdownMenuItem onSelect=\{\(\) => rename\(d\)\} data-testid="link-rename">/);
  assert.match(link, /<DropdownMenuItem variant="destructive" onSelect=\{\(\) => revoke\(d\)\} data-testid="link-revoke">/);
  assert.match(link, /call\('link\.rename', \{ id: d\.id, name: v\.name\.trim\(\) \|\| d\.name \}\)/);
  assert.match(link, /confirm\(t\('link\.revokeTitle'[^)]*\)[^;]*danger: true \}\)\)\) return;\s*const unlock = await unlockCore\('unlink'\); if \(!unlock\) return;\s*await act\(call\('link\.revoke', \{ id: d\.id, unlock \}\)/);
  assert.match(link, /data-testid="link-relink"/);
});

test('dispositivos: los interruptores de las vías y las capturas del móvil están en «Más opciones»', () => {
  const more = dev.slice(dev.indexOf('<MoreOptions testid="link-more-options">'));
  for (const id of ['data-testid={`mobile-${kind}`}', 'data-testid="mobile-screenshot"', 'configure({ [kind]: on })', 'configure({ screenshot })']) assert.ok(more.includes(id), id);
  const main = dev.slice(dev.indexOf('<Block title={t(\'settings.mobile\')}'), dev.indexOf('<MoreOptions testid="link-more-options">\n        {more}'));
  assert.doesNotMatch(main, /mobile-screenshot|data-testid=\{`mobile-\$\{kind\}`\}/);
  // the addresses and their «Copiar» stay where the drawing has them
  assert.match(dev, /<Setting key=\{kind\}[\s\S]*mobile-\$\{kind\}-address[\s\S]*mobile-\$\{kind\}-copy/);
  // the pairing options come into the same «Más opciones»
  assert.match(link, /phoneAccess \? phoneAccess\(more\) : <MoreOptions testid="link-more-options">\{more\}<\/MoreOptions>/);
  assert.match(index, /phoneAccess=\{\(more\) => <MobileCard more=\{more\} \/>\}/);
});

test('pantalla de bloqueo: un interruptor que guarda los mismos dos valores', () => {
  assert.match(dev, /checked=\{previewOf\(st\.preview\) === 'chat'\} onCheckedChange=\{\(on\) => configure\(\{ preview: on \? 'chat' : 'none' \}\)\} data-testid="mobile-preview"/);
  assert.doesNotMatch(dev, /PREVIEWS/);
});

test('avanzado: navegador, God mode y Android en el orden de la maqueta; el conector MCP de Orb en «Más opciones»', () => {
  const adv = index.slice(index.indexOf("{ id: 'avanzado'"), index.indexOf("{ id: 'acerca'"));
  assert.ok(adv.indexOf('<BrowserCard') < adv.indexOf('<ExpertCard') && adv.indexOf('<ExpertCard') < adv.indexOf('<AndroidCard'));
  assert.match(adv, /<MoreOptions testid="more-options-avanzado"><McpExtCard \/><\/MoreOptions>/);
});

test('acerca de: comentarios, Orb, apoyo y más aplicaciones, como la maqueta', () => {
  const ab = index.slice(index.indexOf("{ id: 'acerca'"));
  const order = ['<FeedbackCard', '<AboutCard', '<SupportCard', '<MoreAppsCard'].map((k) => ab.indexOf(k));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((i) => i > 0));
});

test('general: los botones de zoom van a «Más opciones» y siguen llamando a bridge.zoom', () => {
  assert.match(index, /<MoreOptions testid="more-options-general"><ZoomFineCard \/>/);
  const fine = general.slice(general.indexOf('export function ZoomFineCard'), general.indexOf('export function InterfaceCard'));
  assert.match(fine, /bridge\.zoom\(Number\(value\)\)/); assert.match(fine, /settings\.zoomOut/); assert.match(fine, /settings\.zoomIn/);
  const iface = general.slice(general.indexOf('export function InterfaceCard'), general.indexOf('// Expert mode'));
  assert.doesNotMatch(iface, /settings\.zoomOut|settings\.zoomIn/);
});

test('textos nuevos en español y en inglés', () => {
  for (const k of ['settings.mobileWayHint', 'settings.zoomFine', 'settings.zoomFineHint', 'settings.moreOptions']) for (const l of [es, en]) assert.ok(l[k], k);
});

const ext = read('src/ui/views/extensions.jsx');

test('skills y MCP: «Añadir conector MCP» es un formulario en la página con la misma llamada y los conectores se quitan con un botón', () => {
  assert.match(ext, /function AddConnector\(\{ run \}\)/);
  assert.match(ext, /<AddConnector run=\{run\} \/>/);
  assert.match(ext, /call\('config\.save', \{ patch: \{ mcpServers: \[\.\.\.\(c\?\.mcpServers \?\? \[\]\), entry\] \} \}\)/);
  assert.match(ext, /onRemove=\{\(\) => remove\('connector', s\.name\)\}/);
  assert.match(ext, /unlockCore\('removeExtension'\)/);
  assert.match(ext, /data-testid="ext-add"/);
  assert.doesNotMatch(ext, /function addConnector/);
});

test('skills y MCP: el texto de ayuda de la skill y el servidor queda en «Más opciones»', () => {
  assert.match(ext, /<MoreOptions testid="more-options-extensiones"><Panel><Stack><Hint>\{t\('ext\.help'\)\}<\/Hint><\/Stack><\/Panel><\/MoreOptions>/);
});

test('permisos: la lista protegida conserva sus funciones', () => {
  for (const id of ['protected-item', 'protected-remove', 'protected-input', 'protected-defaults']) assert.ok(general.includes(id), id);
  for (const k of ['ext.removeNamed']) for (const l of [es, en]) assert.ok(l[k], k);
});

test('ajustes estrechos: Panel es un contenedor y Setting pasa a una columna con una consulta de contenedor', () => {
  const rows = read('src/ui/views/settings/rows.jsx');
  assert.match(rows, /cn\('@container mt-3', className\)/);
  assert.match(rows, /@max-\[34rem\]:flex-col @max-\[34rem\]:items-stretch/);
});

test('retoques: idioma sin país, bloqueo en «N min», comentarios con «Error» por defecto, título veraz de las rutas', () => {
  assert.ok(general.includes('label.replace(/' + '\\s*\\(.*\\)$/, \'\')'));
  assert.equal(es['master.lockMinutes'], '{n} min'); assert.equal(en['master.lockMinutes'], '{n} min');
  assert.match(read('src/ui/components/feedback-pop.jsx'), /useState\(\{ type: 'error', message/);
  assert.equal(es['settings.protected'], 'Elementos protegidos');
});
