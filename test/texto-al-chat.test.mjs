// Step 10: text that reaches the message box: a selected text as a quote, a found file as a path, and long pastes as cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendToBox, asQuote, asPath, isLongPaste, composeMessage, countLines, LONG_PASTE_CHARS, LONG_PASTE_LINES, MAX_PASTE_CHARS } from '../src/shared/chat-compose.mjs';
import { createDraft } from '../src/ui/lib/draft.js';
import { resolve, COMMANDS } from '../src/shared/keybindings.mjs';

test('what is added goes on its own paragraph; a selection is a quote; a path is code', () => {
  assert.equal(appendToBox('', 'x'), 'x');
  assert.equal(appendToBox('hola  \n', 'x'), 'hola\n\nx');
  assert.equal(asQuote('uno\r\ndos\n\ntres'), '> uno\n> dos\n>\n> tres');
  assert.equal(asPath('src/a.js'), '`src/a.js`');
  assert.equal(asPath('src/a.js', 12), '`src/a.js:12`');
  assert.equal(asPath('a`b.js'), '`ab.js`', 'a backtick in a name cannot break out of the code span');
});

test('a paste is long by size or by lines', () => {
  assert.equal(isLongPaste('corto'), false);
  assert.equal(isLongPaste('x'.repeat(LONG_PASTE_CHARS)), true);
  assert.equal(isLongPaste('x'.repeat(LONG_PASTE_CHARS - 1)), false);
  assert.equal(isLongPaste(Array.from({ length: LONG_PASTE_LINES }, () => 'a').join('\n')), true);
  assert.equal(isLongPaste(Array.from({ length: LONG_PASTE_LINES - 1 }, () => 'a').join('\n')), false);
  assert.equal(countLines('a\r\nb\r\n'), 2);
  assert.equal(countLines(''), 0);
});

test('the message is the text plus each pasted block in a fence that its content cannot close', () => {
  assert.equal(composeMessage('mira esto', [{ text: 'a\nb\n' }]), 'mira esto\n\n```\na\nb\n```');
  assert.equal(composeMessage('', [{ text: 'solo' }]), '```\nsolo\n```');
  assert.equal(composeMessage('  hola ', []), 'hola');
  const tricky = composeMessage('t', [{ text: 'antes\n```js\ncódigo\n```\n````\n' }]);
  assert.ok(tricky.includes('`````\nantes'), 'five backticks: longer than the four inside');
  assert.ok(tricky.endsWith('\n`````'));
});

test('the draft keeps long pastes apart from the box text and sends both', () => {
  const d = createDraft();
  let calls = 0; d.subscribe(() => { calls += 1; });
  d.set('mira'); d.addBlock('x'.repeat(2000));
  assert.equal(d.get(), 'mira', 'the box text is untouched');
  assert.equal(d.blocks().length, 1);
  assert.equal(d.message(), `mira\n\n\`\`\`\n${'x'.repeat(2000)}\n\`\`\``);
  const before = d.blocks();
  d.addBlock('otro');
  assert.notEqual(d.blocks(), before, 'a new list each time (the view compares by reference)');
  d.removeBlock(d.blocks()[0].id);
  assert.equal(d.blocks().length, 1);
  d.clearBlocks(); d.clearBlocks();
  assert.deepEqual(d.blocks(), []);
  assert.equal(d.message(), 'mira');
  assert.ok(calls >= 4);
  d.addBlock('y'.repeat(MAX_PASTE_CHARS + 50));
  assert.equal(d.blocks()[0].text.length, MAX_PASTE_CHARS, 'a card holds a limited text');
});

test('the select-to-chat command is in the shortcut table without clashes', () => {
  assert.deepEqual(resolve([]).problems, []);
  assert.equal(COMMANDS.find((c) => c.id === 'chat.addSelection').key, 'Ctrl+Shift+L');
});
