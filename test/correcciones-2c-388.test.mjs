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
  assert.match(agents, /meta=\{plan \? <span>\{plan\}<\/span> : null\}/);
  for (const l of ['es', 'en']) for (const k of ['accountActive', 'accountPaused', 'accountNoLogin']) assert.match(locale(l), new RegExp(`'agents\\.${k}'`));
});

test('6: the card foot keeps the mock-up buttons; the technical ones moved to the card «⋯» and «Más opciones»', () => {
  const menu = agents.slice(agents.indexOf('data-testid={`agent-more-${a.id}`}'), agents.indexOf('{!cfg.enabled && OFF_AGENTS'));
  for (const id of ['agent-toggle-', 'agent-settings-', 'agent-scan-', 'agent-open-', 'agent-check-']) assert.ok(menu.includes('data-testid={`' + id + '${a.id}`}'), id);
  const foot = agents.slice(agents.indexOf('<CardFoot className="flex-wrap gap-2">'), agents.indexOf('</CardFoot>', agents.indexOf('<CardFoot className="flex-wrap gap-2">')));
  for (const id of ['agent-add-account-', 'agent-signout-']) assert.ok(foot.includes('data-testid={`' + id + '${a.id}`}'), id);
  for (const gone of ['agent-scan-', 'agent-open-', 'agents.check']) assert.ok(!foot.includes(gone), `${gone} left the foot`);
  assert.ok(!agents.includes('<CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />{t(\'agents.modelsSettings\')}'));
  // a turned-off agent keeps «Activar» in view
  assert.match(agents, /data-testid=\{`agent-enable-\$\{a\.id\}`\}/);
  const tail = agents.slice(agents.indexOf('<MoreOptions testid="agents-more-options">'));
  assert.ok(tail.includes('agents.projectSettingsTitle') && tail.includes('<CommitStyleCard />'));
});

test('7: one active account says so, as the mock-up does', () => {
  assert.match(agents, /data-testid=\{`agent-one-account-\$\{a\.id\}`\}/);
  for (const l of ['es', 'en']) assert.match(locale(l), /'agents\.oneAccount'/);
});
