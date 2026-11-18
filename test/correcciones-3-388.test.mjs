// Third round of fidelity fixes (interface only): one check per point of the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const locale = (lang, file) => fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, file), 'utf8');

test('1a: in a narrow window the date goes first and then the whole clock, so the title never runs under it', () => {
  const css = read('src/ui/app.css');
  assert.match(css, /@container bar \(max-width: 560px\) \{ \.bar \.bar-clock-date \{ display: none; \} \}/);
  assert.match(css, /@container bar \(max-width: 480px\) \{ \.bar \.bar-clock \{ display: none; \} \}/);
  assert.match(css, /\.bar-center \.name \{[^}]*text-overflow: ellipsis/);
});

test('1b: the held-task card breaks a long path instead of leaving the card', () => {
  assert.match(read('src/ui/components/task-state.jsx'), /\[overflow-wrap:anywhere\]" title=\{h\.folder \|\| undefined\}>\{h\.folder/);
  assert.match(read('src/ui/views/tasks.jsx'), /@max-\[44rem\]\/tasks:absolute!/);
});

test('1c: the spend profile segmented stacks in a narrow card instead of being cut', () => {
  assert.match(read('src/ui/views/settings/general.jsx'), /<Segmented className="max-w-full @max-\[28rem\]:w-full @max-\[28rem\]:flex-col"/);
});

test('2: «Bloquear Orb tras» says «sin usar» beside the selector', () => {
  const master = read('src/ui/views/master.jsx');
  assert.match(master, /data-testid="master-lock-minutes" \/>\s*<span[^>]*>\{t\('master\.lockUnused'\)\}<\/span>/);
  assert.match(locale('es', 'master.mjs'), /'master\.lockUnused': 'sin usar'/);
  assert.match(locale('en', 'master.mjs'), /'master\.lockUnused': /);
});

test('3: «Seguir sin copia» confirms with the normal main button and no corner ✕', () => {
  const core = read('src/ui/views/core-missing.jsx');
  assert.match(core, /danger: true, tone: 'primary', noClose: true/);
  assert.match(read('src/ui/main.jsx'), /danger: true, tone: 'primary', noClose: true/);
});

test('4: the backups folder is a quiet link under the buttons, not a button in the row', () => {
  const core = read('src/ui/views/core-missing.jsx');
  const footer = core.slice(core.indexOf('const footer'), core.indexOf('const folderLink'));
  assert.doesNotMatch(footer, /openFolder|openPath/);
  assert.match(core, /footnote=\{folderLink\}/);
  assert.match(core, /bridge\.openPath\(v\.folder\)/);
  assert.match(read('src/ui/components/start-card.jsx'), /footnote \?/);
});

test('5: «Empezar con una clave nueva» is offered only when the key is unreadable, and the preview draws it', () => {
  const main = read('src/ui/main.jsx');
  assert.match(main, /bridge\.retryStart && startError\?\.code === 'secretUnreadable' \? <Button variant="outline" data-testid="app-error-new-secret"/);
  assert.match(main, /if \(!\(await askNewSecret\(startError\)\)\) return;/);
  assert.match(read('src/ui/lib/start-preview.js'), /error: \{ card: 'error', error: KEY_MESSAGE, startError: \{ code: 'secretUnreadable'/);
});

test('6: «Restaurar» is never greyed out; with no code it warns under the field and focuses it', () => {
  const core = read('src/ui/views/core-missing.jsx');
  assert.match(core, /data-testid="core-restore"/);
  assert.doesNotMatch(core, /core-restore[^\n]*disabled=\{[^}]*code/);
  assert.match(core, /if \(!code\.trim\(\)\) \{ setCodeMissing\(true\); codeRef\.current\?\.focus\(\); return; \}/);
  assert.match(core, /data-testid="core-code-error"/);
  for (const l of ['es', 'en']) assert.match(locale(l, 'ws5.mjs'), /'data\.core\.codeNeeded'/);
});

test('7: the God mode panels and the live window button sit under «Más opciones» of Avanzado; the note says where protected items went', () => {
  const index = read('src/ui/views/settings/index.jsx');
  assert.match(index, /<MoreOptions testid="more-options-avanzado">\{fullPc\(\) \? <ExpertPanelsCard c=\{c\} \/> : null\}<LiveWindowCard c=\{c\} \/><McpExtCard \/>/);
  const general = read('src/ui/views/settings/general.jsx');
  const expert = general.slice(general.indexOf('export function ExpertCard'), general.indexOf('export function ExpertPanelsCard'));
  assert.doesNotMatch(expert, /PANELS|Checkbox/);
  assert.match(general.slice(general.indexOf('export function ExpertPanelsCard'), general.indexOf('function MusicSettings')), /PANELS/);
  assert.doesNotMatch(read('src/ui/views/settings/devices.jsx').slice(0, read('src/ui/views/settings/devices.jsx').indexOf('export function LiveWindowCard')).split('export function BrowserCard')[1], /showBrowser/);
  assert.match(locale('es', 'settings.mjs'), /expertOpenHint': '[^']*«Elementos protegidos» ya no está aquí: pasó a Permisos\.'/);
  assert.match(locale('en', 'settings.mjs'), /expertOpenHint': '[^']*no longer here: it moved to Permissions\.'/);
});

test('8: «Enviar comentarios» in Ajustes has its note on the left and the main «Enviar» button', () => {
  const about = read('src/ui/views/settings/about.jsx');
  assert.match(about, /<CardFoot className="justify-between"><Hint className="min-w-0 flex-1 text-left">/);
  assert.match(about, /<Button size="sm" disabled=\{busy\} onClick=\{trySend\} data-testid="feedback-send">/);
  assert.match(about, /notifyInfo\(t\('sys\.feedback\.empty'\)\)/);
});

test('9: «Sugerir el siguiente mensaje» is under «Más opciones» of the tasks section', () => {
  const general = read('src/ui/views/settings/general.jsx');
  const more = general.slice(general.indexOf('testid="spend-more"'));
  assert.match(more.slice(0, 600), /settings\.suggest'/);
  assert.match(more.slice(0, 900), /data-testid="suggest-next"/);
  assert.equal(general.split("data-testid=\"suggest-next\"").length - 1, 1);
});

test('10: the zoom shortcuts of «Tamaño de la interfaz» are plain text, not key caps', () => {
  assert.match(read('src/ui/views/settings/general.jsx'), /<WithKeys plain text=\{t\('settings\.sizeHint'\)\}/);
  const rows = read('src/ui/views/settings/rows.jsx');
  assert.match(rows, /export function WithKeys\(\{ text, keys, plain = false \}\)/);
  assert.match(rows, /if \(combo && plain\) return/);
});

test('11: the crash and offline cards sit in the content area, inside the boundary beside the sidebar', () => {
  const main = read('src/ui/main.jsx');
  const wide = main.slice(main.indexOf('<main className="theme-scene flex min-w-0 flex-1 flex-col">'));
  assert.match(wide.slice(0, 1400), /<ErrorBoundary key=\{routeKey\(r\)\} onHome=\{resetRoute\}>/);
  const card = read('src/ui/components/error-boundary.jsx');
  assert.equal(card.split('cover={false}').length - 1, 2);
  assert.match(main, /<aside className="bg-sidebar hidden h-full w-\[340px\] shrink-0 flex-col border-r md:flex"/);
});
