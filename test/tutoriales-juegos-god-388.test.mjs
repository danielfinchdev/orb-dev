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
