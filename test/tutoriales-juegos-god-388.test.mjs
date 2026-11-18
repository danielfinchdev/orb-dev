// Tutoriales, Juegos y God mode follow the approved mock-up (12, 13, 14): the help texts speak of the six themes and
// palettes of today, the games keep the interfaces the Android app shares, `primary` is no longer an accent in the games
// and no test id of the old views disappears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const head = (p) => execFileSync('git', ['show', `HEAD:${p}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
const ids = (src) => new Set([...src.matchAll(/data-testid=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map((m) => m[1] ?? `\`${m[2].replace(/\$\{[^}]*\}/g, '${}')}\``));

// themes and palettes of before the UI 2.0
const RETIRED = [/Profesional/i, /Professional/i, /\bNube\b/, /\bCloud\b/, /\bGrafito\b.*\bNube\b/, /Por defecto,? Vaporwave/, /Default,? Vaporwave/];

test('help texts (es and en) and tutorials.jsx name no retired theme', async () => {
  for (const lang of ['es', 'en']) {
    const src = read(`src/shared/locales/${lang}/help.mjs`);
    for (const re of RETIRED) assert.doesNotMatch(src, re, `${lang}/help.mjs ${re}`);
  }
  const view = read('src/ui/views/tutorials.jsx');
  for (const re of RETIRED) assert.doesNotMatch(view, re, `tutorials.jsx ${re}`);
});

test('the appearance guide lists the six themes and the six palettes', async () => {
  const es = (await import(new URL('src/shared/locales/es/help.mjs', root))).default;
  const en = (await import(new URL('src/shared/locales/en/help.mjs', root))).default;
  for (const name of ['Predeterminado', 'Cristal', 'Orb', 'Vaporwave', 'Candy', 'Retro']) assert.ok(es['help.tut.looks.l1'].includes(name), `es ${name}`);
  for (const name of ['Default', 'Glass', 'Orb', 'Vaporwave', 'Candy', 'Retro']) assert.ok(en['help.tut.looks.l1'].includes(name), `en ${name}`);
  for (const name of ['Grafito', 'Océano', 'Bosque', 'Uva', 'Rubí', 'Arena']) assert.ok(es['help.tut.looks.l2'].includes(name), `es ${name}`);
  assert.match(es['help.faq.10.a'], /tema Orb/);
  assert.match(en['help.faq.10.a'], /Orb theme/);
  // the guides that talk about Settings use the sections of today
  assert.match(es['help.tut.phone.l1'], /Ajustes › Dispositivos/);
  assert.match(es['help.tut.logs.title'], /Bitácoras/);
});

test('the games use no `primary` as an accent class', () => {
  for (const f of fs.readdirSync(new URL('src/ui/games/', root)).filter((n) => n.endsWith('.jsx'))) {
    const src = read(`src/ui/games/${f}`);
    assert.doesNotMatch(src, /(?:^|[\s"'`:])(?:text|border|ring|from|via|to)-primary(?![-\w])/m, `${f}: text/border/ring/gradient primary`);
    assert.doesNotMatch(src, /\bbg-primary\/\d+/, `${f}: bg-primary/NN`);
    assert.doesNotMatch(src, /hover:border-primary/, `${f}: hover:border-primary`);
  }
});

test('kit.js, sfx.js and thumbs.jsx export what they did (the Android app shares them)', () => {
  const names = (src) => [...src.matchAll(/^export\s+(?:async\s+)?(?:const|function\*?|class|let|var)\s+(\w+)/gm)].map((m) => m[1]).sort();
  for (const f of ['kit.js', 'sfx.js', 'thumbs.jsx']) {
    const path = `src/ui/games/${f}`;
    assert.deepEqual(names(read(path)), names(head(path)), f);
    // and their signatures: the whole export line stays the same
    const sig = (src) => src.split('\n').filter((l) => /^export\s/.test(l)).map((l) => l.replace(/\s*\{\s*$/, '').trim());
    assert.deepEqual(sig(read(path)), sig(head(path)), `${f} signatures`);
  }
});

test('no test id of the old views disappears', () => {
  for (const f of ['src/ui/views/tutorials.jsx', 'src/ui/views/expert.jsx', 'src/ui/games/games.jsx']) {
    const now = ids(read(f));
    for (const id of ids(head(f))) {
      // God mode's panels got their ids written out (it was one `testid` prop)
      if (f.endsWith('expert.jsx') && id === '{testid}') continue;
      assert.ok(now.has(id), `${f}: ${id}`);
    }
  }
  const expert = read('src/ui/views/expert.jsx');
  for (const id of ['panel-explorer', 'panel-git', 'panel-history', 'panel-running', 'panel-usage', 'panel-system', 'panel-activity']) assert.ok(expert.includes(`"${id}"`), id);
});

test('God mode keeps its exports and the calls it makes', () => {
  const now = read('src/ui/views/expert.jsx');
  const before = head('src/ui/views/expert.jsx');
  for (const name of ['PANELS', 'savePanels', 'ExpertView']) assert.match(now, new RegExp(`export (?:const|async function|function) ${name}\\b`));
  const calls = (src) => new Set([...src.matchAll(/call\('([\w.]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...calls(now)].sort(), [...calls(before)].sort());
  // the PC-only guard stays (the phone never gets the tree, the files or git)
  assert.match(now, /if \(bridge\.mobile\) return/);
});

test('the record celebration stays in the games dialog (spark, robot only with the Orb theme, reduced motion)', () => {
  const src = read('src/ui/games/games.jsx');
  assert.ok(src.includes('robotSkin(skin) ? <OrbMark'));
  assert.match(src, /<Sparkles/);
  assert.match(src, /motion-reduce:animate-none/);
  assert.match(src, /data-motion=minima/);
  assert.match(src, /game-record/);
});

test('9C-a Tutoriales: the guides use the icons of the mock-up and the tour card has its line heights', () => {
  const view = read('src/ui/views/tutorials.jsx');
  for (const [id, icon] of [['newchat', 'MessagesSquare'], ['tasks', 'ListChecks'], ['sidebar', 'PanelLeft'], ['board', 'PencilRuler'], ['agents', 'Bot'], ['schedules', 'CalendarClock']]) {
    assert.ok(new RegExp(`${id}: \{ icon: ${icon},`).test(view), `${id} → ${icon}`);
  }
  assert.match(view, /<section className="mt-1 grid gap-1\.5">/);
  assert.match(view, /text-card-title leading-\[1\.45\] font-semibold">\{t\('help\.replayTitle'\)/);
});

test('9C-a Juegos: the game dialog is 560 wide, centred, with the board scaled to 362 by CSS only', () => {
  const src = read('src/ui/games/games.jsx');
  assert.match(src, /w-\[min\(560px,96vw\)\]/);
  assert.match(src, /game && 'text-center leading-\[1\.45\]'/);
  assert.match(src, /game && 'py-1\.5'/, 'the body keeps the 18 px of the design above and below the board');
  assert.match(src, /game \? 'justify-center' : 'justify-between'/);
  assert.match(src, /\[&_canvas\]:h-auto! \[&_canvas\]:max-w-\[362px\]/);
  assert.match(src, /text-2xl leading-\[1\.45\] font-semibold/, 'score cards of 82 px');
});

test('9C-a God mode: file search, project as plain text with its dot, panels menu of 300 px', () => {
  const src = read('src/ui/views/expert.jsx');
  assert.match(src, /data-testid="expert-file-search"/);
  assert.match(src, /filter=\{fileQuery\}/);
  assert.match(src, /border-transparent bg-transparent/);
  assert.match(src, /icon: <ProjectIcon name=\{p\.name\} small \/>/);
  assert.match(src, /DropdownMenuContent align="end" className="w-75"/);
  assert.doesNotMatch(src, /new file|file-plus|Nuevo archivo/i, 'Orb cannot create files: no «+»');
  for (const lang of ['es', 'en']) assert.match(read(`src/shared/locales/${lang}/expert.mjs`), /'expert\.searchFiles'/);
});

test('10C-b God mode: the diff is one card per hunk, the path bar says what is known and git shows lines and the base', () => {
  const src = read('src/ui/views/expert.jsx');
  assert.match(src, /import \{ PatchView \} from '@\/components\/patch-view\.jsx'/);
  assert.match(src, /<PatchView key=\{i\} text=\{b\.patch\} path=\{b\.path\} name=\{b\.path\} bodyClass="max-h-none" \/>/);
  assert.match(src, /data-testid="expert-diff"/);
  assert.match(src, /data-testid="expert-status"/);
  assert.doesNotMatch(src, /UTF-8|Ln \d|Col \d/, 'no encoding nor cursor: the viewer is read-only');
  assert.match(src, /st\.upstream \? 'expert\.aheadOf' : 'expert\.ahead'/);
  assert.match(src, /f\.add != null \? <span/);
  assert.doesNotMatch(src, /type="checkbox"|<Checkbox/, 'no commit checkbox: God mode does not commit');
  const patch = read('src/ui/components/patch-view.jsx');
  assert.match(patch, /bodyClass = 'max-h-96'/, 'the tab Cambios of the tasks keeps its 24 rem');
  for (const l of ['es', 'en']) { const s = read(`src/shared/locales/${l}/expert.mjs`); for (const k of ['aheadOf', 'behindOf', 'lines']) assert.match(s, new RegExp(`'expert\.${k}'`)); }
});

test('10C-b Serpiente: the flat board of Predeterminado, the other themes keep their drawing', () => {
  const snake = read('src/ui/games/snake.jsx');
  assert.match(snake, /if \(p\.skin === 'predeterminado'\) \{ paintFlat\(ctx, s, p, points\(s, t\)\); return; \}/);
  assert.match(snake, /backdrop\(ctx, SIZE, SIZE, p, \{ grid: CELL \}\)/, 'the glossy drawing stays for the rest');
  assert.match(snake, /--destructive/); assert.match(snake, /--primary-text/);
  assert.doesNotMatch(snake, /SPEED = \{ facil: 150, normal: 105, dificil: 70 \}[^;]*;[\s\S]*SPEED = /);
  assert.match(snake, /const N = 20; const CELL = 21;/, 'the logical grid is untouched');
});

test('11D: the snake blocks fill their cell and the patch lines wear the soft green and red of the mock-up', () => {
  const snake = read('src/ui/games/snake.jsx');
  assert.match(snake, /ctx\.roundRect\(pts\[i\]\[0\] - CELL \/ 2, pts\[i\]\[1\] - CELL \/ 2, CELL, CELL, 5\)/);
  const css = read('src/ui/app.css');
  assert.match(css, /\.diff\[data-testid="patch-view"\] \.code-add \{ background: color-mix\(in oklab, var\(--success\) 12%, transparent\); \}/);
  assert.match(css, /\.diff\[data-testid="patch-view"\] \.code-del \{ background: color-mix\(in oklab, var\(--destructive\) 10%, transparent\); \}/);
});
