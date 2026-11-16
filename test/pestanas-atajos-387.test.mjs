// Chat tabs, split view and configurable shortcuts: the logic, with no window (src/shared/tabs.mjs, keybindings.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/shared/tabs.mjs';
import * as K from '../src/shared/keybindings.mjs';

const ev = (o) => ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
const open = (...keys) => keys.reduce((s, k) => T.openTab(s, k, { mode: 'new' }), T.emptyTabs());

test('tabs: opening a chat in the list replaces the chat on screen, Ctrl+click adds a tab', () => {
  let s = T.openTab(T.emptyTabs(), 'chat:1');
  assert.deepEqual([s.tabs, s.active], [['chat:1'], 'chat:1']);
  s = T.openTab(s, 'chat:2'); // replace
  assert.deepEqual([s.tabs, s.active], [['chat:2'], 'chat:2']);
  s = T.openTab(s, 'chat:3', { mode: 'new' });
  assert.deepEqual([s.tabs, s.active], [['chat:2', 'chat:3'], 'chat:3']);
  s = T.openTab(s, 'chat:2'); // already open: it is only shown
  assert.deepEqual([s.tabs, s.active], [['chat:2', 'chat:3'], 'chat:2']);
});

test('tabs: a new chat takes the place of «chat:new» once it has an id', () => {
  let s = T.openTab(open('chat:1'), 'chat:new', { mode: 'new' });
  assert.equal(s.active, 'chat:new');
  s = T.openTab(s, 'chat:9');
  assert.deepEqual(s.tabs, ['chat:1', 'chat:9']);
  assert.equal(s.active, 'chat:9');
});

test('tabs: the limit is 8 and the oldest tab nobody looks at makes room', () => {
  let s = open('chat:1', 'chat:2', 'chat:3', 'chat:4', 'chat:5', 'chat:6', 'chat:7', 'chat:8');
  assert.equal(s.tabs.length, T.MAX_TABS);
  s = T.openTab(s, 'chat:9', { mode: 'new' });
  assert.equal(s.tabs.length, T.MAX_TABS);
  assert.ok(!s.tabs.includes('chat:1') && s.tabs.includes('chat:9') && s.active === 'chat:9');
});

test('tabs: closing the active one shows its neighbour; closing the last leaves the empty state', () => {
  let s = T.activate(open('chat:1', 'chat:2', 'chat:3'), 'chat:2');
  s = T.closeTab(s, 'chat:2');
  assert.deepEqual([s.tabs, s.active], [['chat:1', 'chat:3'], 'chat:3']);
  s = T.closeTab(T.closeTab(s, 'chat:3'), 'chat:1');
  assert.deepEqual([s.tabs, s.active, s.split], [[], null, false]);
  assert.equal(T.closeTab(s, 'chat:5'), s);
});

test('tabs: cycling wraps around and moving a tab keeps the active chat', () => {
  let s = T.activate(open('chat:1', 'chat:2', 'chat:3'), 'chat:3');
  assert.equal(T.cycle(s, 1).active, 'chat:1');
  assert.equal(T.cycle(T.activate(s, 'chat:1'), -1).active, 'chat:3');
  s = T.moveTab(s, 'chat:3', 0);
  assert.deepEqual([s.tabs, s.active], [['chat:3', 'chat:1', 'chat:2'], 'chat:3']);
});

test('split: needs two tabs, shows two different chats and the focus decides which pane a tab goes to', () => {
  let s = open('chat:1');
  assert.equal(T.toggleSplit(s).split, false); // nothing to put beside
  s = T.activate(open('chat:1', 'chat:2', 'chat:3'), 'chat:1');
  s = T.toggleSplit(s);
  assert.deepEqual(T.panes(s), { left: 'chat:1', right: 'chat:2' });
  assert.equal(s.focus, 'right');
  s = T.activate(s, 'chat:3'); // goes to the right pane
  assert.deepEqual(T.panes(s), { left: 'chat:1', right: 'chat:3' });
  s = T.activate(s, 'chat:1'); // already on the left: the two swap
  assert.deepEqual(T.panes(s), { left: 'chat:3', right: 'chat:1' });
  s = T.focusOther(s);
  s = T.activate(s, 'chat:2');
  assert.deepEqual(T.panes(s), { left: 'chat:2', right: 'chat:1' });
  assert.equal(T.toggleSplit(s).split, false);
});

test('split: closing one of the two panes keeps the other and drops the split when one chat is left', () => {
  let s = T.toggleSplit(T.activate(open('chat:1', 'chat:2', 'chat:3'), 'chat:1'));
  s = T.closeTab(s, 'chat:1');
  assert.ok(s.split);
  assert.deepEqual(T.panes(s), { left: 'chat:2', right: 'chat:3' });
  s = T.closeTab(s, 'chat:3');
  assert.deepEqual([s.split, s.active, s.right], [false, 'chat:2', null]);
});

test('split: the divider stays between 30 and 70 %', () => {
  const s = T.emptyTabs();
  assert.equal(T.setRatio(s, 5).ratio, T.MIN_RATIO);
  assert.equal(T.setRatio(s, 99).ratio, T.MAX_RATIO);
  assert.equal(T.setRatio(s, 'x').ratio, 50);
});

test('persistence: what was saved comes back, minus deleted chats, repeats, junk and the unwritten new chat', () => {
  let s = T.toggleSplit(T.activate(open('chat:1', 'session:abc', 'chat:3'), 'chat:1'));
  s = T.setRatio(s, 40);
  const back = T.sanitize(JSON.parse(JSON.stringify(T.toSave(s))));
  assert.deepEqual(back, s);
  const gone = T.sanitize(s, { exists: (k) => k !== 'session:abc' });
  assert.deepEqual(gone.tabs, ['chat:1', 'chat:3']);
  assert.deepEqual(T.panes(gone), { left: 'chat:1', right: 'chat:3' });
  const junk = T.sanitize({ tabs: ['chat:1', 'chat:1', '../x', 5, 'chat:new'], active: 'zzz', split: true, right: 'chat:1' });
  assert.deepEqual([junk.tabs, junk.active, junk.split, junk.right], [['chat:1'], 'chat:1', false, null]);
  assert.deepEqual(T.sanitize('nope'), T.emptyTabs());
  assert.deepEqual(T.sanitize({ tabs: ['chat:new'], active: 'chat:new' }).tabs, []);
});

test('routes: a tab key and its route go both ways', () => {
  assert.equal(T.keyOfRoute({ view: 'chat', id: 12 }), 'chat:12');
  assert.equal(T.keyOfRoute({ view: 'chat' }), 'chat:new');
  assert.equal(T.keyOfRoute({ view: 'session', id: 'abc' }), 'session:abc');
  assert.equal(T.keyOfRoute({ view: 'tasks', id: 3 }), null);
  assert.deepEqual(T.routeOfKey('chat:12'), { view: 'chat', id: 12 });
  assert.deepEqual(T.routeOfKey('session:abc'), { view: 'session', id: 'abc' });
  assert.deepEqual(T.routeOfKey('chat:new'), { view: 'chat' });
  assert.equal(T.routeOfKey('x'), null);
});

test('shortcuts: combos are written one way whatever the user typed', () => {
  assert.equal(K.normalizeCombo('ctrl + alt + a'), 'Ctrl+Alt+A');
  assert.equal(K.normalizeCombo('Cmd+shift+k'), 'Ctrl+Shift+K');
  assert.equal(K.normalizeCombo('Ctrl+\\'), 'Ctrl+\\');
  assert.equal(K.normalizeCombo('Ctrl++'), 'Ctrl++');
  assert.equal(K.normalizeCombo('ctrl+pgdn'), 'Ctrl+PageDown');
  assert.equal(K.normalizeCombo('F5'), 'F5');
  for (const bad of ['A', 'Space', 'Left', '5', 'Ctrl', 'Ctrl+A+B', '', null, 'Ctrl+Nope']) assert.equal(K.normalizeCombo(bad), null, String(bad));
});

test('shortcuts: a key press becomes a combo; modifiers alone and AltGr do not', () => {
  assert.equal(K.comboFromEvent(ev({ key: 'a', code: 'KeyA', ctrlKey: true, altKey: true })), 'Ctrl+Alt+A');
  assert.equal(K.comboFromEvent(ev({ key: 'k', code: 'KeyK', metaKey: true })), 'Ctrl+K');
  assert.equal(K.comboFromEvent(ev({ key: 'F5', code: 'F5' })), 'F5');
  assert.equal(K.comboFromEvent(ev({ key: '|', code: 'Backslash', ctrlKey: true })), 'Ctrl+\\');
  assert.equal(K.comboFromEvent(ev({ key: 'PageDown', code: 'PageDown', ctrlKey: true })), 'Ctrl+PageDown');
  assert.equal(K.comboFromEvent(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), null);
  assert.equal(K.comboFromEvent(ev({ key: 'á', code: 'KeyA', ctrlKey: true, altKey: true })), null); // AltGr types a character
});

test('shortcuts: with no file the defaults hold, and Ctrl+Alt+A (the tray) is among them', () => {
  const { table, problems } = K.resolve([]);
  assert.deepEqual(problems, []);
  assert.equal(table.get('inbox.nextNeeds').key, 'Ctrl+Alt+A');
  assert.equal(table.get('palette.open').key, 'Ctrl+K');
  assert.equal(K.matchCommand(table, ev({ key: 'a', code: 'KeyA', ctrlKey: true, altKey: true }), { view: 'tasks' }), 'inbox.nextNeeds');
  assert.equal(K.matchCommand(table, ev({ key: 'F5', code: 'F5' }), { view: 'chat' }), 'app.reload');
});

test('shortcuts: «when» keeps chat-only keys out of the other screens', () => {
  const { table } = K.resolve([]);
  const press = ev({ key: 'd', code: 'KeyD', ctrlKey: true });
  assert.equal(K.matchCommand(table, press, { view: 'session' }), 'changes.toggle');
  assert.equal(K.matchCommand(table, press, { view: 'projects' }), null);
});

test('shortcuts: a user rule moves a command and frees its old key', () => {
  const { table, problems } = K.resolve([{ command: 'inbox.nextNeeds', key: 'ctrl+shift+n' }]);
  assert.deepEqual(problems, []);
  assert.equal(table.get('inbox.nextNeeds').key, 'Ctrl+Shift+N');
  assert.equal(K.matchCommand(table, ev({ key: 'a', code: 'KeyA', ctrlKey: true, altKey: true }), { view: 'chat' }), null);
  assert.equal(K.matchCommand(table, ev({ key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true }), { view: 'chat' }), 'inbox.nextNeeds');
});

test('shortcuts: the editing editing combos cannot be taken', () => {
  const { problems } = K.resolve([['tabs.new', 'Ctrl+C'], ['tabs.close', 'Ctrl+V'], ['tabs.next', 'Ctrl+X'], ['tabs.prev', 'Ctrl+A'], ['tabs.split', 'Ctrl+Z'], ['changes.toggle', 'Ctrl+Y']].map(([command, key]) => ({ command, key })));
  assert.equal(problems.length, 6); assert.ok(problems.every((p) => p.reason === 'system'));
});

test('shortcuts: clashes are refused and say with whom; reserved keys cannot be taken or rebound', () => {
  const { table, problems } = K.resolve([
    { command: 'tabs.new', key: 'Ctrl+K' }, // palette (reserved)
    { command: 'tabs.close', key: 'Ctrl+D' }, // changes.toggle, same context (chat)
    { command: 'tabs.next', key: 'F11' }, // the window's
    { command: 'palette.open', key: 'Ctrl+P' }, // reserved commands do not move
    { command: 'nope', key: 'Ctrl+P' },
    { command: 'tabs.prev', key: 'Q' } // a bare letter
  ]);
  const why = Object.fromEntries(problems.map((p) => [p.command, p.reason]));
  assert.deepEqual(why, { 'tabs.new': 'reserved', 'tabs.close': 'conflict', 'tabs.next': 'system', 'palette.open': 'reserved', nope: 'unknown', 'tabs.prev': 'key' });
  assert.equal(problems.find((p) => p.command === 'tabs.close').with, 'changes.toggle');
  assert.equal(table.get('tabs.new').key, 'Ctrl+T'); // the default stays
  assert.equal(table.get('palette.open').key, 'Ctrl+K');
});

test('shortcuts: two commands may share a key only when they work in different places', () => {
  const rules = [{ command: 'inbox.nextNeeds', key: 'Ctrl+Shift+Y', when: 'always' }, { command: 'changes.toggle', key: 'Ctrl+Shift+Y' }];
  const { problems } = K.resolve(rules);
  assert.equal(problems.length, 1); // 'always' overlaps 'chat'
  assert.equal(K.conflictOf(K.resolve([]).table, 'tabs.close', 'Ctrl+Alt+A', 'chat').with, 'inbox.nextNeeds');
  assert.equal(K.conflictOf(K.resolve([]).table, 'tabs.close', 'Ctrl+W', 'chat'), null); // its own key is not a clash
});

test('shortcuts: unbinding, the file format and a broken file', () => {
  const { table } = K.resolve([{ command: 'tabs.split', key: null }]);
  assert.equal(table.get('tabs.split').key, null);
  assert.equal(K.matchCommand(table, ev({ key: '\\', code: 'Backslash', ctrlKey: true }), { view: 'chat' }), null);
  assert.deepEqual(K.parseFile('').rules, []);
  assert.equal(K.parseFile('{nope').problems[0].reason, 'json');
  assert.equal(K.parseFile('"x"').problems[0].reason, 'json');
  const text = K.serialize([{ command: 'tabs.new', key: 'ctrl+alt+n', when: 'always' }, { command: 'tabs.close', key: 'Ctrl+Q', when: 'chat' }]);
  assert.deepEqual(K.parseFile(text).rules, [{ key: 'ctrl+alt+n', command: 'tabs.new' }, { key: 'Ctrl+Q', command: 'tabs.close', when: 'chat' }]);
  assert.deepEqual(K.parseFile(JSON.stringify({ bindings: [{ key: 'F2', command: 'x' }] })).rules.length, 1);
});

test('shortcuts: the screen writes only what differs from the defaults', () => {
  let rules = K.withBinding([], 'tabs.new', 'ctrl+alt+n');
  assert.deepEqual(rules, [{ key: 'Ctrl+Alt+N', command: 'tabs.new' }]);
  rules = K.withBinding(rules, 'tabs.new', 'Ctrl+T'); // back to the default: the rule goes
  assert.deepEqual(rules, []);
  assert.deepEqual(K.withBinding([], 'palette.open', 'Ctrl+P'), []);
  assert.deepEqual(K.withBinding([], 'tabs.split', null), [{ key: null, command: 'tabs.split' }]);
  assert.deepEqual(K.withoutBinding([{ command: 'tabs.new', key: 'Ctrl+Alt+N' }], 'tabs.new'), []);
});

// ---- the engine: core/keybindings.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useHome, ctx } from '../src/platform/context.mjs';
import { keysMethods } from '../src/engine/api/keys.mjs';

test('keys.get / keys.save: the file lives in core, clashes are not saved, and an empty list removes the file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-keys-'));
  try {
    useHome(home);
    fs.mkdirSync(ctx.paths.core, { recursive: true });
    const events = [];
    const api = keysMethods({ emit: (e, p) => events.push([e, p]) });
    assert.deepEqual(api['keys.get'](), { rules: [], problems: [] });
    const ok = api['keys.save']({ rules: [{ command: 'tabs.new', key: 'ctrl+alt+n' }] });
    assert.equal(ok.saved, true);
    const file = path.join(ctx.paths.core, 'keybindings.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [{ key: 'Ctrl+Alt+N', command: 'tabs.new' }]);
    assert.deepEqual(api['keys.get']().rules, [{ key: 'ctrl+alt+n'.replace(/^.*$/, 'Ctrl+Alt+N'), command: 'tabs.new' }]);
    assert.equal(events.at(-1)[0], 'keys:changed');
    const bad = api['keys.save']({ rules: [{ command: 'tabs.close', key: 'Ctrl+K' }] });
    assert.equal(bad.saved, false);
    assert.equal(bad.problems[0].reason, 'reserved');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].command, 'tabs.new'); // untouched
    assert.throws(() => api['keys.save']({ rules: [{ command: 'rm -rf', key: 'F2' }] }));
    assert.throws(() => api['keys.save']({ rules: 'x' }));
    assert.equal(api['keys.save']({ rules: [] }).saved, true);
    assert.equal(fs.existsSync(file), false);
    // a hand-edited file with a clash: the rule is reported, the default holds
    fs.writeFileSync(file, JSON.stringify([{ key: 'Ctrl+K', command: 'tabs.new' }]));
    assert.equal(api['keys.get']().problems[0].reason, 'reserved');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
