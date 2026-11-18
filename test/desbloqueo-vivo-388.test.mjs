// Orb UI 2.0, step 10B: the lock screen and the live window follow the approved mock-ups (17, 18) without touching
// what the vault depends on: the password field is hidden unless the timed «Mostrar» shows it (autocomplete kept), what
// the dialog asks for stays in view, and the unlock calls are the ones that already existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
const master = read('views/master.jsx');
const pip = read('pip.jsx');
const locked = master.slice(master.indexOf('export function MasterLocked'), master.indexOf('// Before a guarded action'));
const asker = master.slice(master.indexOf('setMasterAsker('), master.indexOf('// The window locked'));

test('every test id of the unlock and live window screens is still there', () => {
  for (const id of ['connector-keys', 'master-ack', 'master-again', 'master-ask', 'master-card', 'master-change', 'master-code', 'master-create', 'master-create-ok', 'master-current', 'master-forgot', 'master-lock-minutes', 'master-lock-now', 'master-locked', 'master-new', 'master-password', 'master-strength', 'master-warning']) {
    assert.ok(master.includes(`data-testid="${id}"`), id);
  }
  assert.ok(pip.includes('data-testid="pip"'));
});

test('the password fields keep their autocomplete and are shown only through the timed reveal (bloqueo-388.test.mjs)', () => {
  assert.match(locked, /type=\{reveal\.shown \? 'text' : 'password'\} autoComplete="current-password"/);
  assert.ok(locked.includes('data-testid="master-password"'));
  assert.match(asker, /<Input type="password" autoComplete="current-password"/);
  assert.ok(asker.includes('data-testid="master-ask"'));
  assert.doesNotMatch(locked, /console\./);
});

test('the dialog that asks before a guarded action still says what for, and sends what it did', () => {
  assert.match(asker, /master\.ask\.\$\{action\}/);
  assert.match(asker, /fresh \? tNow\('master\.askEveryTime'\) : tNow\('master\.askNote', \{ n: 5 \}\)/);
  assert.match(asker, /call\('master\.unlock', \{ password: v\.password, \.\.\.\(fresh \? \{ purpose: action \} : \{\}\) \}\)/);
});

test('the lock screen has no new way to unlock: one master.unlock call (plus the read of when it locked) and the old forgot flow', () => {
  const calls = [...master.matchAll(/call\('(master\.[a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ['master.change', 'master.create', 'master.forgot', 'master.lock', 'master.reset', 'master.state', 'master.unlock']);
  assert.equal([...locked.matchAll(/call\('/g)].length, 2);
  assert.match(locked, /call\('master\.state'\)/);
  assert.match(locked, /call\('master\.unlock', \{ password \}\)/);
  assert.match(locked, /forgotFlow\(\{ canForget \}\)/);
});

test('the lock screen shows a failure inline without more than the engine said, and the password is not stored', () => {
  assert.match(locked, /setError\(errorText\(err\)\)/);
  assert.match(locked, /role="alert"/);
  assert.doesNotMatch(locked, /localStorage|sessionStorage|setState\(/);
});

test('the mark is the robot only in the Orb theme', () => {
  assert.match(master, /function LockMark[\s\S]*robotSkin\(skin\)\) return <Robot size=\{48\}/);
});

test('the live window has no app-region of its own and nothing animated inside its drag areas', () => {
  assert.doesNotMatch(pip, /app-region/);
  assert.doesNotMatch(pip, /Robot/);
  const dragBlocks = pip.split('\n').filter((l) => /\bdrag\b/.test(l) && !/no-drag/.test(l));
  assert.ok(dragBlocks.length >= 2);
  // the header and the pill hold only static marks and buttons: the spinners live in the body
  const header = pip.slice(pip.indexOf('className="drag border-border flex h-9'), pip.indexOf('{src ? ('));
  assert.doesNotMatch(header, /animate-|LoaderCircle/);
  const pill = pip.slice(pip.indexOf("if (state.mode === 'pildora')"), pip.indexOf('const big'));
  assert.doesNotMatch(pill, /animate-|LoaderCircle/);
});

test('the live window keeps every action it had and only shows what it showed', () => {
  for (const a of ["act('normal')", "act('grande')", "act('pildora')", "act('cerrar')", "act('app')", "act('grabar')", "act('parar')"]) assert.ok(pip.includes(a), a);
  assert.match(pip, /act\(`point:\$\{f\[0\]\},\$\{f\[1\]\}`\)/);
  assert.match(pip, /state\.recording/);
  // only the project's name (the mock-up's badge, in the address bar) is new; never paths, files, messages or the folder
  assert.doesNotMatch(pip, /state\.(path|file|message|text|cwd)\b/);
  assert.equal((pip.match(/state\.project/g) ?? []).length, 3);
});

test('10C-a: the lock screen draws the theme backdrop blurred under its veil and never the app', () => {
  assert.match(locked, /<Scene \/>/);
  // the veil is its own layer and lets the pointer through, so the window's buttons (under it) keep working
  assert.match(locked, /pointer-events-none fixed inset-0 z-\[46\] bg-black\/32 backdrop-blur-\[10px\]/);
  assert.match(read('app.css'), /html:has\(\[data-testid="master-locked"\]\) \.win-controls \{ z-index: 45; \}/);
  assert.match(locked, /useBaseAppearance\(\)/);
  assert.match(master, /import \{ Scene \} from '@\/components\/scene\.jsx'/);
  // nothing of the app is mounted behind it
  assert.doesNotMatch(locked, /<Shell|<Sidebar|<ChatView|VIEWS\b/);
  assert.doesNotMatch(master, /from '@\/components\/sidebar/);
});
