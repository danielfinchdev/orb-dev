// Rule: an Orb function the approved mock-up does not draw is kept, always in the same place: in a view or a row, inside
// its «⋯» menu; in Ajustes and in dialogs, under «Más opciones» at the end of the section. Read as text, like the other UI tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { COMMANDS } from '../src/shared/keybindings.mjs';

const src = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');
const locale = (lang, file) => fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, `${file}.mjs`), 'utf8');

test('a: the magnifier is not in any header, Ctrl+K is still registered and named in the sidebar search', () => {
  assert.ok(!src('components', 'page.jsx').includes('open-palette'));
  assert.ok(!src('components', 'page.jsx').includes('PaletteButton'));
  assert.ok(COMMANDS.some((c) => c.id === 'palette.open' && c.key === 'Ctrl+K'));
  const inbox = src('views', 'orb', 'inbox.jsx');
  assert.match(inbox, /useKeys\(\)\.table\.get\('palette\.open'\)/);
  assert.match(inbox, /title=\{searchTitle\}[^>]*inputClassName="pr-8" data-testid="sidebar-search-input"/);
});

test('d: Ajustes gathers what the mock-up lacks under one «Más opciones» piece', () => {
  const rows = src('views', 'settings', 'rows.jsx');
  assert.match(rows, /export function MoreOptions\(\{ fold = false/);
  for (const l of ['es', 'en']) assert.match(locale(l, 'settings'), /'settings\.moreOptions'/);
  assert.match(locale('es', 'settings'), /'settings\.moreOptions': 'Más opciones'/);
  // General has no «Más opciones» any more: the chat tabs went to Apariencia and the shortcuts to their own section
  const index = src('views', 'settings', 'index.jsx');
  assert.doesNotMatch(index, /more-options-general/);
  // Robot y sonidos: «Música que reacciona» and «Intensidad»
  const general = src('views', 'settings', 'general.jsx');
  const more = general.slice(general.indexOf('function MusicMore'), general.indexOf('function MusicSettings'));
  // no second «Más opciones» heading: General ends with its own
  assert.ok(!general.slice(general.indexOf('function MusicMore'), general.indexOf('</>', general.indexOf('function MusicMore'))).includes('<MoreOptions'));
  assert.ok(more.includes('data-testid="more-options-music"'));
  for (const id of ['music-reactive', 'music-intensity']) assert.ok(more.includes(`data-testid="${id}"`), id);
  const main = general.slice(general.indexOf('function MusicSettings'));
  for (const id of ['music-reactive', 'music-intensity']) assert.ok(!main.includes(`data-testid="${id}"`), `${id} left the main rows`);
  // Datos: the trash and the worktree copies, not folded; backups and the core folder stay (the mock-up draws them)
  const data = src('views', 'data.jsx');
  assert.match(data, /<TrashCard \/><WorktreesCard \/><CoreCard \/>/);
  // Agentes y uso: «Opciones avanzadas» became «Más opciones», folded, same trigger testid
  assert.match(general, /<MoreOptions fold open=\{advanced\} onOpenChange=\{setAdvanced\} testid="spend-more" triggerTestid="spend-advanced">/);
  assert.ok(!/'settings\.advanced'/.test(locale('es', 'settings')));
  // a folded one hides its rows behind the title
  assert.match(rows, /<Collapsible open=\{shown\}/);
});

test('e: Bitácoras «Copiar» (and «Ver completa») are items of the page «⋯»', () => {
  const page = src('views', 'bitacoras-page.jsx');
  assert.match(page, /\{menuItems\}/);
  const logs = src('views', 'logs.jsx');
  assert.match(logs, /<DropdownMenuItem onSelect=\{copy\} data-testid="log-copy">/);
  assert.match(logs, /<DropdownMenuItem onSelect=\{\(\) => setWhole\(true\)\} data-testid="log-whole">/);
  assert.ok(!/<IconButton[^>]*log-copy/.test(logs));
  assert.match(logs, /menuItems=\{menuItems\}/);
  assert.match(src('views', 'activity.jsx'), /<DropdownMenuItem onSelect=\{copy\} data-testid="activity-copy">/);
});

test('f: an agent is turned on or off from the «⋯» of its card, with the same call', () => {
  const agents = src('views', 'agents.jsx');
  assert.match(agents, /<MoreButton small data-testid=\{`agent-more-\$\{a\.id\}`\} \/>/);
  assert.match(agents, /<DropdownMenuItem onSelect=\{turnOn\} data-testid=\{`agent-toggle-\$\{a\.id\}`\}>/);
  assert.match(agents, /save\(a\.id, \{ enabled: !cfg\.enabled \}\)/);
  assert.ok(!/<Switch checked=\{cfg\.enabled\}/.test(agents));
  // the state shows in the row's dot and its line
  assert.match(agents, /!cfg\.enabled \? t\('agents\.disabled'\)/);
  for (const l of ['es', 'en']) assert.match(locale(l, 'agents'), /'agents\.turnOff'/);
});

test('g: Uso shows «Al llegar al límite» in view (the mock-up draws it) and keeps the local usage and «Tokens por día: tabla» under «Más opciones»', () => {
  const usage = src('views', 'usage.jsx');
  const start = usage.indexOf('<MoreOptions testid="usage-more-options">');
  const more = usage.slice(start, usage.indexOf('</MoreOptions>', start));
  for (const piece of ['<LocalUsage data=', '<DaysTable days=']) assert.ok(more.includes(piece), piece);
  assert.ok(!more.includes('<Limits cfg='), 'the limits are not folded');
  assert.ok(usage.indexOf('<Limits cfg=') > usage.indexOf('byAgentModel') && usage.indexOf('<Limits cfg=') < start, 'the limits follow «Por agente y modelo»');
  for (const id of ['usage-switch-account', 'usage-warn-at', 'usage-stop-queue', 'usage-brake-5h', 'usage-brake-week']) assert.ok(usage.includes(`data-testid="${id}"`), id);
  assert.match(usage, /<details className="text-faint-foreground text-caption" data-testid="usage-table">/);
  assert.ok(usage.indexOf('<DaysTable days=') > usage.indexOf('<LocalUsage'));
});
