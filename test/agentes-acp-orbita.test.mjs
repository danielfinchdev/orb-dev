// ACP agents in the UI: Hermes has a name and a mark, unknown agents get a generic mark, disabled agents are not offered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
const labels = read('lib/labels.js');
const icon = read('components/agent-icon.jsx');
const tasks = read('views/tasks.jsx');
const agents = read('views/agents.jsx');

test('AGENT.hermes exists', () => assert.match(labels, /export const AGENT = \{[^}]*hermes: 'Hermes'/));
test('AgentIcon has a mark for hermes and a generic one for unknown ids', () => {
  assert.match(icon, /PATHS\.hermes = /);
  assert.match(icon, /hermes: 'hermes'/);
  assert.match(icon, /agent !== 'any' && agent !== 'orb'\) return <Mark name="acp"/);
});
test('selectors only offer enabled agents', () => {
  assert.ok((tasks.match(/a\.enabled && a\.installed/g) ?? []).length >= 2);
});
test('Agents view shows the disabled state, an activate button for Hermes and its permission note', () => {
  assert.ok(agents.includes("t('agents.disabled')"));
  // turned on from the «⋯» or installed from its ficha, always through its warning, read whole once
  assert.ok(agents.includes('agent-toggle-${a.id}') && agents.includes("OFF_AGENTS.includes(a.id)") && agents.includes("save(id, { enabled: true })"));
  assert.ok(agents.includes("note: 'agents.hermesNote'") && agents.includes('acceptWarnings(a'));
});
