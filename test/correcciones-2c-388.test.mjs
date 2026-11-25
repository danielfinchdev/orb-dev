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

test('1: the period is Hoy / 7 / 30 and «Ver 90 días» is an item of the header «⋯» with the same call', () => {
  assert.match(usage, /\['1', '7', '30'\]\.map/);
  assert.match(usage, /<DropdownMenuItem onSelect=\{\(\) => setDays\('90'\)\} data-testid="usage-range-90">/);
  assert.match(usage, /testid: `usage-range-\$\{d\}`/);
  for (const l of ['es', 'en']) assert.match(locale(l), /'usage\.view90'/);
});

test('2: «Al llegar al límite» is in view after «Por agente y modelo», with the switch and the warning selector', () => {
  const start = usage.indexOf('<MoreOptions testid="usage-more-options">');
  const more = usage.slice(start, usage.indexOf('</MoreOptions>', start));
  assert.ok(!more.includes('<Limits cfg='));
  const at = usage.indexOf('<Limits cfg=');
  assert.ok(at > usage.indexOf('byAgentModel') && at < start);
  for (const id of ['usage-switch-account', 'usage-warn-at']) assert.ok(usage.includes(`data-testid="${id}"`), id);
});

test('3: the legend of «Uso por día» names the warning only when one is set', () => {
  assert.match(usage, /function DaysLegend\(\{ byDay, order, warn = 0 \}\)/);
  assert.match(usage, /\{warn > 0 \? <span[^>]*data-testid="usage-days-legend-warn"><TriangleAlert[^>]*\/>\{t\('usage\.legendWarn', \{ pct: Math\.round\(warn \* 100\) \}\)\}<\/span> : null\}/);
});

test('4: what the mock-up does not draw in Uso stays under «Más opciones»', () => {
  const start = usage.indexOf('<MoreOptions testid="usage-more-options">');
  const more = usage.slice(start, usage.indexOf('</MoreOptions>', start));
  for (const piece of ['data-testid="usage-turns"', '<LocalUsage data=', '<DaysTable days=']) assert.ok(more.includes(piece), piece);
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
  // «Más opciones» is gone from the page; the commit style stays on it until it moves to Ajustes › General › Git
  assert.ok(!agents.includes('<MoreOptions'));
  assert.ok(agents.includes('<CommitStyleCard />'));
});

test('7: one active account says so, as the mock-up does', () => {
  assert.match(agents, /data-testid=\{`agent-one-account-\$\{a\.id\}`\}/);
  for (const l of ['es', 'en']) assert.match(locale(l), /'agents\.oneAccount'/);
});
