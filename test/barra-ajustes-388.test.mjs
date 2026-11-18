// Orb UI 2.0, paso 5C: the sidebar's small adjustments and the passing notices, read as source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const inbox = read('src/ui/views/orb/inbox.jsx');

test('el «+» del grupo crea el chat del proyecto y su ⋯ conserva menú e información', () => {
  assert.match(inbox, /onClick=\{\(\) => newChat\(name\)\} data-testid=\{`project-new-\$\{name\}`\}/);
  assert.match(inbox, /data-testid=\{`project-menu-\$\{name\}`\}><Ellipsis \/>/);
  assert.match(inbox, /data-testid="project-new-chat"/);
  assert.match(inbox, /openOrbInfo\(\{ type: 'project', name \}\)\} data-testid="project-info"/);
});

test('«Abrir en pestaña nueva» está en el menú de la fila del PC, antes de lo destructivo', () => {
  assert.match(inbox, /id: 'newtab'[^\n]*orbchats\.openNewTab[^\n]*mode: 'new'/);
  assert.match(inbox, /useOrbActions\(item, \{ tab: true \}\)/);
  assert.match(inbox, /s\.app\?\.config\?\.ui\?\.tabs !== false/);
  for (const l of ['es', 'en']) assert.match(read(`src/shared/locales/${l}/orbchats.mjs`), /'orbchats\.openNewTab'/);
});

test('el menú «+» enseña el atajo de chat nuevo (Ctrl+N; Ctrl+T sigue abriendo pestaña)', () => {
  assert.match(inbox, /useKeys\(\)\.table\.get\('chat\.new'\)/);
  assert.match(inbox, /data-testid="new-conversation-key"/);
  assert.match(read('src/shared/keybindings.mjs'), /id: 'tabs\.new'[^\n]*key: 'Ctrl\+T'/);
  assert.match(read('src/shared/keybindings.mjs'), /id: 'chat\.new'.*key: 'Ctrl\+N'/);
  assert.match(read('src/ui/components/chat-tabs.jsx'), /useShortcut\('chat\.new'/);
});

test('los avisos flotantes usan los tokens de .pop y quedan bajo la cabecera de 56 px', () => {
  const css = read('src/ui/themes/pieces.css');
  const at = css.indexOf('passing notices');
  assert.ok(at > 0);
  const block = css.slice(at);
  for (const tok of ['--popover)', '--border)', '--r-card)', '--shadow)', '--primary-text)']) assert.ok(block.includes(tok), tok);
  assert.match(block, /font-size: 13px/);
  const main = read('src/ui/main.jsx');
  assert.match(main, /offset=\{72\}/);
  assert.match(main, /orb-toast/);
  assert.doesNotMatch(main, /<Toaster[^>]*richColors/);
});

test('paso 6C2: el menú de la fila de un chat con agente tiene Información, Marcar como leído y Eliminar… como el de Orbe', () => {
  const list = inbox.slice(inbox.indexOf('function actionList'), inbox.indexOf('// «Renombrar» from the list'));
  assert.match(list, /if \(item\.kind === 'session'\) return \[info, rename, pin, snooze, mute, \.\.\.read, done\('sidebar\.complete'/);
  assert.match(list, /item\.kind === 'session' \? deleteSessionChat\(item, t\) : deleteChat\(item, t\)/);
  assert.match(inbox, /call\('sessions\.remove', \{ id: item\.id \}\)/);
  for (const l of ['es', 'en']) for (const k of ['rowInfo', 'rowPin', 'rowSnooze', 'rowComplete', 'rowDelete']) assert.match(read(`src/shared/locales/${l}/orbchats.mjs`), new RegExp(`'orbchats\.${k}'`));
});

test('paso 6C2: la fila en espera dice «Esperando tu aprobación» en ámbar y un chat trabajando no enseña la hora', () => {
  assert.match(inbox, /const waitText = needsYou \? t\('orbchats\.awaiting'\) : ''/);
  assert.match(inbox, /needsYou \|\| p\.tone === 'warn' \? 'text-warning-ink'/);
  assert.match(inbox, /\{working \? null : <span className=\{cn\('shrink-0 text-micro tabular-nums'/);
});

test('paso 6C2: los puntos de la cabecera de un grupo solo salen con el grupo plegado', () => {
  const head = inbox.slice(inbox.indexOf('function ProjectHead'), inbox.indexOf('// a long list draws'));
  assert.match(head, /\{open \? null : <>\s*\{group\.waiting/);
});

test('paso 6C2: «Toda la actividad» sin el margen de más y la marca del carril de la conversación solo al pasar el ratón', () => {
  assert.doesNotMatch(inbox, /mt-1\.5 flex items-center justify-between px-4 pt-2\.5 pb-1 text-caption/);
  assert.match(read('src/ui/app.css'), /\[data-testid="chat-trail"\]:not\(:hover\):not\(:focus-within\) span\.block \{ opacity: 0 !important; \}/);
});

test('paso 6C2: el resumen del día usa la tarjeta de la maqueta (icono, texto corto, cerrar)', () => {
  const digest = read('src/ui/components/day-digest.jsx');
  assert.match(digest, /Sunrise/);
  assert.match(digest, /data-testid="day-digest-close"/);
});
