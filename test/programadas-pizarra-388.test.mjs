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
  assert.match(schedules, /call\('schedules\.update', \{ id: s\.id, approve: true, hash: s\.previewHash \}\)/);
  assert.match(schedules, /call\('schedules\.run', \{ id: s\.id, hash: s\.previewHash \}\)/);
  assert.match(schedules, /call\('schedules\.remove', \{ id: s\.id \}\)/);
  assert.match(schedules, /schedules\.update'/,'editar usa el mismo diálogo que crear y manda solo lo que cambió');
  assert.match(schedules, /sm:max-w-2xl/, 'el diálogo de crear y editar es el ancho de la maqueta');
});

test('Pizarra: el selector de proyecto vive en el menú ⋯ (la cabecera de la maqueta no lo dibuja)', () => {
  assert.doesNotMatch(whiteboard, /<Select /);
  assert.match(whiteboard, /<DropdownMenuLabel data-testid="project-picker">\{t\('wb\.project'\)\}<\/DropdownMenuLabel>/);
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
  assert.match(schedules, /<Field label=\{tr\('schedules\.agentModel'\)\}>/);
  assert.match(schedules, /const \[agent, model\] = v\.brain\.split\('::'\);/);
  assert.match(schedules, /model: model \|\| undefined/);
  assert.match(schedules, /data-testid="schedule-tz"/);
  assert.match(schedules, /t\('schedules\.sum\.next'/);
  assert.match(schedules, /const EVERY = \['hourly', 'daily', 'weekly', 'monthly', 'once'\];/,'«Cada N horas» pasa a Más opciones');
  assert.match(schedules, /testid="schedule-same-chat"/);
  assert.match(schedules, /data-testid="schedule-permissions"/);
});

test('step 7C-b: a row shows the model by its name and the zone of its time', () => {
  assert.match(schedules, /const brain = \(s\.model && modelsOf\(/);
  assert.match(schedules, /\['daily', 'weekly', 'monthly', 'once'\]\.includes\(s\.every\)/);
  assert.match(schedules, /call\('models\.catalog'\)/);
});

test('8C-a: a form dialog keeps its header and footer in view and scrolls only its body; every dialog but the wide ones is the 440 px one', () => {
  const dialogs = read('src/ui/components/dialogs.jsx');
  assert.match(dialogs, /grid-rows-\[minmax\(0,1fr\)\] gap-0 overflow-hidden p-0/);
  assert.match(dialogs, /<DialogBody className="grid gap-4 p-\[18px\]">\{d\.body\(values, set\)\}/);
  assert.match(read('src/ui/components/ui/overlay.jsx'), /cn\('min-h-0 flex-1 overflow-y-auto', className\)/);
  assert.match(dialogs, /<DialogHeader className="flex-none"><DialogTitle>\{d\.title\}<\/DialogTitle>/);
  assert.match(dialogs, /<DialogFooter className="flex-none">/);
  assert.match(dialogs, /size=\{d\.wide \? undefined : 'sm'\}/);
  assert.match(dialogs, /d\.tone === 'primary' \? 'default' : d\.danger \? 'destructive'/);
  // the focus rule of a dangerous confirmation does not depend on its colour
  assert.match(dialogs, /data-autofocus=\{d\.danger \? "" : undefined\}/);
});

test('8C-a: the notices stay clear of the whiteboard bar and of the controls of an open dialog', () => {
  const main = read('src/ui/main.jsx');
  assert.match(main, /whiteboard-status"\], \.zoom-actions/);
  assert.match(main, /\[data-slot="dialog-content"\]/);
  assert.match(main, /const dialog = \[\.\.\.document\.querySelectorAll\('\[data-slot="dialog-content"\]'\)\]/);
  // the old guarantees: only a watched box or panel coming or going costs a measure, and gone nodes are let go
  assert.match(main, /if \(!el\.isConnected\) \{ resizes\.unobserve\(el\); seen\.delete\(el\); \}/);
  assert.match(main, /const touches = \(nodes\)/);
});
