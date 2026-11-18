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
