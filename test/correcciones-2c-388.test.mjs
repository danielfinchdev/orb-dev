// Fidelity corrections, part C: «Uso» (mock-up 11) and «Agentes» (mock-up 10). Read as text, like the other UI tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const src = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');
const locale = (lang) => fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, 'agents.mjs'), 'utf8');
const usage = src('views', 'usage.jsx');
const agents = src('views', 'agents.jsx');

test('1: the period is a filter with Hoy, 7, 30, 90 days and dates of your own', () => {
  assert.match(usage, /\['1', '7', '30', '90'\]\.map/);
  assert.match(usage, /value: 'custom'/);
  assert.match(usage, /data-testid="usage-date-apply"/);
  for (const l of ['es', 'en']) assert.match(fs.readFileSync(path.join(ROOT, 'src/shared/locales', l, 'uso.mjs'), 'utf8'), /'usage\.pickDates'/);
});

test('2: «Al llegar al límite» closes «Límites», with the switch and the warning selector', () => {
  const at = usage.indexOf('<Limits cfg=');
  assert.ok(at > usage.indexOf('<LimitCard key='));
  for (const id of ['usage-switch-account', 'usage-warn-at']) assert.ok(usage.includes(`data-testid="${id}"`), id);
});

test('3: the legend of «Límites» names the warning only when one is set', () => {
  assert.match(usage, /\{warn > 0 \? <span[^>]*data-testid="usage-legend-warn"><TriangleAlert[^>]*\/>\{t\('usage\.legendWarn', \{ pct: Math\.round\(warn \* 100\) \}\)\}<\/span> : null\}/);
});

test('4: what Orb adds to the mock-up in Uso stays in its own fold at the end', () => {
  const start = usage.indexOf('<LocalUsage data=');
  assert.ok(start > usage.indexOf('data-testid="usage-top"'));
  for (const piece of ['data-testid="usage-local-toggle"', 'data-testid="usage-heat"']) assert.ok(usage.includes(piece), piece);
});

test('5: an account row says its state as Activa / En pausa / Sin sesión, with the plan only when known', () => {
  assert.match(agents, /acc\.login === 'no' \? \[t\('agents\.accountNoLogin'\), 'warning'\] : acc\.enabled === false \? \[t\('agents\.accountPaused'\), 'secondary'\] : acc\.login === 'si' \? \(agentOn \? \[t\('agents\.accountActive'\), 'success'\]/);
  assert.match(agents, /\{plan \? <span>\{plan\}<\/span> : null\}/);
  for (const l of ['es', 'en']) for (const k of ['accountActive', 'accountPaused', 'accountNoLogin']) assert.match(locale(l), new RegExp(`'agents\\.${k}'`));
});

test('6: the agent row opens into its detail; the technical actions live in the detail «⋯»', () => {
  const from = agents.indexOf('data-testid={`agent-more-${a.id}`}');
  const menu = agents.slice(from, agents.indexOf('</DropdownMenuContent>', from));
  for (const id of ['agent-toggle-', 'agent-scan-', 'agent-open-', 'agent-path-', 'agent-check-', 'agent-reinstall-']) assert.ok(menu.includes('data-testid={`' + id + '${a.id}`}'), id);
  assert.ok(agents.includes('data-testid={`agent-add-account-${a.id}`}'));
  assert.ok(!agents.includes('<CardFoot className="flex-wrap gap-2">'), 'no card inside a card');
  // «Más opciones» is gone from the page, and the commit style lives in Ajustes › General › Git
  assert.ok(!agents.includes('<MoreOptions'));
  assert.ok(!agents.includes('CommitStyleCard'));
});

test('7: one active account says so, as the mock-up does', () => {
  assert.match(agents, /data-testid=\{`agent-one-account-\$\{a\.id\}`\}/);
  for (const l of ['es', 'en']) assert.match(locale(l), /'agents\.oneAccount'/);
});
