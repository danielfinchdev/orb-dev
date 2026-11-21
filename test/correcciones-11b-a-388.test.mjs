// Fidelity fixes, part A: chat, text box, scroll bars, start-up notices (read as text, like the other UI tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const chat = read('src/ui/views/chat.jsx');
const session = read('src/ui/views/session.jsx');
const css = read('src/ui/app.css');
const main = read('src/ui/main.jsx');

test('1: both conversations end their scroller in a soft fade', () => {
  assert.match(css, /\.chat-fade \{[^}]*mask-image: linear-gradient\(to bottom, #000 calc\(100% - 20px\), transparent\)/);
  assert.match(chat, /className="chat-fade min-h-0 flex-1 overflow-y-auto/);
  assert.match(session, /className="chat-fade min-h-0 flex-1 overflow-x-hidden overflow-y-auto/);
});

test('3: the locked orchestrator switch keeps its full accent', () => {
  assert.match(chat, /<Switch size="sm" className="disabled:opacity-100" checked=\{on\} disabled=\{locked\}/);
});

test('5: the scroll thumb is not drawn at rest, only while scrolling or under the pointer', () => {
  assert.match(css, /::-webkit-scrollbar-thumb \{ background: transparent;/);
  assert.match(css, /\[data-scrolling\]::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover \{ background: color-mix/);
  assert.doesNotMatch(css, /\n\s*:hover::-webkit-scrollbar-thumb/);
  assert.match(read('src/ui/lib/scroll-hint.js'), /setAttribute\('data-scrolling', ''\)/);
  assert.match(main, /import '\.\/lib\/scroll-hint\.js';/);
});

test('6: each start-up hint says what is true, and the keys are documented', () => {
  const boundary = read('src/ui/components/error-boundary.jsx');
  assert.match(boundary, /function CrashCard[\s\S]*t\('app\.errorHint'\)/, 'a screen failed: the engine is alive');
  assert.match(main, /function StartError[\s\S]*t\('app\.crashHint'\)/, 'the engine did not start');
  for (const l of ['es', 'en']) {
    const app = read(`src/shared/locales/${l}/app.mjs`);
    assert.match(app, /\/\/ errorHint: a screen failed while drawing[^\n]*\n\s*\/\/ crashHint: the engine did not start/);
    assert.match(app, /"app\.errorHint"[^\n]*\n\s*"app\.crashHint"/);
  }
  assert.match(read('src/shared/locales/es/app.mjs'), /"app\.errorHint": "Pulsa F5[^"]*Orb sigue funcionando por debajo\."/);
  assert.match(read('src/shared/locales/es/app.mjs'), /"app\.crashHint": "Con F5 se vuelve a cargar la ventana\."/);
});

test('7: an unread row keeps a normal-weight title and a grey time; the counter tells it apart', () => {
  const inbox = read('src/ui/views/orb/inbox.jsx');
  assert.match(inbox, /truncate text-control leading-5', 'font-normal'/);
  assert.match(inbox, /<span className="text-faint-foreground shrink-0 text-micro tabular-nums">\{time\}<\/span>/);
});

test('8: the text box bar is 6 px above a 32 px row and 8 px below; the box has a 56 px field', () => {
  const composer = read('src/ui/components/conversation/composer.jsx');
  assert.match(composer, /flex items-center gap-2 px-3 pt-1\.5 pb-2/);
  assert.match(composer, /flex min-h-\(--ctl\) min-w-0 flex-1 flex-wrap/);
  assert.match(css, /\.composer-text \{ field-sizing: content; min-height: 56px;/);
});

test('9: the branch of «desde main» is set in medium weight', () => {
  const pills = read('src/ui/components/workspace-pills.jsx');
  assert.match(pills, /<b className="text-muted-foreground font-medium">\{branch\}<\/b>/);
  assert.equal((pills.match(/<FromBase branch=/g) ?? []).length, 2);
  assert.doesNotMatch(pills, /\{t\('chat\.workspace\.from'/, 'only FromBase translates it');
});

test('10: the Ficha title card is as tall as the mock-up and names a worktree as such', () => {
  const info = read('src/ui/views/orb/info.jsx');
  assert.match(info, /flex min-h-\(--ctl\) items-center justify-between gap-2/);
  assert.doesNotMatch(info, /<IconButton small label=\{t\('panel\.info\.rename'\)/);
  assert.match(info, /tree \? t\('panel\.info\.worktree'\) : t\('panel\.info\.branch'\)/, 'Rama only when there is no worktree');
});

test('11: the messages line up with the edges of the text box in both conversations', () => {
  const column = /max-w-\[calc\(var\(--chat-max-width\)\+2\.5rem-var\(--sb-w\)\)\]/;
  assert.match(chat, column);
  assert.match(session, column);
  for (const src of [chat, session]) assert.match(src, /pr-\[calc\(1\.25rem-var\(--sb-w\)\)\] pl-5/, 'the bar\'s room comes out of the right padding');
  assert.doesNotMatch(session, /max-w-3xl/);
});

test('12: the panel button of both headers is marked while its panel is open', () => {
  assert.match(chat, /<IconButton label=\{t\('panel\.button'\)\} active=\{infoOpen\}/);
  assert.match(session, /<IconButton label=\{t\('panel\.button'\)\} active=\{panel !== null\}/);
  assert.match(read('src/ui/components/ui/primitives.jsx'), /data-\[active=true\]:bg-accent/);
});

test('13b: «Algo falló» and «Sin conexión» are drawn in the content area with the sidebar on view', () => {
  // the preview has no data for the real sidebar: its place is kept, so the card is centred in the content area
  assert.match(main, /function PreviewSidebar\(\)[\s\S]*bg-sidebar hidden h-full w-\[340px\] shrink-0 flex-col border-r md:flex/);
  assert.match(main, /data\.card === 'crash' \? <InArea><CrashCard/);
  assert.match(main, /data\.card === 'offline' \? <InArea><OfflineCard/);
});

test('14: the migration notice keeps its update button while the download runs, with the updater\'s own call', () => {
  assert.match(main, /u\?\.percent != null \? <Button variant="outline" disabled data-testid="migration-update"><Download \/>/);
  assert.match(main, /updateActions\.update\(\{ portable: u\.portable \}\)/, 'the same call as Ajustes');
});

test('15: «¿Empezar con una clave nueva?» has no corner cross, in both of its forms', () => {
  const ask = read('src/ui/components/new-secret.jsx');
  assert.ok(ask.includes("{ ok: tNow('app.newSecretOk'), danger: true, noClose: true }"));
  assert.ok(ask.includes('okDanger: true,\n    noClose: true,'));
});
