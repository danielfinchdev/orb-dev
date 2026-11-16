// Step 10: a run of tool calls folds into one line («Leyó 3 archivos, ejecutó 2 comandos»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryParts, summaryText, groupTools, kindOf, bareTool } from '../src/ui/lib/tool-summary.js';
import { toBlocks } from '../src/ui/lib/session-blocks.js';
import { sameBlock } from '../src/ui/lib/memo.js';
import { translate } from '../src/shared/i18n.mjs';

const es = (k, v) => translate('es', k, v);
const en = (k, v) => translate('en', k, v);

test('tools are told apart by name, whatever the agent calls them', () => {
  assert.equal(kindOf(bareTool('mcp__orb__orb_ask')), 'ask');
  assert.equal(kindOf('Read'), 'read'); assert.equal(kindOf('Bash'), 'run'); assert.equal(kindOf('Grep'), 'search'); assert.equal(kindOf('Edit'), 'edit');
});

test('the summary counts by kind, always in the same order, in singular and plural', () => {
  const names = ['Bash', 'Read', 'Read', 'Read', 'Bash', 'Edit', 'orb_ask'];
  assert.deepEqual(summaryParts(names), [{ kind: 'read', n: 3 }, { kind: 'edit', n: 1 }, { kind: 'run', n: 2 }, { kind: 'other', n: 1 }]);
  assert.equal(summaryText(['Read', 'Read', 'Read', 'Bash', 'Bash'], es), 'Leyó 3 archivos, ejecutó 2 comandos');
  assert.equal(summaryText(['Read', 'Bash'], es), 'Leyó 1 archivo, ejecutó 1 comando');
  assert.equal(summaryText(['Read', 'Read', 'Bash'], en), 'Read 2 files, ran 1 command');
  assert.equal(summaryText([], es), '');
});

test('two or more finished calls in a row fold into one block; the one still running stays apart', () => {
  const tool = (key, done = true) => ({ type: 'tool', key, call: { name: 'Read' }, result: done ? { output: 'x' } : null });
  const item = (key) => ({ type: 'item', key, item: { id: key } });
  const out = groupTools([item(1), tool(2), tool(3), tool(4), item(5), tool(6), item(7), tool(8), tool(9), tool(10, false)]);
  assert.deepEqual(out.map((b) => b.type), ['item', 'toolgroup', 'item', 'tool', 'item', 'toolgroup', 'tool']);
  assert.deepEqual(out[1].steps.map((b) => b.key), [2, 3, 4]);
  assert.equal(out[1].key, 'group-2');
  assert.equal(out[6].key, 10, 'the running call is drawn as before');
  // a group that grows keeps its key, and the memo sees it changed
  const grown = groupTools([tool(2), tool(3), tool(4), tool(5)]);
  assert.equal(grown[0].key, 'group-2');
  assert.equal(sameBlock(out[1], grown[0]), false);
  assert.equal(sameBlock(out[1], groupTools([tool(2), tool(3), tool(4)].map((b) => ({ ...b, call: out[1].steps[0].call, result: out[1].steps[0].result })))[0]), false, 'other results are other blocks');
});

test('toBlocks groups the calls of a direct conversation', () => {
  const items = [
    { id: 1, kind: 'tool', body: { id: 'a', name: 'Read', input: '{}' } }, { id: 2, kind: 'tool_result', body: { id: 'a', output: 'ok' } },
    { id: 3, kind: 'tool', body: { id: 'b', name: 'Bash', input: '{}' } }, { id: 4, kind: 'tool_result', body: { id: 'b', output: 'ok' } },
    { id: 5, kind: 'text', role: 'assistant', body: 'hecho' }
  ];
  const blocks = toBlocks(items, (k) => k);
  assert.deepEqual(blocks.map((b) => b.type), ['toolgroup', 'item']);
  assert.equal(blocks[0].steps.length, 2);
});
