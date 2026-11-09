// 3.8.2: Claude's and Codex's subagents as one row in a direct conversation (src/agents/claude.mjs › subagentOf,
// src/agents/codex.mjs › collabAgent/collabResult, src/ui/lib/session-blocks.js). Plain tool calls are drawn as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subagentOf } from '../src/agents/claude.mjs';
import { collabAgent, collabResult } from '../src/agents/codex.mjs';
import { toBlocks, subagentState } from '../src/ui/lib/session-blocks.js';
import { sameBlock } from '../src/ui/lib/memo.js';

const t = (k) => k;
let n = 0;
const item = (kind, body, role = 'tool') => ({ id: ++n, role, kind, body, at: '2026-11-09T10:00:00Z' });

test('Claude: the Agent (or Task) tool is a subagent with its type, task and model', () => {
  assert.deepEqual(subagentOf('Agent', { subagent_type: 'Explore', description: 'Find the config', prompt: 'long', model: 'haiku' }), { agent: { name: 'Explore', description: 'Find the config', model: 'haiku' } });
  assert.equal(subagentOf('Task', { description: 'x' }).agent.name, 'general-purpose');
  assert.deepEqual(subagentOf('Bash', { command: 'ls' }), {});
});

test('Codex: spawnAgent is a subagent; its threads\' states come with the collab results', () => {
  const spawn = { type: 'collabAgentToolCall', id: 'c1', tool: 'spawnAgent', prompt: 'Review the tests', model: 'gpt-x', receiverThreadIds: ['th1'], senderThreadId: 'main', status: 'inProgress', agentsStates: {} };
  assert.deepEqual(collabAgent(spawn), { agent: { name: null, description: 'Review the tests', model: 'gpt-x', threads: ['th1'] } });
  assert.deepEqual(collabAgent({ ...spawn, tool: 'wait' }), {});
  assert.deepEqual(collabResult({ ...spawn, id: 'c2', tool: 'wait', status: 'completed', agentsStates: { th1: { status: 'completed', message: 'All good' } } }), { id: 'c2', output: 'All good', error: false, states: { th1: 'completed' } });
});

test('the blocks: a subagent holds its steps and shows its state; other tools are unchanged', () => {
  const items = [
    item('text', 'Let me look', 'assistant'),
    item('tool', { id: 'a1', name: 'Agent', input: 'Find the config', agent: { name: 'Explore', description: 'Find the config', model: null } }),
    item('tool', { id: 's1', name: 'Grep', input: 'config', sub: true, parent: 'a1' }),
    item('tool_result', { id: 's1', output: 'src/config.mjs', error: false, parent: 'a1' }),
    item('tool', { id: 'b1', name: 'Bash', input: 'ls' })
  ];
  let blocks = toBlocks(items, t);
  assert.deepEqual(blocks.map((b) => b.type), ['item', 'subagent', 'tool']);
  const sub = blocks[1];
  assert.equal(sub.steps.length, 1); assert.equal(sub.steps[0].result.output, 'src/config.mjs');
  assert.equal(subagentState(sub), 'running');
  blocks = toBlocks([...items, item('tool_result', { id: 'a1', output: 'Found it', error: false })], t);
  assert.equal(subagentState(blocks[1]), 'done'); assert.equal(blocks[2].call.name, 'Bash');
  assert.equal(subagentState({ ...blocks[1], result: { error: true } }), 'failed');
  // A step whose subagent is not in the list (an older conversation) is drawn as a plain tool.
  assert.equal(toBlocks([item('tool', { id: 'x', name: 'Read', parent: 'gone' })], t)[0].type, 'tool');
});

test('Codex subagent: its state follows its thread', () => {
  const items = [
    item('tool', { id: 'c1', name: 'Subagent: spawnAgent', input: 'Review', agent: { name: null, model: 'gpt-x', threads: ['th1'] } }),
    item('tool_result', { id: 'c1', output: '', error: false, states: { th1: 'pendingInit' } })
  ];
  assert.equal(subagentState(toBlocks(items, t)[0]), 'running');
  const later = [...items, item('tool', { id: 'c2', name: 'Subagent: wait', input: '' }), item('tool_result', { id: 'c2', output: 'Done', error: false, states: { th1: 'completed' } })];
  const blocks = toBlocks(later, t);
  assert.equal(subagentState(blocks[0]), 'done'); assert.equal(blocks[1].type, 'tool');
});

test('a subagent block is drawn again only when its steps or state change', () => {
  const items = [item('tool', { id: 'a', name: 'Agent', agent: { name: 'x' } }), item('tool', { id: 's', name: 'Read', parent: 'a' })];
  const one = toBlocks(items, t)[0]; const two = toBlocks(items, t)[0];
  assert.ok(sameBlock(one, two));
  assert.ok(!sameBlock(one, toBlocks([...items, item('tool', { id: 's2', name: 'Grep', parent: 'a' })], t)[0]));
  const tool = toBlocks([item('tool', { id: 'z', name: 'Bash' })], t)[0];
  assert.ok(sameBlock(tool, { ...tool }), 'plain blocks as before');
});
