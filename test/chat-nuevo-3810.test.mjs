// 3.8.10: «New chat» opens the project picker at once (No project + the projects, Ctrl+1…9, arrows, Enter, Esc) and the left
// bar holds search + filter + «New project» + «New chat» in one row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { pickerEntries, digitIndex, moveActive } from '../src/ui/lib/chat-picker.js';
import { COMMANDS } from '../src/shared/keybindings.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the picker lists «No project» first, then the projects, and filters by name', () => {
  const projects = [{ name: 'orb' }, { name: 'web-shop' }, 'api'];
  assert.deepEqual(pickerEntries(projects, '', 'No project').map((e) => e.project), [null, 'orb', 'web-shop', 'api']);
  assert.deepEqual(pickerEntries(projects, ' WEB ', 'No project').map((e) => e.project), ['web-shop']);
  assert.deepEqual(pickerEntries(projects, 'no pro', 'No project').map((e) => e.project), [null]);
  assert.deepEqual(pickerEntries(undefined, '', 'x'), [{ project: null }]);
});

test('Ctrl+digit picks a row; other combinations do not', () => {
  assert.equal(digitIndex({ ctrlKey: true, code: 'Digit1', key: '1' }), 0);
  assert.equal(digitIndex({ metaKey: true, code: 'Numpad9', key: '9' }), 8);
  assert.equal(digitIndex({ ctrlKey: true, key: '3' }), 2);
  assert.equal(digitIndex({ ctrlKey: true, code: 'Digit0', key: '0' }), -1, 'Ctrl+0 stays the zoom reset');
  assert.equal(digitIndex({ code: 'Digit1', key: '1' }), -1, 'a bare digit is typed in the search');
  assert.equal(digitIndex({ ctrlKey: true, altKey: true, code: 'Digit1', key: '1' }), -1);
  assert.equal(digitIndex({ ctrlKey: true, shiftKey: true, code: 'Digit1', key: '1' }), -1);
});

test('the arrows wrap around and Home/End jump', () => {
  assert.equal(moveActive(0, 'ArrowUp', 3), 2);
  assert.equal(moveActive(2, 'ArrowDown', 3), 0);
  assert.equal(moveActive(1, 'Home', 3), 0);
  assert.equal(moveActive(0, 'End', 3), 2);
  assert.equal(moveActive(5, 'x', 3), 2, 'a list that shrank keeps the row in range');
  assert.equal(moveActive(1, 'ArrowDown', 0), 0);
});

test('Ctrl+1…9 clash with no shortcut of the table or the window', () => {
  for (const c of COMMANDS) assert.ok(!/^Ctrl\+[1-9]$/.test(c.key), `${c.id} uses ${c.key}`);
  // the window's own handlers (zoom, terminal, F11) never take a digit but 0
  const bridge = read('src/ui/lib/tauri-bridge.js');
  assert.ok(!/Digit[1-9]/.test(bridge));
});

test('the sidebar row has search, filter, New project and New chat; New chat opens the picker', () => {
  const inbox = read('src/ui/views/orb/inbox.jsx');
  const pc = inbox.slice(inbox.indexOf('const pcSearch'), inbox.indexOf('const search = phone'));
  assert.match(pc, /<FilterMenu inline[\s\S]*<OrbNewButtons \/>/);
  const buttons = inbox.slice(inbox.indexOf('function OrbNewButtons'), inbox.indexOf('function OrbNewMenu'));
  assert.match(buttons, /onClick=\{newProjectChat\}/);
  assert.match(buttons, /onClick=\{startChatFlow\}/);
  assert.match(buttons, /label=\{t\('nav\.newChat'\)\}/);
  assert.match(read('src/ui/components/project-actions.jsx'), /export async function startChatFlow\(\) \{\n  const r = await pickProject\(\);\n  if \(r\) await newChat\(r\.project\);/);
  assert.match(read('src/ui/components/command-palette.jsx'), /run: startChatFlow/);
  const picker = read('src/ui/components/new-chat-picker.jsx');
  for (const k of ['ArrowDown', 'Enter', 'digitIndex']) assert.ok(picker.includes(k), k);
});

test('the texts exist in Spanish and English', () => {
  for (const k of ['newchat.project', 'newchat.hint', 'newchat.pickHint', 'newchat.search']) {
    assert.ok(es[k] && en[k] && es[k] !== en[k], k);
  }
});

test('Enter picks the highlighted row and Esc is left to the dialog', () => {
  const picker = read('src/ui/components/new-chat-picker.jsx');
  // Enter: the highlighted row (clamped to the filtered list) is chosen, and a composing IME keeps its own Enter.
  assert.match(picker, /e\.key === 'Enter' && !e\.nativeEvent\.isComposing\) \{ e\.preventDefault\(\); pick\(Math\.min\(active, entries\.length - 1\)\); \}/);
  // Esc is not swallowed by the picker: the dialog host closes it and resolves null, so no chat is created.
  assert.ok(!/Escape/.test(picker));
  const host = read('src/ui/components/dialogs.jsx');
  assert.match(host, /onOpenChange=\{\(o\) => \{ if \(!o\) close\(d\.id, null\); \}\}/);
  assert.match(read('src/ui/components/project-actions.jsx'), /if \(r\) await newChat\(r\.project\)/);
});
