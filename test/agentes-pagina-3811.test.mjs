// 3.8.11, Agentes page: «Tus agentes» rows, «Añadir agentes» fichas, short tags with the whole warning shown once,
// the folded «Herramientas» block and the project-scripts explanation that left the page. The UI is read as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const agents = read('src/ui/views/agents.jsx');
const tools = read('src/ui/views/agents-tools.jsx');
const settings = read('src/ui/views/settings/general.jsx');

test('header counts installed and available, with no ACP wording', () => {
  assert.match(agents, /t\('agents\.metaCounts', \{ n: mine\.length, m: available\.length \}\)/);
  assert.match(agents, /agents\?\.filter\(\(x\) => x\.installed\)/);
  for (const l of [es, en]) assert.match(l['agents.metaCounts'], /\{n\}.*\{m\}/);
  assert.doesNotMatch(es['agents.metaCounts'], /ACP/);
});

test('an installed agent is a collapsed row with logo, account and plan, what is left and a status dot', () => {
  assert.match(agents, /function AgentRow/);
  assert.match(agents, /<AgentLogo agent=\{a\.id\} label=\{a\.label\}/);
  assert.match(agents, /data-testid=\{`agent-left-\$\{a\.id\}`\}/);
  // no data, no row: the bar only exists when the agent reported its limit
  assert.match(agents, /left != null \? \(/);
  assert.match(agents, /data-testid=\{`agent-dot-\$\{a\.id\}`\}/);
  assert.match(agents, /\[active\?\.label, plan\]\.filter\(Boolean\)\.join\(' · '\)/);
  // the detail: accounts, version with «Actualizar» only for a known new one, models, spend; no card inside a card
  assert.match(agents, /<CollapsibleContent[^>]*data-testid=\{`agent-detail-\$\{a\.id\}`\}/);
  assert.match(agents, /<SpendRow a=\{a\} today=\{today\} \/>/);
});

test('the agents that are not installed are fichas with one button and the rest in the «⋯»', () => {
  assert.match(agents, /function AgentFicha/);
  assert.match(agents, /agents\?\.filter\(\(x\) => !x\.installed\)/);
  const ficha = agents.slice(agents.indexOf('function AgentFicha'), agents.indexOf('function CommitStyleCard'));
  assert.match(ficha, /agent-find-\$\{a\.id\}/);
  assert.match(ficha, /askAgentKey\(a, name, t\)/);
  assert.match(ficha, /t\('agents\.howInstall'\)/);
  assert.doesNotMatch(ficha, /agents\.notFound|agents\.disabled/, 'no status tags in «Añadir agentes»');
  for (const id of ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'opencode', 'qwen', 'hermes', 'grok', 'devin', 'droid', 'omp', 'pi', 'antigravity']) for (const l of [es, en]) assert.ok(l[`agents.blurb.${id}`], id);
});

test('warnings are a short tag with a tooltip, and the whole text is a confirmation before installing or turning on', () => {
  assert.match(agents, /id: 'noGuard', note: 'agents\.noGuardNote'/);
  assert.match(agents, /id: 'askLess', note: 'agents\.hermesNote'/);
  assert.match(agents, /id: 'beta', note: 'agents\.unverifiedNote'/);
  assert.match(agents, /<BubbleTip title=\{t\(`agents\.tag\.\$\{w\.id\}`\)\} text=\{t\(`agents\.tagTip\.\$\{w\.id\}`\)\}>/);
  assert.match(agents, /acceptWarnings\(a, t\('agents\.enable'\), 'agents\.enableOf'\)/);
  assert.match(agents, /const ready = async \(ok\) => acceptWarnings\(a, ok\)/);
  // an agent Orb installs is turned on only when its install ends well
  assert.match(agents, /enableAfterInstall\.add\(a\.id\)/);
  assert.match(agents, /\.state === 'hecho'\) save\(id, \{ enabled: true \}\)/);
  assert.match(agents, /data-testid=\{`agent-enable-\$\{a\.id\}`\}/, 'a visible «Activar» in the detail of a turned-off agent');
  for (const k of ['beta', 'noGuard', 'askLess']) for (const l of [es, en]) assert.ok(l[`agents.tag.${k}`] && l[`agents.tagTip.${k}`], k);
  assert.doesNotMatch(agents, /agent-noguard-|agent-unverified-|agent-hermes-note/, 'the paragraphs are not on the cards any more');
});

test('no agent gets the generic robot head on this page: a logo or an initial in its brand colour', () => {
  const icon = read('src/ui/components/agent-icon.jsx');
  assert.match(icon, /export function AgentLogo/);
  assert.match(icon, /charAt\(0\)\.toUpperCase\(\)/);
  const css = read('src/ui/themes/pieces.css');
  for (const id of ['grok', 'devin', 'droid', 'omp', 'pi', 'antigravity']) assert.match(css, new RegExp(`data-agent="${id}"`), id);
});

test('«Herramientas» folds into one line and opens by itself when something is missing or has an update', () => {
  assert.match(tools, /const attention = missing\.length > 0 \|\| updates\.length > 0/);
  assert.match(tools, /const open = userOpen \?\? attention/);
  assert.match(tools, /data-testid="agents-tools-toggle"/);
  // the groups of the mock-up; a group without tools is not drawn, and the new tools are not installed here
  assert.match(tools, /const GROUPS = \['need', 'rec', 'mobile', 'lang'\]/);
  assert.match(tools, /if \(!list\.length\) return null/);
  assert.match(tools, /folded, setFolded\] = useState\(\{ lang: true \}\)/);
  assert.match(tools, /lacking && 'bg-warning\/10'/, 'what is missing is marked');
  for (const k of ['allReady', 'lacksOne', 'lacksMany', 'needed', 'optional', 'foot', 'group.need', 'group.rec', 'group.mobile', 'group.lang']) for (const l of [es, en]) assert.ok(l[`agents.tools.${k}`], k);
  for (const id of ['git', 'node', 'claude', 'codex', 'cursor', 'gh', 'tailscale', 'java', 'androidSdk', 'flutter']) for (const l of [es, en]) assert.ok(l[`agents.tool.${id}`], id);
});

test('«Más opciones» left the page: hooks explanation in Ajustes › Permisos, commit style kept', () => {
  assert.doesNotMatch(agents, /MoreOptions|projectSettings/);
  assert.match(agents, /<CommitStyleCard \/>/);
  assert.match(settings, /export function ProjectScriptsCard/);
  assert.match(read('src/ui/views/settings/index.jsx'), /<ProtectedCard c=\{c\} \/><ProjectScriptsCard \/>/);
  for (const l of [es, en]) assert.ok(l['settings.scripts.title'] && l['settings.scripts.whyBody']);
});

test('the row keeps no interactive element inside its button, and the limits show with one account', () => {
  const row = agents.slice(agents.indexOf('<CollapsibleTrigger className="hover:bg-accent/40'), agents.indexOf('</CollapsibleTrigger>', agents.indexOf('function AgentRow')));
  assert.doesNotMatch(row, /<BubbleTip|<AgentTag|agent-dot-/, 'tag and dot are siblings of the button');
  assert.match(agents, /\{a\.accounts\.length < 2 \? limits\.map\(/);
  assert.match(agents, /Math\.max\(\.\.\.limits\.map\(\(l\) => l\.pct\)\)/, 'the row bar is the tightest limit');
  assert.match(agents, /agent-limit-\$\{a\.id\}-\$\{l\.kind\}/);
});

test('an update of an agent Orb cannot install shows the command, not a button; one listener per install event', () => {
  assert.match(tools, /const AGENT_UPDATE = \['claude', 'codex'\]/);
  assert.match(tools, /agents\.howUpdate/);
  assert.equal((agents.match(/bridge\.on\('agents:install'/g) ?? []).length, 2, 'the button follows its state, the page notifies');
  assert.doesNotMatch(agents, /agents\.kind|const NATIVE/);
});
