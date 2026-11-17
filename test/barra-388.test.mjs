// Orb UI 2.0, the sidebar (src/ui/components/sidebar.jsx and the chat list of views/orb/inbox.jsx): the four places, the
// icons-only foot without its arrow, the wordmark without the robot outside the Orb theme, the filter inside the search
// box, and every test id the sidebar had before. Read as text, like the other interface tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { robotSkin, SKINS } from '../src/shared/appearance.mjs';

const read = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
const sidebar = read('components/sidebar.jsx');
const inbox = read('views/orb/inbox.jsx');
const robot = read('components/robot.jsx');
const css = read('app.css');

// What the sidebar had on screen before this step (it left only the arrow that unfolded the foot).
const KEPT = ['app-version', 'nav-feedback', 'nav-music', 'nav-music-next', 'sidebar-footer', 'sidebar-home', 'sidebar-resize', 'wordmark',
  'nav-agents', 'nav-memories', 'nav-settings', 'nav-tutorials', 'nav-device',
  'chat-menu', 'chat-menu-list', 'chat-sheet', 'chat-snoozed', 'chat-unread', 'chats-message-hit', 'chats-new', 'mobile-chats', 'nav-tasks-count',
  'new-conversation', 'orb-avatar', 'orb-empty', 'orb-inbox', 'orb-pinned', 'orb-places', 'orb-places-more', 'orb-progress', 'orb-reorder',
  'project-info', 'project-new-chat', 'rename-input', 'sidebar-completed', 'sidebar-filter', 'sidebar-new-project', 'sidebar-results', 'sidebar-search',
  'sidebar-search-input', 'snooze-at', 'task-hit-snippet'];

test('every test id the sidebar had is still there', () => {
  const all = [sidebar, inbox, read('components/browser-settings-menu.jsx')].join('\n');
  for (const id of KEPT) assert.ok(all.includes(`data-testid="${id}"`) || all.includes(`testid: '${id}'`), id);
  for (const dyn of ['`nav-${id}`', '`chat-${a.id}`', '`filter-${v}`', '`order-${v}`', '`project-head-${name', '`project-menu-${name}`', '`orb-row-${item.title}`', '`orb-group-${g.project']) assert.ok(inbox.includes(dyn), dyn);
});

test('four places with an icon, none active inside a chat', () => {
  assert.match(inbox, /\['tasks', ClipboardCheck, 'nav\.tasks'\], \['projects', FolderGit2, 'nav\.projects'\], \['schedules', CalendarSync, 'nav\.schedules'\], \['board', Presentation, 'nav\.board'\]/);
  // The open place is the route's view, so a chat (view «chat» or «session») lights none of them.
  assert.match(inbox, /aria-current=\{view === id \? 'page' : undefined\}/);
  assert.match(inbox, /className=\{cn\('size-5', view === id && 'text-primary-text'\)\}/, '20 px icon, the active one in the theme colour');
});

test('the foot is only icons with their bubble and has no arrow to unfold it', () => {
  assert.doesNotMatch(sidebar, /sidebar-footer-toggle|footerFold|footerUnfold|ChevronUp|ChevronDown/);
  assert.doesNotMatch(css, /side-foot-toggle/);
  for (const id of ['nav-settings', 'nav-agents', 'nav-memories', 'nav-tutorials']) assert.ok(sidebar.includes(`testid: '${id}'`), id);
  assert.match(sidebar, /<BubbleTip key=\{i\.testid\} title=\{i\.label\} text=\{i\.hint\} side="top" align=\{n === 0 \? 'start' : 'center'\}>/);
  assert.doesNotMatch(sidebar, /NavItem key=|<NavItem icon=\{i\.icon\}/, 'no list with names');
  // Order of the foot: the four icons, then the music, the feedback and the version.
  const foot = sidebar.slice(sidebar.indexOf('function SidebarFooter'), sidebar.indexOf('function MusicButtons'));
  const at = (s) => foot.indexOf(s);
  assert.ok(at('items.map') < at('<MusicButtons />') && at('<MusicButtons />') < at('data-testid="nav-feedback"') && at('data-testid="nav-feedback"') < at('data-testid="app-version"'));
  assert.match(sidebar, /<MusicButtons \/>/);
  assert.match(css, /\.side-foot-icon \{[^}]*width: var\(--ctl\); height: var\(--ctl\); border-radius: var\(--r-ctl\)/);
});

test('the head is the wordmark; the robot is drawn only in the Orb theme', () => {
  assert.deepEqual(SKINS.filter(robotSkin), ['orb']);
  const head = sidebar.slice(sidebar.indexOf('data-testid="sidebar-home"') - 400, sidebar.indexOf('<SidebarToggle />'));
  assert.match(head, /<Robot size=\{34\}/);
  assert.doesNotMatch(head, /<Robot[^>]* mark=/, 'no app icon in the other themes');
  assert.match(head, /<Wordmark \/>/);
  assert.match(robot, /if \(!robotSkin\(skin\)\) return mark \? <OrbMark[^;]*: null;/, 'without `mark` the robot is nothing outside the Orb theme');
  assert.match(sidebar, /go\(lastChat\(route, conversations\)\)/, 'pressing the brand goes back to the chat');
  assert.match(sidebar, /const SIDEBAR_DEFAULT = 340; const SIDEBAR_MIN = 340;/);
  assert.match(sidebar, /onPointerDown=\{startResize\}/, 'its edge still drags');
});

test('the filter sits inside the search box and «+» is an icon button', () => {
  const pc = inbox.slice(inbox.indexOf('const pcSearch'), inbox.indexOf('const search = phone'));
  assert.match(pc, /<SearchInput /);
  assert.match(pc, /absolute top-1\/2 right-1[\s\S]*<FilterMenu inline /, 'the filter is a child of the box, at its right end');
  assert.ok(pc.indexOf('<FilterMenu inline') < pc.indexOf('<OrbNewMenu />'), 'and «+» comes after the box');
  assert.match(inbox, /<IconButton label=\{t\('chats\.new'\)\}[^>]*data-testid="chats-new"><Plus \/><\/IconButton>/);
  assert.match(inbox, /<IconButton small label=\{t\('orbchats\.filter'\)\}/);
  // The phone keeps its own search row and the round button.
  assert.match(inbox, /const phoneSearch = \(/);
  assert.match(inbox, /phone \? <OrbNewMenu fab \/> : null/);
});

test('the rows of the list: the agent mark (12 px), the working spinner and the ⋯ over the row', () => {
  const row = inbox.slice(inbox.indexOf('const OrbRow'), inbox.indexOf('// ---- a project'));
  assert.match(row, /<AgentIcon agent=\{agents\[0\]\} \/>/);
  assert.match(read('components/agent-icon.jsx'), /cn\('ag size-3 shrink-0', className\)/, '12 px, no background');
  assert.match(row, /<LoaderCircle [^>]*animate-spin/);
  assert.match(row, /<OrbMenu item=\{item\} open=\{menu\} setOpen=\{setMenu\} className="absolute top-\[5px\] right-2" \/>/);
  assert.match(inbox, /<MoreButton small label=\{t\('chats\.menu'/, 'the ⋯ is the shared small icon button');
  assert.match(inbox, /group-hover\/row:opacity-100 group-focus-within\/row:opacity-100/, 'it shows on hover and on focus');
  // The project's 10 px dot heads each group and the pinned rows carry theirs.
  assert.match(inbox, /<ProjectIcon name=\{name\} \/>/);
  assert.match(inbox, /showProject && item\.project \? <span[^>]*><ProjectIcon name=\{item\.project\} small \/>/);
  assert.equal((inbox.match(/<OrbAvatar /g) ?? []).length, 3, 'the phone keeps its avatar');
});

test('the heading of the list: all activity and the order, and the completed link', () => {
  assert.match(inbox, /onClick=\{\(\) => go\('activity'\)\}[^>]*data-testid="sidebar-activity"/);
  assert.match(inbox, /<SortMenu filter=\{filter\} setFilter=\{setFilter\} order=\{order\} setOrder=\{setOrder\} \/>/);
  assert.match(inbox, /t\('orbchats\.doneCount', \{ n: parts\.hidden \}\)/);
});

test('the texts exist in Spanish and English and the sidebar draws with tokens only', async () => {
  for (const lang of ['es', 'en']) {
    const o = (await import(`../src/shared/locales/${lang}/orbchats.mjs`)).default;
    const m = (await import(`../src/shared/locales/${lang}/mensajeria.mjs`)).default;
    for (const k of ['filterHint', 'sortFilter', 'activity', 'activityTip', 'doneCount']) assert.ok(o[`orbchats.${k}`], `${lang}: ${k}`);
    assert.ok(m['chats.newHint'], `${lang}: chats.newHint`);
    const b = (await import(`../src/shared/locales/${lang}/base.mjs`)).default;
    assert.ok(!('nav.footerFold' in b) && !('nav.footerUnfold' in b), `${lang}: the unfold texts are gone`);
  }
  const mine = [sidebar, inbox.slice(inbox.indexOf('function PlacesStub') < 0 ? 0 : 0)].join('\n');
  assert.doesNotMatch(mine, /#[0-9a-fA-F]{3,8}\b|oklch\(|rgb\(/, 'colours only through tokens');
});
