// 3.8.8 paso 11b (tanda 1), interfaz: el menú de la fila enseña una sola entrada de leído que cambia según haya o no algo sin
// leer, el panel de la PR no ofrece arreglar ni vigilar una PR ya cerrada y la Ficha de un chat de agente lista las tareas
// que nacieron de él. Se lee el código como texto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orbItems } from '../src/ui/lib/inbox.js';
import { createT } from '../src/shared/i18n.mjs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('«Marcar como no leído»: una entrada que cambia, en los dos idiomas, y la fila de un chat con un agente cuenta lo marcado', () => {
  const jsx = read('src/ui/views/orb/inbox.jsx');
  const block = jsx.slice(jsx.indexOf('const read = item.unread'), jsx.indexOf('const done = (method, args)'));
  assert.match(block, /id: 'read'.*inbox\.markRead/s);
  assert.match(block, /id: 'unread'.*inbox\.markUnread/s);
  assert.match(block, /: row \?/);
  for (const lang of ['es', 'en']) {
    const tr = createT(lang);
    assert.notEqual(tr('chats.markUnread'), 'chats.markUnread'); assert.notEqual(tr('chats.markUnread'), tr('chats.markRead'));
  }
  const [row] = orbItems({ inbox: { items: [{ key: 'session:s1', unread: 1, markedUnread: true }] }, sessions: [{ id: 's1', kind: 'chat', title: 'x' }] });
  assert.equal(row.unread, 1); assert.equal(row.markedUnread, true);
  const [plain] = orbItems({ sessions: [{ id: 's2', kind: 'chat', title: 'y' }] });
  assert.equal(plain.unread, 0);
});

test('abrir el chat lo lee, pero marcarlo como no leído estando abierto no lo deshace', () => {
  const jsx = read('src/ui/views/orb/inbox.jsx');
  assert.match(jsx, /export function useReadOnOpen/);
  assert.match(read('src/ui/views/session.jsx'), /useReadOnOpen\(route\.id\)/);
  assert.match(read('src/ui/views/chat.jsx'), /keptUnread/);
});

test('el panel de la PR enseña Fusionada o Cerrada y no ofrece arreglar ni vigilar una PR terminada', () => {
  const jsx = read('src/ui/components/pr-card.jsx');
  assert.match(jsx, /projects\.branchPr/);
  assert.match(jsx, /const over = state === 'merged' \|\| state === 'closed'/);
  assert.match(jsx, /\{over \? null : <>/);
  assert.match(jsx, /\{over \? <div className="border-y" \/> : \(/);
  for (const lang of ['es', 'en']) { const tr = createT(lang); assert.notEqual(tr('panel.pr.merged'), 'panel.pr.merged'); assert.notEqual(tr('panel.pr.closed'), 'panel.pr.closed'); }
  // the same test ids as before
  for (const id of ['pr-bar', 'pr-title', 'pr-watch', 'pr-fix-comments', 'pr-fix-conflicts', 'pr-body', 'pr-checks']) assert.ok(jsx.includes(`data-testid="${id}"`), id);
});

test('la Ficha de un chat con un agente lista sus tareas y deja encargar una desde ese chat', () => {
  const jsx = read('src/ui/views/orb/info.jsx');
  assert.match(jsx, /String\(x\.session_id\) === String\(s\.id\) \|\| String\(x\.origin_session\) === String\(s\.id\)/);
  assert.match(jsx, /data-testid="info-tasks"/);
  assert.match(jsx, /\{s\.project \? \(\s*<>[\s\S]*data-testid="info-new-task"/);
  assert.match(jsx, /askNewTask\(t, \[s\.project\], s\.project, String\(s\.id\)\)/);
  const dialog = read('src/ui/components/new-task.jsx');
  assert.match(dialog, /export async function askNewTask\(tr, projects, current, origin = null\)/);
  assert.match(dialog, /origin_session: origin/);
  assert.match(read('src/ui/views/tasks.jsx'), /import \{ askNewTask \} from '@\/components\/new-task\.jsx'/);
});

test('el panel de la PR no pide la PR terminada de la rama por defecto y no repite la pregunta', () => {
  const jsx = read('src/ui/components/pr-card.jsx');
  assert.match(jsx, /DEFAULT_BRANCHES = new Set\(\['main', 'master'\]\)/);
  assert.match(jsx, /lastPrs\.has\(key\)/);
  // a missing PR or a failed lookup is never remembered
  assert.match(jsx, /if \(!found\) \{ if \(alive\) setPr\(null\); return; \}\s+lastPrs\.set\(key, found\)/);
});

test('leer al abrir: con la ventana oculta no se lee y el chat de Orbe marcado vuelve a leerse al llegar una línea', () => {
  const inbox = read('src/ui/views/orb/inbox.jsx');
  const hook = inbox.slice(inbox.indexOf('export function useReadOnOpen'), inbox.indexOf('export function useOrbItems'));
  assert.match(hook, /document\.visibilityState !== 'visible'/);
  assert.match(hook, /orbInbox\)/);
  assert.match(read('src/ui/views/chat.jsx'), /rows\.length <= keep\.current\.rows/);
});
