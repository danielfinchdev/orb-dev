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
