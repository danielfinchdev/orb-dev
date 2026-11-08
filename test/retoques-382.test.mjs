// 3.8.2, phase 1: the desktop touch-ups (the chat's bar with ⋯, «Renombrar» in the list, tooltips inside the window,
// the composer's folder chip, the cost line setting and the message's time, F5, the first run maximised and the foot of
// Ajustes). The screens are read as source, like mensajeria-orb.test.mjs; the pure helpers are run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');

test('the list ⋯ of a chat and of an agent conversation offers «Renombrar»', () => {
  const inbox = read('views', 'orb', 'inbox.jsx');
  assert.match(inbox, /export function renameChat\(item, t\)/);
  assert.match(inbox, /item\.kind === 'session' \? 'sessions\.update' : 'conversations\.update'/);
  // Both lists (the agent's conversation and the assistant's chat) carry the action.
  const actions = inbox.slice(inbox.indexOf('export function useOrbActions'), inbox.indexOf('export function renameChat'));
  assert.equal([...actions.matchAll(/^\s+rename,$/gm)].length, 2);
});

test('the chat bars keep only the bell and pause; the rest goes into ⋯', () => {
  const chat = read('views', 'chat.jsx');
  const bar = chat.slice(chat.indexOf('<ChatBar back='), chat.indexOf('</ChatBar>'));
  // Outside the menu only the bell and pause; the games live in ⋯, also in «Nuevo chat» (no conversation yet).
  const outside = bar.slice(0, bar.indexOf('<DropdownMenu'));
  assert.match(outside, /<NotificationBell \/>/); assert.match(outside, /<BarPause \/>/);
  assert.doesNotMatch(outside, /Gamepad2|bar-games/);
  assert.match(bar, /\{conv \|\| fullPc\(\) \? \(\s*<DropdownMenu/);
  assert.match(bar, /<DropdownMenuItem onSelect=\{openGames\} data-testid="bar-games">/);
  // An agent's conversation: folder, details, fork, archive, games and delete (red, after a separator, with its confirmation).
  const session = read('views', 'session.jsx');
  const head = session.slice(session.indexOf('<PageHeader className="topbar-chat"'), session.indexOf('</PageHeader>'));
  const top = head.slice(0, head.indexOf('<DropdownMenu'));
  assert.doesNotMatch(top, /FolderOpen|GitFork|Archive|Trash2|<Info|Gamepad2/);
  assert.match(top, /<NotificationBell \/>\s*<BarPause \/>/);
  const menu = head.slice(head.indexOf('<DropdownMenu'));
  for (const id of ['open-folder', 'details', 'fork', 'archive', 'bar-games', 'delete']) assert.match(menu, new RegExp(`data-testid="${id}"`), id);
  assert.match(menu, /<DropdownMenuSeparator \/>\s*<DropdownMenuItem variant="destructive" onSelect=\{async \(\) => \{ if \(await confirm\(/);
});

test('bubbles stay inside the window and the composer folder is a chip like the others', () => {
  const overlay = read('components', 'ui', 'overlay.jsx');
  // Both bubbles keep their tail off the rounded corners (it hides instead of looking cut against the window's edge).
  assert.equal([...overlay.matchAll(/collisionPadding=\{12\} arrowPadding=\{TAIL_PAD\}/g)].length, 2);
  assert.match(read('components', 'sidebar.jsx'), /side="top" align=\{n === 0 \? 'start' : 'center'\}/);
  const chip = read('views', 'session.jsx').match(/<span tabIndex=\{0\} className="([^"]+)" data-testid="session-folder">/);
  assert.ok(chip, 'folder chip');
  for (const c of ['h-8', 'rounded-lg', 'border', 'px-2.5', 'gap-1.5', 'text-[13px]']) assert.ok(chip[1].split(' ').includes(c), c);
});

test('the cost line can be hidden in Apariencia and the message time shows on hover', async () => {
  const { DEFAULT_CONFIG } = await import('../src/core/home.mjs');
  assert.equal(DEFAULT_CONFIG.ui.usageLine, true);
  assert.match(read('views', 'settings.jsx'), /<Switch checked=\{ui\.usageLine !== false\} onCheckedChange=\{\(usageLine\) => set\(\{ usageLine \}\)\}/);
  const session = read('views', 'session.jsx');
  assert.match(session, /useStore\(\(st\) => st\.app\?\.config\?\.ui\?\.usageLine !== false\)/);
  assert.match(session, /if \(it\.kind === 'usage'\) \{[\s\S]{0,120}if \(!usageLine\) return null;/);
  assert.equal([...session.matchAll(/<MsgTime at=\{it\.at\} hover \/>/g)].length, 2);
  assert.match(read('app.css'), /\.msg-hover:hover \.msg-time-hover/);
  for (const lang of ['es', 'en']) {
    const { default: dict } = await import(`../src/core/locales/${lang}/settings.mjs`);
    assert.ok(dict['appearance.usageLine'] && dict['appearance.usageLineHint'], lang);
  }
});

test('F5 reloads the window and hands each unsent message back to its box, once', async () => {
  const { saveDrafts, takeDraft, isReloadKey, reloadOrb, routeKey } = await import('../src/ui/lib/reload.js');
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), size: () => m.size }; };
  assert.equal(isReloadKey({ key: 'F5' }), true);
  assert.equal(isReloadKey({ key: 'F5', shiftKey: true }), true);
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) assert.equal(isReloadKey({ key: 'F5', [mod]: true }), false, mod);
  assert.equal(isReloadKey({ key: 'r', ctrlKey: true }), false);
  const s = mem(); const route = { view: 'session', id: 's1' };
  saveDrafts(route, { 'session-input': 'a medio escribir', 'chat-input': '   ' }, s, 1000);
  assert.equal(takeDraft('session-input', { view: 'chat' }, s, 1500), null, 'another screen');
  assert.equal(takeDraft('session-input', route, s, 1500), 'a medio escribir');
  assert.equal(takeDraft('session-input', route, s, 1600), null, 'only once');
  assert.equal(s.size(), 0);
  saveDrafts(route, { 'session-input': 'viejo' }, s, 1000);
  assert.equal(takeDraft('session-input', route, s, 1000 + 61_000), null, 'too old');
  saveDrafts(route, {}, s); assert.equal(s.size(), 0);
  assert.equal(routeKey({ view: 'chat' }), 'chat:');
  // reloadOrb reads the composers on screen, then reloads.
  let reloaded = false;
  const doc = { querySelectorAll: () => [{ dataset: { testid: 'chat-input' }, value: 'hola' }] };
  const saved = new Map(); globalThis.window = { sessionStorage: { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) } };
  try {
    reloadOrb({ view: 'chat', id: 7 }, doc, { reload: () => { reloaded = true; } });
    assert.equal(reloaded, true);
    assert.equal(takeDraft('chat-input', { view: 'chat', id: 7 }), 'hola');
  } finally { delete globalThis.window; }
  const main = read('main.jsx');
  assert.match(main, /if \(isReloadKey\(e\)\) \{ e\.preventDefault\(\); reloadOrb\(getState\(\)\.route\); \}/);
  assert.match(read('views', 'chat.jsx'), /const draft = takeDraft\(testid, getState\(\)\.route\); if \(draft && !value\.trim\(\)\) onChange\(draft\);/);
});
