// 3.8.9, visual fixes (I) of the PC interface: Tetris keys, the places row, the model menu's rules, the repeated
// titles, the centred chat title, the theme thumbnails and the mini-games' layout. Read as text where the code is JSX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { keyRepeater, boostFor } from '../src/ui/games/kit.js';
import { SKINS, PALETTES } from '../src/shared/appearance.mjs';

const src = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');
const locale = (lang, file) => fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, `${file}.mjs`), 'utf8');

test('24: a held arrow keeps repeating while another key is pressed', () => {
  const fired = [];
  const r = keyRepeater({ delay: 150, every: 50 });
  r.press('ArrowLeft');
  r.tick(100, (k) => fired.push(k));
  assert.deepEqual(fired, []);
  r.tick(60, (k) => fired.push(k)); // 160 ms: the first repeat
  assert.deepEqual(fired, ['ArrowLeft']);
  // the rotation is not a held key: pressing it leaves the slide alone
  r.tick(50, (k) => fired.push(k));
  r.tick(50, (k) => fired.push(k));
  assert.equal(fired.length, 3);
  r.release('ArrowLeft');
  r.tick(500, (k) => fired.push(k));
  assert.equal(fired.length, 3);
  r.press('ArrowDown'); r.clear(); r.tick(500, (k) => fired.push(k));
  assert.equal(fired.length, 3);
});

test('24: Tetris repeats from its own clock and rotates once per press', () => {
  const t = src('games', 'tetris.jsx');
  assert.match(t, /keyRepeater\(\)/);
  assert.match(t, /repeater\.current\.tick\(dt,/);
  assert.match(t, /addEventListener\('keyup'/);
  // the rotation and the drop ignore the browser's auto-repeat
  assert.match(t, /key === 'ArrowUp'[^\n]*\n\s*if \(e\?\.repeat\) return true;/);
});

test('25: the places row has a fixed gap and a faint hover', () => {
  const inbox = src('views', 'orb', 'inbox.jsx');
  const places = inbox.slice(inbox.indexOf('function Places()'), inbox.indexOf('// ---- search'));
  assert.match(places, /gap-x-\[3px\]/);
  assert.ok(!/gap-0\b/.test(places) && !/gap-0\.5/.test(places.split('aria-label')[0]));
  assert.match(places, /hover:bg-accent\/35/);
  assert.ok(!places.includes("hover:bg-accent hover:text-foreground"));
  assert.match(src('main.jsx'), /grid-cols-\[repeat\(4,minmax\(0,1fr\)\)\] gap-x-\[3px\]/);
});

test('25: what does not fit with a fixed gap goes behind the «…» button', async () => {
  const { placesFit } = await import('../src/ui/lib/places-fit.js');
  assert.equal(placesFit(330, 4), 4);
  assert.equal(placesFit(240, 4), 2); // 2 places, the gap and the button
  assert.equal(placesFit(330, 4, { forceMore: true }), 4);
  assert.equal(placesFit(100, 4), 1);
  assert.match(src('views', 'orb', 'inbox.jsx'), /placesFit[(]el[.]clientWidth/);
});

test('26: every menu separator is a border of the same colour, never a box that may paint 1 or 2 pixels', () => {
  const overlay = src('components', 'ui', 'overlay.jsx');
  assert.match(overlay, /function DropdownMenuSeparator\(\) \{ return <DropdownPrimitive\.Separator className="border-border my-1 h-0 shrink-0 border-t" \/>/);
  assert.ok(!src('components', 'autonomy-switch.jsx').includes('h-px'));
});

test('27: Ajustes › General has a single «Más opciones»', () => {
  const general = src('views', 'settings', 'general.jsx');
  const from = general.indexOf('function MusicMore');
  const music = general.slice(from, general.indexOf('</>', from));
  assert.ok(!music.includes('<MoreOptions'));
  const index = src('views', 'settings', 'index.jsx');
  const generalSection = index.slice(index.indexOf("id: 'general'"), index.indexOf("id: 'magiclink'"));
  assert.equal(generalSection.split('<MoreOptions').length - 1, 1);
});

test('28: the Worktree tip does not repeat the word its title already says', () => {
  for (const l of ['es', 'en']) {
    const text = locale(l, 'chat');
    assert.doesNotMatch(text, /'chat\.workspace\.worktreeTip': 'Worktree/);
    assert.doesNotMatch(text, /'chat\.workspace\.noGit': 'Worktree/);
  }
});

test('39: the chat title block is centred on the panel', () => {
  const chat = src('views', 'chat.jsx');
  const head = chat.slice(chat.indexOf('data-testid="orb-chat-head"'), chat.indexOf('data-testid="orb-chat-status"') + 300);
  assert.match(head, /flex min-w-0 flex-col items-center text-center/);
  assert.match(head, /justify-center gap-1\.5/);
  const css = src('app.css');
  // the room of the window's buttons is cancelled in the middle column
  assert.match(css, /--bar-pr: 120px/);
  assert.match(css, /\.bar-center \{ transform: translateX\(calc\(\(var\(--bar-pr\) - var\(--bar-pl\)\) \/ 2\)\)/);
});

test('58: every theme has its thumbnail, and Predeterminado follows the palette', () => {
  const jsx = src('components', 'skin-preview.jsx');
  const css = src('components', 'skin-preview.css');
  for (const skin of SKINS) assert.match(css, new RegExp(`data-skin-preview="${skin}"`), skin);
  for (const palette of PALETTES) assert.match(css, new RegExp(`\\.skp\\[data-palette="${palette}"\\]`), palette);
  assert.match(jsx, /data-palette=\{skin === 'predeterminado' \|\| skin === 'cristal' \? palette : undefined\}/);
  const general = src('views', 'settings', 'general.jsx');
  assert.match(general, /<SkinPreview skin=\{skin\} palette=\{ui\.palette\} \/>/);
  // dark mode: the themes that have a dark look restate their colours under .dark
  for (const skin of ['predeterminado', 'cristal', 'orb', 'vaporwave', 'candy']) assert.match(css, new RegExp(`\\.dark \\.skp\\[data-skin-preview="${skin}"\\]`), skin);
});

test('59: the game is the main thing: fitted to the room, sharp, one-line bar, full screen', () => {
  assert.equal(boostFor(0.5), 1);
  assert.equal(boostFor(1.3), 1.5);
  assert.equal(boostFor(9), 3);
  const kit = src('games', 'kit.js');
  assert.match(kit, /export function setBoost/);
  for (const g of ['tetris', 'snake', 'breakout', 'runner', 'invaders', 'pacman']) assert.match(src('games', `${g}.jsx`), /setupCanvas\(canvas\.current, \w+, \w+, draw\)/, g);
  const games = src('games', 'games.jsx');
  assert.match(games, /function Fit\(/);
  assert.match(games, /Math\.min\(MAX_SCALE, b\.clientWidth \/ g\.offsetWidth, b\.clientHeight \/ g\.offsetHeight\)/);
  assert.ok(!games.includes('max-w-[362px]'));
  // no big score cards: one small line, the explanation behind the «?», the difficulty by the title, full screen with F or a button
  assert.match(games, /data-testid="games-scoreline"/);
  assert.match(games, /data-testid="games-help"/);
  assert.match(games, /data-testid="games-full"/);
  assert.match(games, /e\.key === 'f' \|\| e\.key === 'F'/);
  assert.match(games, /requestFullscreen/);
  for (const l of ['es', 'en']) for (const k of ['games.helpButton', 'games.fullOn', 'games.fullOff', 'games.fullKey']) assert.ok(locale(l, 'chat').includes(`'${k}'`), `${l} ${k}`);
});
