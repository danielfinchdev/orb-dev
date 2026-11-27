// 3.8.8: the pages «Agentes» and «Uso» as the mock-up 10-agentes / 11-uso draws them (read as text): the shared
// header and tabs, the team block, the agent cards, the login dialog, the marks of the brakes and the limits section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const agents = read('src', 'ui', 'views', 'agents.jsx');
const usage = read('src', 'ui', 'views', 'usage.jsx');
const tabs = read('src', 'ui', 'components', 'agents-tabs.jsx');
const tools = read('src', 'ui', 'views', 'agents-tools.jsx');
const both = [agents, tools, usage, tabs].join(' ');

test('Agentes: header with the guide, the check and a menu; tabs; sections of the mock-up', () => {
  assert.match(agents, /<PageHeader title=\{t\('agents\.title'\)\}/);
  for (const id of ['agents-guide', 'agents-check-all', 'agents-more']) assert.ok(agents.includes(`data-testid="${id}"`), id);
  assert.match(agents, /<AgentsUsageTabs current="agents" \/>/);
  assert.match(tabs, /TabsList variant="line"/);
  assert.match(tabs, /go\(view === 'usage' \? \{ view: 'usage' \} : 'agents'\)/);
  assert.ok(tools.includes("t('agents.tools.title')"), 'Herramientas');
  for (const key of ['agents.mineTitle', 'agents.addTitle']) assert.ok(agents.includes(`t('${key}')`), key);
  assert.match(agents, /min-\[1000px\]:grid-cols-3/, 'the gallery of fichas');
});

test('Agentes: the sign-in is a dialog with the same calls, and the team block installs through installer.*', () => {
  assert.match(agents, /<Dialog open=\{Boolean\(login\)\}/);
  for (const call of ["'agents.login'", "'agents.loginCode'", "'agents.loginCancel'", "'accounts.remove'", "'accounts.add'", "'accounts.scan'", "'agents.install'", "'agentKeys.save'", "'installer.start'", "'installer.check'"]) assert.ok(agents.includes(call), call);
  // removing an account, the key's master password and the scan prompt keep asking
  assert.match(agents, /confirm\(t\('agents\.removeTitle'\), t\('agents\.removeBody'.*danger: true/s);
  assert.match(agents, /unlockCore\('secrets', \{ request: \{ method: 'agentKeys\.save'/);
  // an agent the mock-up draws but Orb does not detect is not invented: the cards come from agents.status
  assert.match(agents, /call\('agents\.status'/);
});

test('Uso: tabs, period, accounts with the pause marks, cost, tokens, days, projects, models, limits', () => {
  assert.match(usage, /<AgentsUsageTabs current="usage" \/>/);
  assert.match(usage, /fullPc\(\)/);
  for (const d of ['1', '7', '30', '90']) assert.ok(usage.includes(`'${d}'`), d);
  assert.match(usage, /data-testid="usage-stop"/);
  assert.match(usage, /weeklyStopAt/);
  assert.match(usage, /budget\.stopAt|budget\?\.stopAt/);
  for (const key of ['usage.byAccount', 'usage.costByDay', 'usage.byProject', 'usage.byModel', 'usage.atLimit', 'usage.topTitle', 'usage.groupBy']) assert.ok(usage.includes(`t('${key}'`), key);
  // the limits are saved the way Ajustes saves them (the master password for a rail value is asked in `save`)
  assert.match(usage, /save\(\{ budget: \{ profile: null, stopAt: Number\(v\) \/ 100 \} \}\)/);
  assert.match(usage, /save\(\{ budget: \{ weeklyStopAt: Number\(v\) \/ 100 \} \}\)/);
  assert.match(usage, /save\(\{ continuity: \{ resumeAtReset \} \}\)/);
  // the pause of an account is still lifted from here (it used to be on the agents page)
  assert.match(usage, /accounts\.clearCooldown/);
});

test('every test id of the two pages in HEAD is still there', () => {
  for (const file of ['src/ui/views/agents.jsx', 'src/ui/views/usage.jsx']) {
    let before = '';
    try { before = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 }); } catch { continue; }
    // ids that are only computed in the old file (the ones written as a template) are matched by their literal prefix
    const ids = [...before.matchAll(/data-testid=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map((m) => m[1] ?? m[2].replace(/\$\{[^}]*\}.*$/, ''));
    // gone on purpose: the update badge became a hint, the settings fold and its «Activar» button went into the detail and the
    // «⋯», «Mensajes de commit» moved to Ajustes › General › Git, the long notes became tags, the foot's sign-out lives in each account's «⋯» and the tool rows have their own ids
    const gone = ['agent-uptodate-', 'agent-settings-', 'agent-enable-', 'agent-hermes-note', 'agent-unverified-', 'agent-noguard-', 'agent-signout-', 'team-dev-', 'usage-days', 'usage-days-legend', 'usage-days-legend-warn', 'usage-range-90', 'usage-turns', 'commit-style'];
    for (const id of new Set(ids)) if (!gone.includes(id) && !gone.some((g) => id.startsWith(g))) assert.ok(both.includes(id), `${file}: ${id}`);
  }
});

test('the pages keep the unified look: the accent is a token', () => {
  for (const [name, src] of [['agents', agents], ['usage', usage]]) {
    assert.doesNotMatch(src, /\btext-primary\b(?!-)/, `${name}: accent is -primary-text`);
  }
});

test('9C-a Uso: Today and 90 days in the period, CSV export of what is filtered, cost card, closing details', () => {
  for (const d of ['1', '7', '30', '90']) assert.ok(usage.includes(`'${d}'`), d);
  assert.match(usage, /data-testid="usage-period"/);
  assert.match(usage, /data-testid="usage-export-csv"/);
  assert.match(usage, /data-testid="usage-export-icon"/);
  assert.match(usage, /toCsv\(cur, /, 'the CSV is what the filters leave');
  assert.match(usage, /usage\.records/);
  assert.ok(usage.indexOf('<LocalUsage') > usage.indexOf('data-testid="usage-top"'), 'the use outside Orb closes the page');
  // the stop of the queue is the rail of «Normas»: same call, same password
  assert.match(usage, /changeRail\('freno-uso', \{ enabled \}/);
  assert.match(usage, /data-testid="usage-stop-queue"/);
});

test('9C-a Uso and engine: «Hoy» is one day of the same history, the team check gives the tool versions', () => {
  assert.match(read('src', 'engine', 'api', 'index.mjs'), /oneOf\(days, \[1, 7, 30, 90\]/);
  assert.match(read('src', 'engine', 'api', 'history.mjs'), /oneOf\(days, \[1, 7, 30, 90\]/);
  assert.match(read('src', 'engine', 'host', 'installer.mjs'), /version: versions\[i\.id\] \?\? null/);
  assert.match(tools, /i\.version\?\.match/);
});

test('Agentes y Uso: the tabs have the tab style of the rest of Orb, not an underlined link', () => {
  assert.doesNotMatch(tabs, /underline/);
  assert.match(tabs, /<TabsList variant="line"/);
});

test('10C-b Uso: the breakdown cards filter, the limit cards follow the mock-up', () => {
  assert.match(usage, /<BreakdownCard key=\{by\}/);
  assert.match(usage, /data-testid=\{`usage-by-\$\{by\}`\}/);
  assert.doesNotMatch(usage, /max-h-\[30rem\]/, 'no box with its own scroll for the days');
  assert.match(usage, /<AgentIcon agent=\{u\.agent\} \/>/, 'the mark of the account card is 12 px');
  assert.doesNotMatch(usage, /<AgentIcon [^>]*size-4/, 'no 16 px marks in the cards and tables');
  assert.match(usage, /data-testid="usage-account"/);
  assert.match(usage, /data-testid="usage-pace"/); assert.match(usage, /data-testid="usage-stop"/);
  assert.match(usage, /title=\{paceText \|\| undefined\}/, 'the pace sentence stays, as the bar\'s tooltip');
  for (const l of ['es', 'en']) { const s = read('src', 'shared', 'locales', l, 'agents.mjs'); assert.match(s, /'usage\.renewsAt'/); assert.match(s, /'usage\.renewsOn'/); }
});

test('Agentes: no ACP jargon on the page', () => {
  assert.doesNotMatch(agents, /<Badge variant="info">ACP<\/Badge>/);
  assert.doesNotMatch(agents, /agents\.notFound|agents\.missing/);
});
