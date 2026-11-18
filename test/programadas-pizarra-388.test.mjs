// Orb UI 2.0 › Programadas and Pizarra (PC app): the mock-up's list and canvas layout, without losing a function or a test id.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const schedules = read('src/ui/views/schedules.jsx');
const whiteboard = read('src/ui/views/whiteboard.jsx');
const board = read('src/ui/components/excalidraw-board.jsx');
const FILES = ['src/ui/views/schedules.jsx', 'src/ui/views/whiteboard.jsx', 'src/ui/components/excalidraw-board.jsx'];

test('los data-testid de HEAD de estas vistas siguen en sus archivos', () => {
  const now = { 'src/ui/views/schedules.jsx': schedules, 'src/ui/views/whiteboard.jsx': whiteboard, 'src/ui/components/excalidraw-board.jsx': board };
  for (const file of FILES) {
    let head = '';
    try { head = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { continue; }
    for (const id of new Set([...head.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]))) assert.ok(now[file].includes(`data-testid="${id}"`) || now[file].includes(`'${id}'`) || now[file].includes(`testid="${id}"`), `${file}: falta ${id}`);
  }
});

test('Programadas: cada fila lleva interruptor, botones de 24 px y las piezas de la maqueta', () => {
  assert.match(schedules, /fullPc\(\) \? <SchedulesPc \/> : <SchedulesLegacy \/>/, 'el móvil y el navegador enlazado conservan su maquetación');
  assert.match(schedules, /<ListCard data-testid="schedules-list">/);
  assert.match(schedules, /<ListRow data-testid="schedule-row"/);
  assert.match(schedules, /<IconButton small label=\{tr\('schedules\.edit'\)\}/, 'editar: botón de icono de 24 px');
  assert.match(schedules, /<IconButton small label=\{tr\('schedules\.remove'\)\}/, 'eliminar: botón de icono de 24 px');
  assert.match(schedules, /<Switch checked=\{s\.enabled\}[\s\S]*?data-testid="schedule-switch"/);
  assert.match(schedules, /<Button size="xs" variant="outline" onClick=\{run\}[^>]*><Play \/>\{tr\('schedules\.runNow'\)\}/);
  assert.match(schedules, /<Segmented [^>]*schedule-filter-|testid: `schedule-filter-\$\{key\}`/);
  for (const key of ['all', 'active', 'paused', 'failed']) assert.ok(read('src/shared/locales/es/schedules.mjs').includes(`'schedules.filter.${key}'`));
  assert.doesNotMatch(schedules, /<select\b/, 'menús de Orb, nunca el select del sistema');
});

test('Programadas: la cabecera común, el vacío y las confirmaciones de siempre', () => {
  assert.match(schedules, /<BarPause \/>\s*<NotificationBell \/>/);
  assert.match(schedules, /data-testid="schedules-more"/);
  assert.match(schedules, /<Empty icon=\{CalendarSync\}[^>]*>[\s\S]*?data-testid="new-schedule"/);
  assert.match(schedules, /confirm\(tr\('schedules\.remove\.title'\)/);
  assert.match(schedules, /call\('schedules\.update', \{ id: s\.id, approve: true \}\)/);
  assert.match(schedules, /call\('schedules\.run', \{ id: s\.id \}\)/);
  assert.match(schedules, /call\('schedules\.remove', \{ id: s\.id \}\)/);
  assert.match(schedules, /call\('schedules\.update', \{ id: s\.id, title: v\.title\.trim\(\), description: v\.description\.trim\(\) \}\)/, 'editar usa solo lo que el motor ya permite cambiar');
  assert.match(schedules, /wide: true/, 'el diálogo de crear es el ancho de la maqueta');
});

test('Pizarra: con «Adjuntos» abierto el selector de proyecto pasa al menú ⋯', () => {
  assert.match(whiteboard, /\{panel && project \? null : \(\s*<Select [\s\S]*?data-testid="project-picker"/);
  assert.match(whiteboard, /\{panel \? \(\s*<>\s*<DropdownMenuLabel>\{t\('wb\.project'\)\}<\/DropdownMenuLabel>/);
  assert.match(whiteboard, /call\('projects\.setActive', \{ name \}\)/);
  assert.match(whiteboard, /<IconButton label=\{t\('wb\.attachments'\)\} active=\{panel\}/, 'el clip de la cabecera muestra y oculta el panel');
  assert.match(whiteboard, /<ChatPanel open=\{Boolean\(project\) && panel\}[\s\S]*?defaultWidth=\{360\}/);
});

test('Pizarra: el menú del lienzo lleva lo que Excalidraw ya ofrece, sin lógica nueva del motor', () => {
  for (const id of ['whiteboard-menu-folder', 'whiteboard-menu-export', 'whiteboard-menu-fit', 'whiteboard-menu-clear']) assert.ok(whiteboard.includes(`data-testid="${id}"`), id);
  assert.match(whiteboard, /openDialog: \{ name: 'imageExport' \}/);
  assert.match(whiteboard, /scrollToContent\(els, \{ fitToContent: true/);
  assert.match(whiteboard, /api\.current\?\.resetScene\(\)/);
  assert.match(whiteboard, /confirm\(t\('wb\.clear\.title'\)[\s\S]*?danger: true/, 'vaciar pide confirmación');
  assert.match(whiteboard, /whiteboard\.folder/);
  assert.match(board, /onApi\?\.\(a\)/, 'el lienzo entrega su API a la vista');
});

test('Pizarra: el móvil conserva el panel flotante y todas las funciones de adjuntos', () => {
  assert.match(whiteboard, /if \(fullPc\(\)\) return <WhiteboardPc /);
  for (const call of ['whiteboard.load', 'whiteboard.save', 'whiteboard.attach', 'whiteboard.note', 'whiteboard.remove', 'whiteboard.folder']) assert.ok(whiteboard.includes(`'${call}'`), call);
  assert.match(whiteboard, /className=\{cn\('wb-panel absolute/);
});

test('mis archivos conservan los finales de línea LF', () => {
  for (const f of [...FILES, 'src/ui/components/chat-panel.jsx', 'test/programadas-pizarra-388.test.mjs']) assert.ok(!read(f).includes('\r'), `${f} tiene CRLF`);
});

test('step 7F: the runs list retries with the same rule as the task rows, and a schedule not approved has a disabled switch', () => {
  assert.match(schedules, /import \{ canRetryFromRow \} from '\.\/tasks\.jsx';/);
  assert.match(schedules, /\{canRetryFromRow\(x\) \? <RetryRun id=\{x\.id\} \/> : null\}/);
  assert.doesNotMatch(schedules, /'cancelled'/);
  assert.match(schedules, /<Button size="xs" variant="outline" disabled=\{busy\} onClick=\{retry\}/);
  assert.match(schedules, /<Switch checked=\{false\} disabled aria-label=\{tr\('schedules\.enabled'\)\}/);
  for (const l of ['es', 'en']) assert.ok(read(`src/shared/locales/${l}/schedules.mjs`).includes("'schedules.approveFirst'"));
});

test('step 7C-b: «Nueva programada» is 620 px, joins agent and model, shows the zone and the next run, and keeps «Cada N horas» and «mismo chat»', () => {
  assert.match(read('src/ui/themes/pieces.css'), /\.dialog:has\(\[data-testid="schedule-summary"\]\) \{ max-width: min\(620px/);
  assert.match(schedules, /<Field label=\{t\('schedules\.agentModel'\)\}>/);
  assert.match(schedules, /const \[agent, model\] = brain\.split\('::'\);/);
  assert.match(schedules, /\.\.\.\(model \? \{ model \} : \{\}\)/);
  assert.match(schedules, /data-testid="schedule-tz"/);
  assert.match(schedules, /t\('schedules\.sum\.next'/);
  assert.match(schedules, /const EVERY = \['hourly', 'daily', 'weekly', 'every_hours', 'once'\];/);
  assert.match(schedules, /testid="schedule-same-chat"/);
  assert.match(schedules, /data-testid="schedule-permissions"/);
  // the engine's create has no zone, no monthly and no permission level of its own: none is sent
  assert.doesNotMatch(schedules, /tz: |monthly/);
});

test('step 7C-b: a row shows the model by its name and the zone of its time', () => {
  assert.match(schedules, /const brain = \(s\.model && modelsOf\(/);
  assert.match(schedules, /\['daily', 'weekly', 'once'\]\.includes\(s\.every\)/);
  assert.match(schedules, /call\('models\.catalog'\)/);
});
