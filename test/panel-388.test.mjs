// The right panel of a chat with an agent (Ficha, Cambios, PR) and the chat's header buttons, as in the mock-up 01-chat.
// Reads the sources as text: nothing here needs the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createT } from '../src/shared/i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const panel = read('src/ui/components/chat-panel.jsx');
const session = read('src/ui/views/session.jsx');
const prCard = read('src/ui/components/pr-card.jsx');
const css = read('src/ui/app.css');

test('the panel has the three tabs, Ficha, Cambios and PR', () => {
  for (const id of ['panel-tab-info', 'panel-tab-changes', 'panel-tab-pr']) assert.match(panel, new RegExp(`data-testid="${id}"`));
  assert.match(panel, /<TabsList variant="line"/);
  assert.match(panel, /value="info"[\s\S]*value="changes"[\s\S]*value="pr"/);
  // the PR tab only exists when the branch has a pull request
  assert.match(panel, /prNumber \? <TabsTrigger value="pr"/);
  const es = createT('es'); const en = createT('en');
  assert.equal(es('panel.tab.info'), 'Ficha'); assert.equal(es('panel.tab.changes'), 'Cambios'); assert.equal(es('panel.tab.pr', { n: 7 }), 'PR #7');
  assert.equal(en('panel.tab.info'), 'Details'); assert.equal(en('panel.tab.changes'), 'Changes'); assert.equal(en('panel.tab.pr', { n: 7 }), 'PR #7');
});

test('its width is dragged between 320 and 640 px and remembered', () => {
  assert.match(panel, /PANEL_MIN = 320; const PANEL_MAX = 640/);
  assert.match(panel, /Math\.min\(PANEL_MAX, Math\.max\(PANEL_MIN, n\)\)/);
  assert.match(panel, /localStorage\.setItem\(key/);
  assert.match(panel, /role="separator"/);
  assert.match(css, /\.chat-panel-resize \{[^}]*cursor: col-resize/);
});

test('it opens and closes with transform and opacity only', () => {
  assert.match(css, /@keyframes chat-panel-in \{ from \{ opacity: 0; transform: translateX\(24px\); \} \}/);
  assert.match(css, /@keyframes chat-panel-out \{ to \{ opacity: 0; transform: translateX\(24px\); \} \}/);
  assert.doesNotMatch(css.match(/@keyframes chat-panel-in[^\n]*/)[0], /width|height|margin/);
  assert.match(panel, /data-state=\{open \? 'open' : 'closed'\}/);
});

test('the header has no «Cambios» button: the panel button opens the panel and Ctrl+D its Cambios tab', () => {
  assert.doesNotMatch(session, /t\('turns\.button'\)/);
  assert.match(session, /data-testid="turn-changes-toggle"><PanelRight \/>/);
  assert.match(session, /useShortcut\('changes\.toggle'[\s\S]{0,200}openTab\('changes'\)/);
  // «Revisar» (lib/open-changes.js) opens the panel on Cambios, on that turn
  assert.match(session, /onOpenChanges\([\s\S]{0,200}openTab\('changes'\)/);
  assert.match(session, /<TurnChanges [^>]*turn=\{changesTurn\?\.turn\}/);
  // pause, notifications, panel, then ⋯
  assert.ok(session.indexOf('<BarPause />') < session.indexOf('<NotificationBell />') && session.indexOf('<NotificationBell />') < session.indexOf('data-testid="turn-changes-toggle"'));
});

test('«Hacer commit…» is the first item of the ⋯ menu, not a header button', () => {
  assert.doesNotMatch(session, /CommitButton/);
  const menu = session.slice(session.indexOf('<DropdownMenuContent align="end" className="w-[250px]">'));
  assert.ok(menu.indexOf('<CommitMenuItem') > 0 && menu.indexOf('<CommitMenuItem') < menu.indexOf('data-testid="open-folder"'));
  assert.match(menu, /s\.kind === 'chat' && s\.project && fullPc\(\) \? <><CommitMenuItem/);
  const dialog = read('src/ui/components/commit-dialog.jsx');
  assert.match(dialog, /data-testid="commit-open"/);
  assert.match(dialog, /export function CommitDialog/);
  // the rest of the menu stays
  for (const id of ['open-folder', 'session-terminal', 'details', 'fork', 'switch-agent', 'handoff', 'archive', 'bar-games', 'delete']) assert.match(menu, new RegExp(`data-testid="${id}"`), id);
});

test('«Vigilar la CI» is a row of the PR list, with its switch', () => {
  assert.match(prCard, /<Switch checked=\{Boolean\(watch\)\} onCheckedChange=\{toggle\}[^>]*data-testid="pr-watch"/);
  const rows = prCard.slice(prCard.indexOf('<dl '), prCard.indexOf('</dl>'));
  assert.match(rows, /<dt [^>]*>[\s\S]*prbar\.watch[\s\S]*<\/dt>\s*<dd [^>]*><Switch/);
  assert.match(prCard, /export function PrPanel/);
  // the PR's text comes from the internet: plain text nodes, never HTML
  assert.doesNotMatch(prCard.slice(prCard.indexOf('export function PrPanel')), /dangerouslySetInnerHTML|<Markdown/);
});

test('every data-testid the files had before is still there', () => {
  const files = ['src/ui/components/chat-side.jsx', 'src/ui/components/turn-changes.jsx', 'src/ui/components/task-changes.jsx', 'src/ui/components/diff-view.jsx', 'src/ui/components/pr-card.jsx',
    'src/ui/components/commit-dialog.jsx', 'src/ui/views/orb/info.jsx', 'src/ui/components/chat-bar.jsx', 'src/ui/components/conversation/bar.jsx'];
  const before = (f) => { try { return execFileSync('git', ['show', `e7992a8a:${f}`], { cwd: ROOT, encoding: 'utf8' }); } catch { return null; } };
  for (const f of files) {
    const old = before(f); if (old == null) continue; // not a git checkout
    // the panel's ✕ now lives in the panel's own tab strip
    const now = read(f) + (f.endsWith('turn-changes.jsx') ? panel : '');
    for (const id of new Set([...old.matchAll(/testid="([^"]+)"/g)].map((m) => m[1]))) assert.ok(now.includes(`testid="${id}"`), `${f}: ${id}`);
  }
  for (const id of ['turn-changes-toggle', 'session-more', 'commit-open']) assert.ok(session.includes(id) || read('src/ui/components/commit-dialog.jsx').includes(id), id);
});

test('the panel keeps the PC layout only: the phone and a linked browser have no panel', () => {
  // s?. on purpose: the route of a deleted chat reaches this line before the «gone» screen
  assert.match(session, /const hasPanel = s\?\.kind === 'chat' && Boolean\(s\?\.project\) && fullPc\(\);/);
  assert.match(session, /\{hasPanel \? \(\s*<ChatPanel /);
});

test('the chat never scrolls sideways and the panel body hides its own horizontal overflow', () => {
  assert.match(panel, /overflow-x-hidden overflow-y-auto/);
  assert.match(read('src/ui/themes/skins.css'), /\[data-testid="chat-panel"\]/);
});

test('es and en have the same panel texts', () => {
  const es = read('src/shared/locales/es/tasks.mjs'); const en = read('src/shared/locales/en/tasks.mjs');
  const keys = (s) => [...s.matchAll(/^ {2}'(panel\.[^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(keys(es), keys(en));
  assert.ok(keys(es).length > 30);
});

test('«anterior / siguiente cambio» goes on across the files of the turn, and the tray jumps to the file of a comment', () => {
  const changes = read('src/ui/components/turn-changes.jsx');
  // past the last change of a file it opens the next one (and the other way round) and lands on its first (last) change
  assert.match(changes, /const next = list\[list\.findIndex\(\(f\) => f\.path === path\) \+ dir\];/);
  assert.match(changes, /if \(next\) \{ setPick\(next\.path\); setSeek\(\{ dir \}\); \}/);
  assert.match(changes, /\(seek\.dir > 0 \? rows\[0\] : rows\.at\(-1\)\)\.scrollIntoView/);
  assert.match(changes, /e\.altKey && \(e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'\)/);
  assert.match(changes, /data-testid="turn-tray-go"/);
  assert.match(changes, /onClick=\{\(\) => show\(c\)\}/);
  // the tray still lists every comment, not only those of the file on screen
  assert.match(changes, /comments\.map\(\(c\) => \(\s*<li key=\{c\.key\}/);
  assert.match(changes, /<FileBlock key=\{`\$\{scope\}:\$\{current\.path\}`\} f=\{current\} sessionId=\{id\} comments=\{comments\} \/>/);
  for (const lang of ['es', 'en']) assert.notEqual(createT(lang)('turns.trayGo'), 'turns.trayGo');
});

test('the permissions menu: options in listboxes, «Más opciones» a button, the switches in a named group outside them', () => {
  const menu = read('src/ui/components/autonomy-switch.jsx');
  assert.equal((menu.match(/role="listbox"/g) ?? []).length, 2);
  assert.match(menu, /<button type="button" aria-expanded=\{expanded\} aria-controls=/);
  assert.match(menu, /role="group" aria-label=\{t\('session\.extraAccess'\)\}/);
  // the switches are not inside a listbox: the second listbox closes before the group opens
  const group = menu.indexOf('role="group"');
  assert.ok(menu.lastIndexOf('</div> : null}', group) < group);
  assert.match(menu, /if \(!e\.target\.closest\?\.\('\[role="option"\]'\)\) return;/);
  assert.match(menu, /aria-describedby=/);
  for (const lang of ['es', 'en']) for (const k of ['session.extraAccess', 'session.androidOff', 'session.androidChipTip']) assert.notEqual(createT(lang)(k), k);
});

test('step 6C1: the Ficha lists the tasks of the chat with the approval of Tareas and the last line of the project log', async () => {
  const info = read('src/ui/views/orb/info.jsx');
  const ficha = info.slice(info.indexOf('export function SessionInfo'));
  // approving and rejecting are the very functions of Tareas (they carry the confirmation and the fingerprint)
  assert.match(info, /import \{ approveTask, rejectTask \} from '@\/components\/task-approval\.jsx'/);
  assert.match(ficha, /x\.status === 'awaiting_approval' \? \(/);
  assert.doesNotMatch(ficha, /needsApproval/);
  assert.match(ficha, /onClick=\{\(\) => rejectTask\(x\)\}[^>]*>\{t\('tasks\.reject'\)\}/);
  assert.match(ficha, /onClick=\{\(\) => approveTask\(x\)\}[^>]*>\{t\('tasks\.approve\.ok'\)\}/);
  assert.doesNotMatch(ficha, /call\('tasks\.approve'/);
  assert.match(ficha, /String\(x\.session_id\) === String\(s\.id\)/);
  // the log: one read of the project's log when the Ficha opens, shown as one line, with «Abrir la bitácora»
  assert.equal((ficha.match(/call\('logs\.read'/g) ?? []).length, 1);
  assert.match(ficha, /data-testid="info-log-last"/);
  assert.match(ficha, /data-testid="info-open-log"/);
  // the folder is here now (it left the box); the worktree row says «Worktree»
  assert.match(ficha, /data-testid="session-folder">\{s\.cwd\}/);
  assert.match(ficha, /tree \? t\('panel\.info\.worktree'\) : t\('panel\.info\.branch'\)/);
  const { lastEntry } = await import('../src/ui/lib/logbook.js');
  const e = lastEntry('# Bitácora\n\n### 2026-11-16 09:00 — Codex (CLI, GPT) — Primero\n- Hecho: a\n\n### 2026-11-17 14:05 — Claude (Claude Code, Opus) — Contador de contexto: el presupuesto\n- Hecho: b\n');
  assert.equal(e.topic, 'Contador de contexto: el presupuesto');
  assert.deepEqual([e.date.getFullYear(), e.date.getMonth(), e.date.getDate()], [2026, 10, 17]);
  assert.equal(lastEntry('proyecto: todavía no tiene entradas'), null);
});

test('step 6C1: the permissions menu lists Preguntar then Auto with shield icons and an accent mark, and «Más opciones» from least to most access', () => {
  const menu = read('src/ui/components/autonomy-switch.jsx');
  assert.match(menu, /main = \['editar', 'auto'\]/);
  assert.match(menu, /MORE_ORDER = \['leer', 'probar', 'preguntar', 'total'\]/);
  for (const [level, icon] of [['auto', 'ShieldCheck'], ['editar', 'ShieldQuestion'], ['preguntar', 'ShieldAlert'], ['total', 'ShieldOff']]) assert.match(menu, new RegExp(`${level}: \\{ Icon: ${icon},`));
  assert.match(menu, /<Check className=\{cn\('text-primary-text mt-0\.5/);
  // the calls are not in this file: it only draws the options and reports the one chosen
  assert.doesNotMatch(menu, /grantTotal|grantAndroid|revokeGrant|sessions\.update|unlockCore/);
});

test('step 6D: the Ficha approves only what waits for approval and gives a held task the Undo and Accept of Tareas', () => {
  const info = read('src/ui/views/orb/info.jsx');
  const ficha = info.slice(info.indexOf('export function SessionInfo'));
  assert.match(info, /import \{ TaskStatus, acceptHeld, undoHeld \} from '@\/components\/task-state\.jsx'/);
  const approve = ficha.slice(ficha.indexOf("x.status === 'awaiting_approval'"), ficha.indexOf(': x.held ?'));
  assert.match(approve, /approveTask\(x\)/);
  const held = ficha.slice(ficha.indexOf(': x.held ?'), ficha.indexOf('mine.length > 8'));
  assert.match(held, /undoHeld\(t, x\)[^>]*>\{t\('tasks\.undo\.btn'\)\}/);
  assert.match(held, /acceptHeld\(t, x\)[^>]*>\{t\('tasks\.held\.accept'\)\}/);
  assert.doesNotMatch(held, /approveTask|rejectTask/);
});

test('step 6D: the chip gives the reasoning levels the own model, not the first of the list', () => {
  // the chip gets selectedModel, which starts from the conversation's own model (an alias is mapped to its listed entry)
  assert.match(session, /<AgentChip [^\n]*model=\{selectedModel\}/);
  assert.match(session, /let selectedModel = s\.model \?\? '';/);
  assert.doesNotMatch(session, /selectedModel = models\[0\]/);
  assert.doesNotMatch(session, /<AgentChip [^\n]*model=\{s\.model \|\|/);
});

test('paso 7C1: la Ficha dice «Worktree» si el chat tiene worktree y «Rama» si no', () => {
  const info = read('src/ui/views/orb/info.jsx');
  assert.match(info, /<GitBranch \/>\{tree \? t\('panel\.info\.worktree'\) : t\('panel\.info\.branch'\)\}/);
});
