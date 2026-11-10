// 3.8.2: search by content and Ctrl+K. The sidebar's search keeps finding chats as before and now also finds tasks by
// what they say (tasks.search); Ctrl+K (lib/palette.js) shows the same results plus Orb's places, and never takes the key
// from what already uses it.
import { tempHome, ROOT } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { DESKTOP, principalOf, METHODS } from '../src/domain/security/permissions.mjs';
import { isPaletteKey, paletteGroups } from '../src/ui/lib/palette.js';

let t; let board; let api; let sessions;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  fs.mkdirSync(path.join(t.home, 'web', 'tienda'), { recursive: true });
  board.addProject({ name: 'tienda', path: path.join(t.home, 'web', 'tienda') }, 'usuario', { fromUser: true });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('tasks.search: by title, brief or result, without case or accents, with a snippet; also from the phone', async () => {
  const a = board.createTask({ project: 'tienda', title: 'Cambiar el pie', description: 'Añade el CORAZÓN rojo al pie de la página principal.' }, 'usuario');
  const b = board.createTask({ project: 'tienda', title: 'Corazón del logo', description: 'otra cosa' }, 'usuario');
  board.patch(b.id, { result: 'hecho' }, 'orb', 'test');
  const c = board.createTask({ project: 'tienda', title: 'Pruebas', description: 'nada' }, 'usuario');
  board.patch(c.id, { result: 'Las pruebas del corazon pasan. TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, 'orb', 'test');
  const found = await call('tasks.search', { q: 'corazon' });
  assert.deepEqual(found.map((x) => x.id), [c.id, b.id, a.id], 'the newest first');
  assert.equal(found.find((x) => x.id === b.id).snippet, '', 'found by its title: no snippet');
  assert.match(found.find((x) => x.id === a.id).snippet, /CORAZÓN rojo/);
  assert.doesNotMatch(found.find((x) => x.id === c.id).snippet, /ghp_abcdefghijklmnop/, 'secrets are never shown');
  assert.deepEqual(await call('tasks.search', { q: 'c' }), [], 'from two letters');
  assert.equal(METHODS['tasks.search'], 'remote');
  const phone = principalOf({ device: { id: 'p1', kind: 'phone' } });
  assert.equal((await call('tasks.search', { q: 'corazón' }, phone)).length, 3);
});

test('the sidebar search is the same as before, now with the tasks found by their content after the ones by title', () => {
  const inbox = read('views', 'orb', 'inbox.jsx');
  const lib = read('lib', 'search.js');
  // The same calls as before (inbox.search for the chats with Orb, conversations.search for the direct ones), plus tasks.
  assert.match(lib, /call\('inbox\.search', \{ zone: 'orb', q \}\)/);
  assert.match(lib, /call\('conversations\.search', \{ q \}\)/);
  assert.match(lib, /call\('tasks\.search', \{ q \}\)/);
  assert.match(inbox, /import \{ useSearch \} from '@\/lib\/search\.js'/);
  assert.match(inbox, /const own = tasks\.filter\(\(x\) => `#\$\{x\.id\}` === q \|\| String\(x\.title\)\.toLowerCase\(\)\.includes\(q\)\)\.slice\(0, 12\)/, 'the title matches as before, first');
  assert.match(inbox, /placeholder=\{t\('orbchats\.search'\)\}/, 'the same box');
});

test('Ctrl+K: only the key alone, and it waits for what already uses it', () => {
  const k = (o) => ({ code: 'KeyK', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  assert.equal(isPaletteKey(k({ ctrlKey: true })), true);
  assert.equal(isPaletteKey(k({ metaKey: true })), true);
  for (const o of [{}, { ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }, { ctrlKey: true, code: 'KeyJ' }]) assert.equal(isPaletteKey(k(o)), false, JSON.stringify(o));
  const palette = read('components', 'command-palette.jsx');
  assert.match(palette, /!e\.defaultPrevented && !document\.querySelector\('\[role=dialog\]'\)/, 'a project action, the whiteboard or a dialog keep Ctrl+K');
  // No other shortcut of Orb is Ctrl+K: the terminal is Ctrl+J, zoom Ctrl +/-/0, F5 and F11.
  for (const file of [['lib', 'tauri-bridge.js'], ['main.jsx'], ['components', 'project-tools.jsx']]) assert.doesNotMatch(read(...file), /KeyK|key(\.toLowerCase\(\))? === 'k'/i, file.join('/'));
  assert.match(read('main.jsx'), /bridge\.mobile \? null : <><ActionShortcuts project=\{shortcutProject\} \/><CommandPalette \/><\/>/, 'PC only, next to the actions');
});

test('Ctrl+K: places without a query; with one, chats, messages, tasks and projects', () => {
  const cmds = [{ key: 'tasks', label: 'Tareas' }, { key: 'settings', label: 'Ajustes' }];
  assert.deepEqual(paletteGroups({ q: '  ', cmds, items: [], found: null, tasks: [], projects: [] }), [{ id: 'go', rows: cmds }]);
  const items = [{ key: 'c1', kind: 'conversation', id: 1, title: 'Diseño de la tienda', project: 'web' }, { key: 's1', kind: 'session', id: 's1', title: 'Otro', project: null }, { key: 'c2', kind: 'conversation', id: 2, title: 'Nada', project: null }];
  const found = { conversations: new Set(), sessions: new Set(['s1']), messages: [{ key: 'c2', line: { id: 9, text: '…la tienda…' } }, { key: 'gone', line: { id: 1, text: 'x' } }], tasks: [{ id: 7, title: 'Pie', snippet: 'tienda' }, { id: 3, title: 'dup' }] };
  const g = paletteGroups({ q: 'TIENDA', cmds, items, found, tasks: [{ id: 3, title: 'Tienda nueva' }], projects: [{ name: 'tienda' }, { name: 'blog' }] });
  assert.deepEqual(g.map((x) => x.id), ['chats', 'messages', 'tasks', 'projects']);
  assert.deepEqual(g[0].rows.map((x) => x.key), ['c1', 's1'], 'by title, and the direct chat by its messages');
  assert.deepEqual(g[1].rows.map((x) => x.key), ['c2'], 'a message of a chat not listed above; one of a chat that is gone is left out');
  assert.deepEqual(g[2].rows.map((x) => x.id), [3, 7], 'by title first, then by content, once each');
  assert.deepEqual(g[3].rows.map((x) => x.name), ['tienda']);
  assert.deepEqual(paletteGroups({ q: 'ajus', cmds, items, found: null, tasks: [], projects: [] }), [{ id: 'go', rows: [cmds[1]] }]);
  assert.equal(paletteGroups({ q: '#3', cmds, items: [], found: null, tasks: [{ id: 3, title: 'x' }], projects: [] })[0].rows[0].id, 3);
});

// (The same harness.) 3.8.2: «Continuar con otro agente» from the window: only an agent this PC can run.
test('sessions.fork with another agent: only an available one; without it, the fork of before', async () => {
  const s = await call('sessions.create', { agent: 'claude', permission: 'leer', title: 'Base' });
  board.settingJson('agents_available', ['claude']);
  await assert.rejects(call('sessions.fork', { id: s.id, agent: 'codex' }));
  await assert.rejects(call('sessions.fork', { id: s.id, agent: 'nadie' }));
  board.settingJson('agents_available', ['claude', 'codex']);
  assert.equal((await call('sessions.fork', { id: s.id, agent: 'codex' })).agent, 'codex');
  const plain = await call('sessions.fork', { id: s.id });
  assert.equal(plain.agent, 'claude'); assert.match(plain.title, /bifurcación/);
  board.settingJson('agents_available', null);
});
