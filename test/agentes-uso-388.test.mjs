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
const both = `${agents}\n${usage}\n${tabs}`;

test('Agentes: header with the guide, the check and a menu; tabs; sections of the mock-up', () => {
  assert.match(agents, /<PageHeader title=\{t\('agents\.title'\)\}/);
  for (const id of ['agents-guide', 'agents-check-all', 'agents-more']) assert.ok(agents.includes(`data-testid="${id}"`), id);
  assert.match(agents, /<AgentsUsageTabs current="agents" \/>/);
  assert.match(tabs, /TabsList variant="line"/);
  assert.match(tabs, /go\(view === 'usage' \? \{ view: 'usage' \} : 'agents'\)/);
  for (const key of ['agents.team.title', 'agents.nativeTitle', 'agents.moreTitle']) assert.ok(agents.includes(`t('${key}')`), key);
  assert.match(agents, /className="grid items-start gap-4 min-\[900px\]:grid-cols-2/, 'two independent columns');
});

test('Agentes: the sign-in is a dialog with the same calls, and the team block installs through installer.*', () => {
  assert.match(agents, /<Dialog open=\{Boolean\(login\)\}/);
  for (const call of ["'agents.login'", "'agents.loginCode'", "'agents.loginCancel'", "'accounts.remove'", "'accounts.add'", "'accounts.scan'", "'agents.install'", "'agentKeys.save'", "'installer.start'", "'installer.check'"]) assert.ok(agents.includes(call), call);
  // removing an account, the key's master password and the scan prompt keep asking
  assert.match(agents, /confirm\(t\('agents\.removeTitle'\), t\('agents\.removeBody'.*danger: true/s);
  assert.match(agents, /unlockCore\('secrets'\)/);
  // an agent the mock-up draws but Orb does not detect is not invented: the cards come from agents.status
  assert.match(agents, /call\('agents\.status'/);
});

test('Uso: tabs, period, accounts with the brake marks, cost, tokens, days, projects, agent and model, limits', () => {
  assert.match(usage, /<AgentsUsageTabs current="usage" \/>/);
  assert.match(usage, /fullPc\(\)/);
  for (const d of ['7', '30', '90']) assert.ok(usage.includes(`'${d}'`), d);
  assert.match(usage, /data-testid="usage-stop"/);
  assert.match(usage, /weeklyStopAt/);
  assert.match(usage, /budget\.stopAt|budget\?\.stopAt/);
  for (const key of ['usage.byAccount', 'usage.costEstimated', 'usage.byDay', 'usage.byProject', 'usage.byAgentModel', 'usage.atLimit']) assert.ok(usage.includes(`t('${key}'`), key);
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
    for (const id of new Set(ids)) assert.ok(both.includes(id), `${file}: ${id}`);
  }
});

test('the pages keep the unified look: the accent is a token', () => {
  for (const [name, src] of [['agents', agents], ['usage', usage]]) {
    assert.doesNotMatch(src, /\btext-primary\b(?!-)/, `${name}: accent is -primary-text`);
  }
});
