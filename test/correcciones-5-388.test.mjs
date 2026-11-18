// Fifth round of fidelity fixes (interface and the live window): one check per point of the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const locale = (lang, file) => fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, file), 'utf8');

test('1: the chat bar title block cannot outgrow its column (it is cut with «…» on the right)', () => {
  const chat = read('src/ui/views/chat.jsx');
  assert.match(chat, /'press flex max-w-full min-w-0 items-center gap-2\.5/);
});

test('2: God mode: branch chip with arrow and marked current branch, editor label, Ramas before Historial, agent pill', () => {
  const git = read('src/ui/components/expert-git.jsx');
  const menu = git.slice(git.indexOf('export function BranchMenu'));
  assert.match(menu, /<span className="truncate">\{st\.branch\}<\/span><ChevronDown/);
  assert.match(menu, /aria-current=\{b\.current \? 'true' : undefined\}/);
  assert.doesNotMatch(menu, /disabled=\{b\.current\}/);
  assert.match(menu, /<Check className=/);
  const panel = git.slice(git.indexOf('export function GitPanel'), git.indexOf('export function BranchMenu'));
  assert.ok(panel.indexOf('<Branches ') < panel.indexOf('<RecentHistory '));
  const x = read('src/ui/views/expert.jsx');
  assert.match(x, /<OpenInMenu project=\{info\} labelClassName="hidden @5xl\/bar:inline" \/>/);
  const pill = x.slice(x.indexOf('data-testid="expert-agent-pill"') - 400, x.indexOf('data-testid="expert-agent-pill"') + 700);
  assert.match(pill, /go\(\{ view: 'tasks', id: newest.id \}\)/);
  assert.match(x, /runningHere\.length \? \(/);
  assert.match(locale('es', 'expert.mjs'), /'expert\.workingOnMore': '\{agent\} trabajando en #\{id\} y \{n\} más'/);
  assert.match(locale('en', 'expert.mjs'), /'expert\.workingOnMore': '\{agent\} working on #\{id\} and \{n\} more'/);
});

test('3: the model guide moved under the one «Más opciones» of the tasks tab', () => {
  const g = read('src/ui/views/settings/general.jsx');
  const card = g.slice(g.indexOf('export function TasksCard'), g.indexOf('const SPEND_LEVEL'));
  assert.equal(card.split('<MoreOptions').length - 1, 1);
  assert.equal(card.split('<ModelGuide').length - 1, 1);
  assert.ok(card.indexOf('<ModelGuide') > card.indexOf('testid="spend-more"'));
  assert.match(card, /triggerTestid="spend-advanced"/);
  assert.match(card, /data-testid="settings-suggest"/);
});

test('4: the Skills and MCP section is titled «Skills y servidores MCP» and the pending block only shows with something pending', () => {
  assert.match(read('src/ui/views/settings/index.jsx'), /section\.id === 'extensiones' \? t\('ext\.title'\)/);
  assert.match(locale('es', 'ext.mjs'), /'ext\.title': 'Skills y servidores MCP'/);
  assert.match(locale('en', 'ext.mjs'), /'ext\.title': 'Skills and MCP servers'/);
  assert.match(read('src/ui/views/extensions.jsx'), /data\.pending\.length \? <PendingCard/);
});

test('5: About: the message box is 74 px and the version row has no icon', () => {
  const about = read('src/ui/views/settings/about.jsx');
  assert.match(about, /field-sizing-fixed h-\[74px\] min-h-\[74px\]/);
  assert.doesNotMatch(about, /about-icon/);
});

test('7: the live window asks Windows for round corners and uses the neutral dark background', () => {
  const rs = read('src-tauri/src/pip.rs');
  assert.match(rs, /DwmSetWindowAttribute/);
  assert.match(rs, /DWMWCP_ROUND/);
  assert.match(rs, /round_corners\(&window\);/);
  assert.match(rs, /Color\(14, 14, 14, 255\)/);
  assert.doesNotMatch(rs, /transparent\(true\)/);
  assert.match(read('src-tauri/Cargo.toml'), /"Win32_Graphics_Dwm"/);
});
