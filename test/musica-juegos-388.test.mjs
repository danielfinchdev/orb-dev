// The mini-games' music: made by Orb as the game is played (src/ui/lib/game-music.js on the adaptive engine), with a
// theme per game that follows the play. The themes driven with a fake audio context (no sound is checked, only that
// they run and let go), what each game's events do to the music, and the rules the player keeps, read as source: no
// file and no download, never by itself, the volume of Ajustes, stopped when the game is left and when Orb locks.
import { ROOT } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ADAPTIVE_THEMES } from '../src/shared/music.mjs';
import { THEME_IDS, createAdaptiveMusic } from '../src/ui/lib/adaptive-music.js';
import { GAME_THEMES, GAME_THEME_IDS, createGameMood, OVER_LEVEL, HEAT_MAX, HEAT_S, CADENCE_S, TENSION_S, POWER_S } from '../src/ui/lib/game-music.js';
import { fakeContext, run } from './fixtures/fake-audio.mjs';

const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');
const GAMES = [...read('games', 'games.jsx').matchAll(/\{ id: '([a-z0-9]+)', load:/g)].map((m) => m[1]);
// A mood with a clock of the test's own.
const moodOf = (game) => { const clock = { t: 100 }; const mood = createGameMood(game, { now: () => clock.t }); return { mood, clock, wait: (s) => { clock.t += s; } }; };
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.02, `${what}: ${a} is not about ${b}`);

test('every game has a theme of its own, apart from the background ones', () => {
  assert.equal(GAMES.length, 8);
  assert.deepEqual([...GAME_THEME_IDS].sort(), [...GAMES].sort(), 'a theme per game of games.jsx, by its id');
  assert.deepEqual([...THEME_IDS], [...ADAPTIVE_THEMES], 'the background themes are the same four: no game theme among them');
  for (const id of GAME_THEME_IDS) assert.equal(ADAPTIVE_THEMES.includes(id), false, id);
  // Each has what the engine needs, and no two are the same music with another name.
  const seen = new Set();
  for (const [id, th] of Object.entries(GAME_THEMES)) {
    for (const key of ['tonics', 'modes', 'bpm', 'chordBars', 'range', 'reverb', 'delay', 'mix', 'level', 'sends', 'filt', 'pad', 'bass', 'bassStyle', 'flourish', 'perc', 'kit', 'texture']) assert.ok(th[key] !== undefined, `${id}.${key}`);
    for (const layer of ['pad', 'bass', 'arp', 'perc', 'tex']) assert.equal(th.mix[layer].length, 4, `${id}.mix.${layer}`);
    assert.ok(th.modes[th.mode0], `${id}: its first mode`);
    assert.ok(th.bpm[0] < th.bpm[1] && th.bpm[0] >= 50 && th.bpm[1] <= 140, `${id}: ${th.bpm}`);
    assert.ok(th.rush === undefined || (th.rush > 0 && th.rush <= 0.5), `${id}: rush`);
    const character = JSON.stringify([th.bpm, th.modes, th.bassStyle, th.perc, th.swing, th.rush ?? 0]);
    assert.equal(seen.has(character), false, `${id} has a character of its own`); seen.add(character);
  }
  // The thinking games are the calm ones and the arcade ones the lively ones.
  const top = (id) => GAME_THEMES[id].bpm[1];
  assert.ok(top('chess') < 70 && top('g2048') <= 80, 'chess and 2048 are slow');
  for (const id of ['snake', 'tetris', 'breakout', 'pacman', 'runner']) assert.ok(GAME_THEMES[id].bpm[0] >= 96, `${id} is quick`);
  assert.ok(GAME_THEMES.runner.bpm[0] > top('tetris'), 'the runner is the fastest');
  assert.ok(GAME_THEMES.invaders.rush > GAME_THEMES.tetris.rush, 'the invaders speed up the most');
  // Made on the spot: no file, no address, nothing to load, and English only.
  const source = read('lib', 'game-music.js');
  assert.doesNotMatch(source, /https?:|fetch\(|new Audio|\.mp3|\.ogg|^import /m);
  assert.doesNotMatch(source, /[áéíóúñ¿¡]/i);
});

// An engine left playing would keep the test process alive: each one is let go whatever the assertions say.
test('every game theme plays for minutes through a whole game without piling up voices', (t) => {
  for (const id of GAME_THEME_IDS) {
    const { ctx } = fakeContext();
    const music = createAdaptiveMusic({ theme: id, themes: GAME_THEMES, seed: `seed-${id}`, volume: 0.5, context: ctx, autoPause: false });
    t.after(() => music.destroy());
    music.setIntensity(0.3); music.start();
    assert.equal(music.getState().theme, id, 'a theme of the caller\'s is taken');
    let most = 0;
    // Three minutes: the game heats up, a life is lost, a good moment, the hardest part and the end.
    run(music, ctx, 180, (now) => {
      const s = Math.round(now * 20);
      if (s === 30 * 20) music.setIntensity(0.6);
      if (s === 50 * 20) music.signal('error');
      if (s === 70 * 20) music.signal('agent-done');
      if (s === 90 * 20) music.setIntensity(1);
      if (s === 110 * 20) music.signal('success');
      if (s === 150 * 20) music.setIntensity(OVER_LEVEL);
      most = Math.max(most, music.getState().voices);
    });
    const st = music.getState(), th = GAME_THEMES[id];
    assert.ok(most > 0 && most <= 26, `${id}: at most 26 voices at once (${most})`);
    assert.ok(st.bpm >= th.bpm[0] && st.bpm <= th.bpm[1] && st.bar > 10, `${id}: it keeps playing (${st.bpm} bpm, bar ${st.bar})`);
    near(st.intensity, OVER_LEVEL, `${id}: it settles where the game left it`);
    music.destroy();
  }
});

test('the tempo follows the game in the themes that rush, and in no other', (t) => {
  const bars = (theme, intensity, themes) => {
    const { ctx } = fakeContext();
    const music = createAdaptiveMusic({ theme, themes, seed: 'tempo', context: ctx, autoPause: false });
    t.after(() => music.destroy());
    music.setIntensity(intensity); music.start(); music._engine.intensity = intensity;
    run(music, ctx, 120);
    const n = music.getState().bar; music.destroy(); return n;
  };
  const calm = bars('invaders', 0.1, GAME_THEMES), close = bars('invaders', 1, GAME_THEMES);
  assert.ok(close > calm * 1.3, `the invaders' march speeds up as they come down (${calm} → ${close} bars in two minutes)`);
  assert.ok(bars('tetris', 1, GAME_THEMES) > bars('tetris', 0.1, GAME_THEMES), 'tetris too');
  assert.equal(bars('chess', 1, GAME_THEMES), bars('chess', 0.1, GAME_THEMES), 'chess keeps its tempo');
  for (const theme of ADAPTIVE_THEMES) assert.equal(bars(theme, 1), bars(theme, 0.1), `${theme}: the background music keeps its tempo`);
  // A theme that is not there falls back to the first one, as before.
  const { ctx } = fakeContext();
  assert.equal(createAdaptiveMusic({ theme: 'tetris', context: ctx }).getState().theme, 'bruma', 'the game themes exist only for who brings them');
});

test('each game starts at its own level: calm for the thinking ones, lively for the arcade ones', () => {
  const start = Object.fromEntries(GAMES.map((id) => [id, createGameMood(id).level()]));
  for (const id of GAMES) assert.ok(start[id] > OVER_LEVEL && start[id] <= 0.6, `${id}: ${start[id]}`);
  assert.ok(start.chess < 0.25 && start.g2048 < 0.25, 'chess and 2048 start calm');
  for (const id of ['snake', 'tetris', 'breakout', 'invaders', 'pacman']) assert.ok(start[id] >= 0.3, `${id} starts with rhythm`);
  assert.equal(Math.max(...Object.values(start)), start.runner, 'the runner starts the highest');
});

test('the music rises as the game gets harder, and a lively moment adds heat that fades', () => {
  // Snake: it grows with the snake.
  const snake = moodOf('snake'); const calm = snake.mood.level();
  let last = calm;
  for (let n = 1; n <= 30; n++) { snake.mood.event('snake.eat', n); snake.wait(4 * HEAT_S); const now = snake.mood.level(); assert.ok(now >= last - 0.001, `the snake grows, the music does not fall (${n})`); last = now; }
  assert.ok(last > calm + 0.4 && last <= 0.95, `thirty apples later it is high (${calm} → ${last})`);
  // The heat of a moment: up at once, gone in a few seconds, and never more than its ceiling.
  const b = moodOf('breakout'); const base = b.mood.level();
  for (let i = 0; i < 40; i++) b.mood.event('breakout.paddle');
  assert.ok(b.mood.level() > base + 0.2 && b.mood.level() <= base + HEAT_MAX + 0.001, 'many bounces in a row');
  b.wait(6 * HEAT_S); near(b.mood.level(), base, 'and back when they stop');
  // Tetris: the lines made so far.
  const t = moodOf('tetris'); const t0 = t.mood.level();
  for (let i = 0; i < 20; i++) t.mood.event('tetris.lines', 2);
  t.wait(6 * HEAT_S); assert.ok(t.mood.level() > t0 + 0.3, 'forty lines later');
  // 2048: the biggest tile made.
  const g = moodOf('g2048'); const g0 = g.mood.level();
  g.mood.event('g2048.merge', 8); g.wait(6 * HEAT_S); const small = g.mood.level();
  g.mood.event('g2048.merge', 1024); g.wait(6 * HEAT_S); const big = g.mood.level();
  g.mood.event('g2048.merge', 16); g.wait(6 * HEAT_S);
  assert.ok(small > g0 && small < g0 + 0.15 && big > g0 + 0.45, `it opens up with the tiles (${g0}, ${small}, ${big})`);
  near(g.mood.level(), big, 'a small merge later does not bring it down');
  // Invaders: where they are, by their own step; a new wave starts far away again.
  const inv = moodOf('invaders'); const far = inv.mood.level();
  inv.mood.event('inv.march', { i: 0, ms: 780 }); near(inv.mood.level(), far, 'far away');
  inv.mood.event('inv.march', { i: 1, ms: 100 }); const closeBy = inv.mood.level();
  assert.ok(closeBy > far + 0.55, `close: ${closeBy}`);
  inv.mood.event('inv.march', { i: 2, ms: 760 }); assert.ok(inv.mood.level() < far + 0.05, 'the next wave');
  // Chess and the runner.
  const c = moodOf('chess'); const c0 = c.mood.level();
  for (let i = 0; i < 40; i++) c.mood.event(i % 5 ? 'chess.move' : 'chess.capture', true);
  c.wait(6 * HEAT_S); assert.ok(c.mood.level() > c0 + 0.25 && c.mood.level() < 0.7, 'the middle game is denser, never frantic');
  const r = moodOf('runner'); const r0 = r.mood.level();
  r.mood.event('runner.checkpoint'); r.wait(CADENCE_S); r.mood.event('runner.checkpoint'); r.wait(6 * HEAT_S);
  assert.ok(r.mood.level() > r0 + 0.15, 'further into the level');
  assert.equal(r.mood.event('runner.dead'), 'error'); near(r.mood.level(), r0, 'back to the start of the level');
});

test('good moments are flourishes and bad ones darken it, one at a time', () => {
  const t = moodOf('tetris');
  assert.equal(t.mood.event('tetris.lines', 1), null, 'one line is no fanfare');
  assert.equal(t.mood.event('tetris.lines', 4), 'success', 'four at once is');
  assert.equal(t.mood.event('tetris.level'), null, 'a level reached with those same lines: one flourish, not two');
  t.wait(CADENCE_S); assert.equal(t.mood.event('tetris.level'), 'success');
  t.wait(1); assert.equal(t.mood.event('tetris.top'), 'error', 'a bad moment never waits for a good one');
  // Snake: a soft mark every five, a bright one every ten.
  const s = moodOf('snake'); const got = [];
  for (let n = 1; n <= 10; n++) { got.push(s.mood.event('snake.eat', n)); s.wait(CADENCE_S); }
  assert.deepEqual(got, [null, null, null, null, 'agent-done', null, null, null, null, 'success']);
  assert.equal(s.mood.event('snake.crash'), 'error');
  // 2048: the first time a big tile is made, not every time.
  const g = moodOf('g2048');
  assert.equal(g.mood.event('g2048.merge', 64), null);
  assert.equal(g.mood.event('g2048.merge', 128), 'agent-done'); g.wait(CADENCE_S);
  assert.equal(g.mood.event('g2048.merge', 128), null, 'a second 128 is nothing new'); g.wait(CADENCE_S);
  assert.equal(g.mood.event('g2048.merge', 512), 'success'); g.wait(CADENCE_S);
  assert.equal(g.mood.event('g2048.win'), 'success');
  // Chess: a check is tension; the end of the game says how it went.
  const c = moodOf('chess');
  assert.equal(c.mood.event('chess.check'), 'error');
  assert.equal(c.mood.event('chess.check'), null, 'two dark moments in a row are one'); c.wait(TENSION_S);
  assert.equal(c.mood.event('chess.check'), 'error'); c.wait(TENSION_S);
  assert.equal(c.mood.event('chess.castle'), 'agent-done'); c.wait(CADENCE_S);
  assert.equal(c.mood.event('chess.promo'), 'success'); c.wait(CADENCE_S);
  assert.equal(moodOf('chess').mood.event('chess.win'), 'success'); assert.equal(moodOf('chess').mood.event('chess.lose'), 'error'); assert.equal(moodOf('chess').mood.event('chess.draw'), 'agent-done');
  // A life lost in the arcade ones, and the wave cleared.
  for (const [game, lost, cleared] of [['breakout', 'breakout.lose', 'breakout.wave'], ['invaders', 'inv.hit', 'inv.wave'], ['pacman', 'pac.death', 'pac.clear']]) {
    const m = moodOf(game);
    for (let i = 0; i < 20; i++) m.mood.event(game === 'breakout' ? 'breakout.brick' : game === 'invaders' ? 'inv.kill' : 'pac.ghost', 0);
    const hot = m.mood.level();
    assert.equal(m.mood.event(lost), 'error', lost); assert.ok(m.mood.level() < hot, `${game}: the heat is gone with the life`);
    assert.equal(m.mood.event(cleared), 'success', cleared);
  }
});

test('the power pill sets everything going for a few seconds', () => {
  const p = moodOf('pacman'); const base = p.mood.level();
  p.mood.event('pac.power'); assert.equal(p.mood.level(), 1);
  p.wait(POWER_S - 0.5); assert.equal(p.mood.level(), 1);
  p.wait(1); near(p.mood.level(), base, 'and it is over');
  p.mood.event('pac.power'); assert.equal(p.mood.event('pac.death'), 'error'); assert.ok(p.mood.level() < 1, 'caught: no power left');
});

test('only its own game moves it, and when the game is over it stays almost bare', () => {
  const s = moodOf('snake'); const base = s.mood.level();
  // Another game's events, the dialog's own sounds and anything unknown are not its business.
  for (const name of ['tetris.lines', 'pac.power', 'inv.march', 'over', 'record', 'start', 'select', 'snake.nope', '__proto__', 'constructor', '', undefined]) {
    assert.equal(s.mood.event(name, 4), null, String(name));
  }
  near(s.mood.level(), base, 'nothing moved');
  s.mood.event('snake.eat', 12); assert.ok(s.mood.level() > base);
  // Over: a record is celebrated once; then the music is the same whatever happens, until another game starts.
  assert.equal(s.mood.end(true), 'success'); assert.equal(s.mood.level(), OVER_LEVEL); assert.equal(s.mood.end(true), null);
  assert.equal(s.mood.event('snake.eat', 13), null); assert.equal(s.mood.level(), OVER_LEVEL);
  assert.equal(moodOf('tetris').mood.end(false), null, 'no record, no fanfare');
  const p = moodOf('pacman'); p.mood.event('pac.power'); p.mood.end(); assert.equal(p.mood.level(), OVER_LEVEL, 'the power ends with the game');
  assert.ok(OVER_LEVEL > 0 && OVER_LEVEL < 0.2);
  // A game the music does not know plays with a middle level and nothing else.
  const x = createGameMood('nope'); assert.ok(x.level() > 0.2 && x.level() < 0.5); assert.equal(x.event('nope.win'), null);
});

test('every rule is about a sound effect a game really makes', () => {
  const sfx = read('games', 'sfx.js'), source = read('lib', 'game-music.js');
  const rules = [...source.matchAll(/^ {2}'([a-z0-9]+\.[a-zA-Z]+)': \(/gm)].map((m) => m[1]);
  assert.ok(rules.length >= 35, `${rules.length} rules`);
  const prefix = { inv: 'invaders', pac: 'pacman' };
  const byGame = {};
  for (const name of rules) {
    assert.ok(sfx.includes(`'${name}'`), `${name} is an effect of games/sfx.js`);
    const game = prefix[name.split('.')[0]] ?? name.split('.')[0];
    assert.ok(GAMES.includes(game), name); (byGame[game] ??= []).push(name);
  }
  // Every game is followed: something makes it rise and something darkens it.
  for (const game of GAMES) {
    assert.ok((byGame[game] ?? []).length >= 2, `${game}: ${byGame[game]}`);
    const signals = byGame[game].flatMap((name) => [4, 10, 2048].map((arg) => moodOf(game).mood.event(name, name === 'inv.march' ? { ms: 100 } : arg)));
    signals.push(moodOf(game).mood.end(false)); // 2048 has no effect for losing: its end is its bad moment
    assert.equal(moodOf(game).mood.end(false), game === 'g2048' ? 'error' : null, `${game}: the end without a record`);
    assert.ok(signals.includes('error'), `${game} has a bad moment`); assert.ok(signals.includes('success'), `${game} has a good one`);
  }
});

test('the player: a game\'s music comes from the engine, with the rules of always', () => {
  const music = read('lib', 'music.js');
  // Made by the engine with the game's theme, both loaded only when a game with music starts.
  assert.match(music, /await Promise\.all\(\[import\('\.\/adaptive-music\.js'\), import\('\.\/game-music\.js'\)\]\);\n\s+if \(run !== gameRuns\) return;/);
  assert.doesNotMatch(music, /^import .*(adaptive-music|game-music)/m);
  assert.match(music, /gameEngine = createAdaptiveMusic\(\{ theme: id, themes: GAME_THEMES, seed: `orb-\$\{id\}-\$\{Date\.now\(\)\}`, volume, context: gameCtx, autoPause: false \}\);/);
  // Only where music is allowed and not muted; the volume is the one of Ajustes, now and when it is moved.
  assert.match(music, /export async function startGameMusic\(id\) \{\n\s+const run = \+\+gameRuns;\n\s+if \(!available\(\) \|\| !gameMusicOn\(\)\) \{ stopGameMusic\(\); return; \}/);
  assert.match(music, /const volume = engineVolume\(musicPrefs\(\)\.volume\);/);
  assert.match(music, /engine\?\.setVolume\(engineVolume\(v\)\); gameEngine\?\.setVolume\(engineVolume\(v\)\);/);
  // Never by itself: only games.jsx starts it, from the click that starts a game (or the game's own music button).
  const games = read('games', 'games.jsx');
  assert.equal(games.match(/startGameMusic\(/g).length, 1);
  assert.match(games, /const start = \(id\) => \{ stopAll\(\); sfx\('start'\); setHelp\(false\); setGame\(id\); setScore\(0\); setOver\(null\); setRound\(\(r\) => r \+ 1\); startGameMusic\(id\); \};/);
  assert.equal(music.match(/startGameMusic\(/g).length, 2, 'its definition and the music button of the games');
  // Stopped when the game is left, when the dialog closes and when Orb locks; its context goes after the fade.
  assert.match(games, /const close = \(\) => \{ stopAll\(\); stopGameMusic\(\);/);
  assert.match(games, /const back = \(\) => \{ stopAll\(\); stopGameMusic\(\);/);
  assert.match(games, /useEffect\(\(\) => \{ if \(!open\) stopGameMusic\(\); \}, \[open\]\);\n\s+useEffect\(\(\) => stopGameMusic, \[\]\);/);
  assert.match(music, /gameEngine\.stop\(\);\n[^\n]*\n\s+gameLetGo = setTimeout\(freeGame, 1000\);/);
  assert.match(music, /gameEngine\?\.destroy\(\); gameEngine = null;\n\s+gameCtx\?\.close\(\)\.catch\(quiet\); gameCtx = null;/);
  assert.match(music, /clearInterval\(gameMeter\); gameMeter = null; gameMood = null; gameOn = false;/);
  // Hidden: paused and not told; back when the window is shown, only if its game is still there.
  assert.match(music, /if \(!hidden\) gameEngine\.start\(\);/);
  assert.match(music, /if \(resume\?\.game && gameOn\) gameEngine\?\.start\(\);/);
  assert.match(music, /function tell\(signal\) \{ if \(signal && gameEngine && gameOn && !hidden\) gameEngine\.signal\(signal\); \}/);
  assert.match(music, /if \(gameEngine && gameMood && !hidden\) gameEngine\.setIntensity\(gameMood\.level\(\)\);/);
  // It follows the game: what happens is heard through the sound effects' names, with the effects on or off.
  assert.match(games, /useEffect\(\(\) => \(open \? hearGame\(gameMusicEvent\) : undefined\), \[open\]\);/);
  assert.match(games, /setOver\(\{ score: s, record: rec \}\);\n\s+endGameMusic\(rec\);/);
  const sfx = read('games', 'sfx.js');
  assert.match(sfx, /export function sfx\(name, arg, \{ delay = 0 \} = \{\}\) \{\n\s+for \(const fn of hearers\) fn\(name, arg\);\n\s+const s = app\(\);\n\s+if \(muted \|\|/, 'told before the mute is looked at');
  assert.match(sfx, /export const hearGame = \(fn\) => \{ hearers\.add\(fn\); return \(\) => hearers\.delete\(fn\); \};/);
  // No game knows about its music.
  for (const file of fs.readdirSync(path.join(ROOT, 'src', 'ui', 'games')).filter((f) => f !== 'games.jsx')) assert.doesNotMatch(read('games', file), /^import .*(lib\/music|game-music)|GameMusic/m, file);
});
