// Orb UI 2.0, step 1A: six themes, six palettes and the migration of what an older orb.json stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SKINS, PALETTES, ACCENTS, CONTRASTS, APPEARANCE_DEFAULTS, plainSkin, robotSkin, darkOnlySkin, lightOnlySkin, phoneSkin, migrateAppearance } from '../src/shared/appearance.mjs';
import { loadConfig } from '../src/platform/config-file.mjs';
import { validateConfig } from '../src/platform/config.mjs';
import { paths } from '../src/platform/paths.mjs';
import es from '../src/shared/locales/es/settings.mjs';
import en from '../src/shared/locales/en/settings.mjs';

test('the lists and the helpers of the new model', () => {
  assert.deepEqual(SKINS, ['predeterminado', 'cristal', 'orb', 'vaporwave', 'candy', 'retro']);
  assert.deepEqual(PALETTES, ['grafito', 'oceano', 'bosque', 'uva', 'rubi', 'arena']);
  assert.equal(APPEARANCE_DEFAULTS.skin, 'predeterminado');
  assert.equal(APPEARANCE_DEFAULTS.palette, 'grafito');
  // legacy keys stay valid so an old orb.json is not rejected
  assert.ok(ACCENTS.includes('naranja') && CONTRASTS.includes('alto'));
  assert.deepEqual(SKINS.filter(plainSkin), ['predeterminado', 'cristal']);
  assert.deepEqual(SKINS.filter(robotSkin), ['orb']);
  assert.deepEqual(SKINS.filter(darkOnlySkin), ['retro']);
  assert.deepEqual(SKINS.filter(lightOnlySkin), ['cristal']);
  for (const skin of SKINS) assert.equal(phoneSkin(skin), skin === 'orb' ? 'orb' : 'predeterminado', skin);
  assert.equal(phoneSkin('profesional'), 'predeterminado');
  assert.equal(phoneSkin(undefined), 'predeterminado');
});

test('every theme and palette has a label in es and en, and the retired ones are gone', () => {
  for (const dict of [es, en]) {
    for (const id of SKINS) assert.ok(dict[`appearance.skin.${id}`], id);
    for (const id of PALETTES) assert.ok(dict[`appearance.palette.${id}`], id);
    for (const id of ['profesional', 'nube', 'paletas', 'grafito']) assert.equal(dict[`appearance.skin.${id}`], undefined, id);
    assert.equal(dict['appearance.palette.carbon'], undefined);
    assert.equal(dict['appearance.accent.tema'], undefined);
  }
  assert.equal(es['appearance.skin.candy'], 'Candy');
  assert.equal(en['appearance.skin.predeterminado'], 'Default');
  assert.equal(en['appearance.palette.rubi'], 'Ruby');
});

test('migrateAppearance: the theme', () => {
  const skin = (s) => migrateAppearance({ skin: s }).skin;
  assert.equal(skin('profesional'), 'predeterminado');
  assert.equal(skin('grafito'), 'predeterminado');
  assert.equal(skin('paletas'), 'predeterminado');
  assert.equal(skin('nube'), 'candy');
  for (const id of ['cristal', 'orb', 'vaporwave', 'retro', 'candy', 'predeterminado']) assert.equal(skin(id), id);
  assert.equal(skin('loquesea'), 'predeterminado');
  assert.equal(skin(null), 'predeterminado');
  assert.equal(skin(undefined), undefined);
  assert.ok(!('skin' in migrateAppearance({ font: 'inter' })));
});

test('migrateAppearance: the palette of the old «paletas» theme', () => {
  const pal = (palette, accent) => migrateAppearance({ skin: 'paletas', palette, ...(accent ? { accent } : {}) }).palette;
  for (const [accent, want] of Object.entries({ naranja: 'grafito', azul: 'oceano', turquesa: 'oceano', violeta: 'uva', verde: 'bosque', rosa: 'rubi' })) assert.equal(pal('arena', accent), want, accent);
  assert.equal(pal('arena', 'tema'), 'arena');
  const table = {
    grafito: ['carbon', 'nieve', 'tinta', 'pizarra', 'niebla', 'humo', 'plata'],
    oceano: ['hielo', 'oceano', 'marino', 'noche'],
    bosque: ['oliva', 'bosque', 'menta', 'jade', 'lima'],
    uva: ['ciruela', 'violeta', 'lavanda', 'mora'],
    rubi: ['rosa', 'cereza', 'coral'],
    arena: ['arena', 'trigo', 'cafe', 'cobre', 'sol']
  };
  for (const [want, olds] of Object.entries(table)) for (const old of olds) assert.equal(pal(old, 'tema'), want, old);
  assert.equal(pal('marino'), 'oceano', 'no accent stored');
  assert.equal(pal('nopaleta', 'tema'), 'grafito');
});

test('migrateAppearance: the palette of the other retired themes and of the rest', () => {
  for (const skin of ['profesional', 'grafito', 'nube']) assert.equal(migrateAppearance({ skin, palette: 'marino' }).palette, 'grafito', skin);
  for (const skin of ['profesional', 'grafito', 'nube']) assert.ok(!('palette' in migrateAppearance({ skin })), `${skin} without palette`);
  assert.equal(migrateAppearance({ skin: 'orb', palette: 'carbon' }).palette, 'grafito');
  assert.equal(migrateAppearance({ skin: 'cristal', palette: 'uva' }).palette, 'uva');
  assert.equal(migrateAppearance({ palette: 'rubi' }).palette, 'rubi');
});

test('migrateAppearance: pure, idempotent and keeps every other key', () => {
  const ui = { skin: 'paletas', palette: 'marino', accent: 'tema', contrast: 'alto', theme: 'oscuro', font: 'inter', density: 'compacta', music: { on: true, volume: 0.4 } };
  const frozen = structuredClone(ui);
  const out = migrateAppearance(ui);
  assert.deepEqual(ui, frozen, 'the input is not mutated');
  assert.notEqual(out, ui);
  assert.deepEqual(out, { ...frozen, skin: 'predeterminado', palette: 'oceano' });
  assert.deepEqual(migrateAppearance(out), out);
  for (const old of ['profesional', 'nube', 'grafito', 'loquesea', 'orb']) { const once = migrateAppearance({ skin: old, palette: 'coral', accent: 'azul' }); assert.deepEqual(migrateAppearance(once), once, old); }
  for (const bad of [undefined, null, 'x', 3, [1]]) assert.equal(migrateAppearance(bad), bad);
});

function homeWith(config) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-temas-388-'));
  const file = paths(home).config;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config));
  return home;
}

test('an orb.json of the previous version with the «paletas» theme starts clean and keeps every other setting', () => {
  const home = homeWith({ language: 'en', maxParallel: 3, ui: { skin: 'paletas', palette: 'marino', accent: 'tema', contrast: 'alto', theme: 'oscuro', font: 'inter', music: { on: true, volume: 0.4 } } });
  try {
    const c = loadConfig(home);
    assert.doesNotThrow(() => validateConfig(c));
    assert.equal(c.ui.skin, 'predeterminado');
    assert.equal(c.ui.palette, 'oceano');
    assert.equal(c.ui.accent, 'tema');
    assert.equal(c.ui.contrast, 'alto');
    assert.equal(c.ui.theme, 'oscuro');
    assert.equal(c.ui.font, 'inter');
    assert.deepEqual(c.ui.music, { on: true, volume: 0.4 });
    assert.equal(c.language, 'en');
    assert.equal(c.maxParallel, 3);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('an orb.json with a theme nobody knows, or a retired one, still loads', () => {
  for (const [skin, want] of [['loquesea', 'predeterminado'], ['nube', 'candy'], ['profesional', 'predeterminado'], ['grafito', 'predeterminado']]) {
    const home = homeWith({ ui: { skin, palette: 'carbon', font: 'geist' } });
    try {
      const c = loadConfig(home);
      assert.doesNotThrow(() => validateConfig(c), skin);
      assert.equal(c.ui.skin, want, skin);
      assert.equal(c.ui.palette, 'grafito', skin);
      assert.equal(c.ui.font, 'geist');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }
});

test('validateConfig stays strict with what the interface writes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-temas-388-'));
  try {
    const c = loadConfig(home);
    for (const bad of [{ skin: 'profesional' }, { skin: 'nube' }, { palette: 'carbon' }, { palette: 'marino' }]) assert.throws(() => validateConfig({ ...c, ui: { ...c.ui, ...bad } }), /ui\./, JSON.stringify(bad));
    for (const skin of SKINS) assert.doesNotThrow(() => validateConfig({ ...c, ui: { ...c.ui, skin } }), skin);
    for (const palette of PALETTES) assert.doesNotThrow(() => validateConfig({ ...c, ui: { ...c.ui, palette } }), palette);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// ---- Step 1B: the CSS of the tokens and the themes ----
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = path.join(ROOT, 'src', 'ui');
const readUi = (...p) => fs.readFileSync(path.join(UI, ...p), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const cssFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : cssFiles(path.join(dir, e.name))) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []));
const skinsCss = readUi('themes', 'skins.css');
const tokensCss = readUi('tokens.css');

// [selector, body] of every plain rule (the innermost braces; an @media only wraps them).
const rulesOf = (css) => [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
const declsOf = (body) => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*(oklch\([^)]*\))\s*(?=;|$)/g)].map((m) => [m[1], m[2]]));
const varsIn = (css) => new Set([...stripComments(css).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

test('tokens.css keeps every variable it had and adds the new ones', () => {
  const before = varsIn(execFileSync('git', ['show', 'HEAD:src/ui/tokens.css'], { cwd: ROOT, encoding: 'utf8' }));
  const now = varsIn(tokensCss);
  for (const v of before) assert.ok(now.has(v), `${v} is gone`);
  for (const v of ['--r-ctl', '--r-card', '--r-big', '--r-full', '--ctl', '--ctl-sm', '--shadow', '--title']) assert.ok(now.has(v), `${v} is missing`);
  assert.match(tokensCss, /--radius: 10px;/);
  for (const [n, v] of [['ctl', 'r-ctl'], ['card', 'r-card'], ['big', 'r-big']]) assert.match(tokensCss, new RegExp(`--radius-${n}: var\\(--${v}\\);`));
  // every theme gets the compact scale: only the pointer decides
  assert.match(tokensCss, /@custom-variant compact \{ @media \(pointer: fine\) \{ @slot; \} \}/);
  assert.doesNotMatch(stripComments(tokensCss), /data-skin/);
});

test('every theme and every palette of appearance.mjs has its block, light and dark', () => {
  const rules = rulesOf(skinsCss).flatMap(([sel, body]) => sel.split(',').map((s) => [s.trim(), body]));
  const has = (selector) => rules.some(([s]) => s === selector);
  for (const skin of SKINS) {
    if (skin === 'predeterminado') { assert.ok(!has('html[data-skin="predeterminado"]'), 'the default theme is the base: no rules'); continue; }
    assert.ok(has(`html[data-skin="${skin}"]`), `${skin}`);
    if (skin === 'cristal' || skin === 'retro') assert.ok(!has(`html.dark[data-skin="${skin}"]`), `${skin} has one mode only`);
    else assert.ok(has(`html.dark[data-skin="${skin}"]`), `${skin} dark`);
  }
  for (const palette of PALETTES) {
    if (palette === 'grafito') { assert.ok(!has('html[data-palette="grafito"]'), 'grafito is the base'); continue; }
    assert.ok(has(`html[data-palette="${palette}"]`), palette);
    assert.ok(has(`html.dark[data-palette="${palette}"]`), `${palette} dark`);
  }
});

test('no stylesheet of the interface names a retired theme or the old material', () => {
  const files = cssFiles(UI);
  assert.ok(files.length >= 8);
  for (const file of files) {
    for (const [selector] of rulesOf(fs.readFileSync(file, 'utf8'))) {
      assert.doesNotMatch(selector, /profesional|nube|paletas|data-material/, `${path.relative(ROOT, file)}: ${selector}`);
      assert.doesNotMatch(selector, /data-skin(-preview)?="grafito"/, `${path.relative(ROOT, file)}: ${selector}`);
    }
  }
  assert.ok(!fs.existsSync(path.join(UI, 'themes', 'scene-nube.css')));
  assert.doesNotMatch(readUi('themes.css'), /scene-nube/);
  for (const file of ['components/skin-preview.jsx', 'components/scene.jsx']) assert.doesNotMatch(readUi(...file.split('/')), /nube|profesional/i, file);
});

test('no theme rule switches off the animations or the sounds: those are settings of the user', () => {
  // the system's own «reduce motion» setting is not a theme rule
  const withoutSystemSetting = (css) => css.replace(/@media \(prefers-reduced-motion: reduce\) \{[^{}]*\{[^{}]*\}\s*\}/g, '');
  for (const css of [skinsCss, readUi('app.css')].map(withoutSystemSetting)) {
    for (const [selector, body] of rulesOf(css)) {
      if (!/data-skin/.test(selector)) continue;
      assert.doesNotMatch(body, /animation(-name)?:\s*none|transition-duration:\s*0s/, selector);
    }
  }
});

// ---- The backdrops: one WebGL canvas per window (lib/shaders.js, mounted by components/scene.jsx). ----
test('every theme with a background has its shader, and the module keeps it cheap', () => {
  const src = readUi('lib', 'shaders.js');
  for (const skin of SKINS.filter((s) => s !== 'predeterminado')) {
    assert.match(src, new RegExp(`^  ${skin}: HEAD \\+ `, 'm'), `${skin} has its fragment shader`);
  }
  assert.doesNotMatch(src, /^  predeterminado: /m, 'the default theme has no background');
  assert.match(src, /const SCALE = 0\.5;/, 'half resolution');
  assert.match(src, /const FRAME_MS = 33;/, 'at most 30 frames a second');
  assert.match(src, /document\.hidden/, 'nothing runs while the window is hidden');
  assert.match(src, /visibilitychange/);
  assert.match(src, /prefers-reduced-motion: reduce/, 'reduced motion: one still frame');
  assert.match(src, /dataset\.motion === 'minima'/, '«animations off»: one still frame');
  assert.match(src, /classList\.contains\('dark'\)/, 'the dark uniform follows html.dark');
  assert.match(src, /webglcontextlost/); assert.match(src, /webglcontextrestored/);
  assert.match(src, /stop\(\) \{/); assert.match(src, /deleteProgram/); assert.match(src, /deleteBuffer/);
  assert.doesNotMatch(src, /getBoundingClientRect|offsetWidth|clientWidth[^;]*frame/, 'no layout reads per frame');
});

test('the scene mounts one canvas per window, nothing in the default theme, and the shader follows the theme', () => {
  const scene = readUi('components', 'scene.jsx');
  assert.match(scene, /hasShader\(skin\)/);
  assert.match(scene, /if \(!on\) return null;/);
  assert.match(scene, /aria-hidden="true"/);
  assert.match(scene, /<canvas key=\{skin\}/, 'a theme change replaces the canvas without a reload');
  assert.match(scene, /skin === 'retro' \? <div className="crt"/);
  const main = readUi('main.jsx');
  assert.equal([...main.matchAll(/<Scene \/>/g)].length, 2, 'the desktop shell and the phone shell');
  assert.match(skinsCss, /^\.orb-shader \{[^}]*pointer-events: none[^}]*contain: strict/m);
  assert.match(skinsCss, /^\.crt \{[^}]*pointer-events: none/m);
});

test('the columns let the shader through with the veil of the design', () => {
  assert.match(skinsCss, /main\.theme-scene \{ background: color-mix\(in oklab, var\(--background\) var\(--veil\), transparent\); \}/);
  assert.match(skinsCss, /aside\.bg-sidebar \{ background-color: color-mix\(in oklab, var\(--sidebar\) var\(--veil-side\), transparent\); backdrop-filter: blur\(14px\)/);
  assert.match(skinsCss, /\[data-testid="turn-changes"\], \[data-testid="chat-tabs"\]\) \{ background: color-mix\(in oklab, var\(--background\) var\(--veil-side\), transparent\); backdrop-filter: blur\(14px\)/);
});

test('the old CSS backdrops are gone: no scene stylesheet, no import, no pixel fonts nobody uses', () => {
  const themes = path.join(UI, 'themes');
  assert.deepEqual(fs.readdirSync(themes).filter((f) => /^scene/.test(f)), []);
  assert.doesNotMatch(readUi('themes.css'), /@import[^;]*scene/);
  assert.doesNotMatch(readUi('themes.css'), /tiny5|silkscreen/);
  for (const file of cssFiles(UI)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /@import[^;]*scene|\.scene-|\.rt-column|\.vw-sticker|\.orb-cloud|brand-sky::/, path.relative(ROOT, file));
});

// ---- Contrast (WCAG AA). oklch -> linear sRGB, the chroma reduced until it fits the gamut as CSS does. ----
function toRgb(L, C, H) {
  const lin = (c) => {
    const h = (H * Math.PI) / 180, a = c * Math.cos(h), b = c * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  };
  const fits = (v) => v.every((x) => x >= -0.0005 && x <= 1.0005);
  let c = C;
  if (!fits(lin(c))) { let lo = 0, hi = C; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(lin(mid))) lo = mid; else hi = mid; } c = lo; }
  return lin(c).map((x) => Math.min(1, Math.max(0, x)));
}
const rgbOf = (value) => { const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(value); assert.ok(m, value); return { rgb: toRgb(+m[1], +m[2], +m[3]), a: m[4] ? +m[4] : 1 }; };
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };

// What the browser computes for the tokens of a theme: the base, then (in the order of the cascade) the palette and the theme.
const blocks = {};
for (const [selector, body] of [...rulesOf(tokensCss), ...rulesOf(skinsCss)]) {
  for (const s of selector.split(',').map((x) => x.trim())) {
    if (/^(:root|\.dark|html(\.dark)?\[data-(skin|palette)="\w+"\])$/.test(s)) blocks[s] = { ...blocks[s], ...declsOf(body) };
  }
}
function tokensOf({ skin, palette, dark }) {
  const t = { ...blocks[':root'] };
  if (dark) Object.assign(t, blocks['.dark']);
  const layers = [];
  if (palette && palette !== 'grafito') layers.push(`[data-palette="${palette}"]`);
  if (skin !== 'predeterminado') layers.push(`[data-skin="${skin}"]`);
  for (const l of layers) Object.assign(t, blocks[`html${l}`]); // a light block outranks the base .dark
  if (dark) for (const l of layers) Object.assign(t, blocks[`html.dark${l}`]);
  return t;
}
const PAIRS = [['--foreground', '--background'], ['--foreground', '--card'], ['--muted-foreground', '--background'], ['--muted-foreground', '--card']];
// Pairs of the mockup's own values that do not reach 4.5:1 are left out on purpose (not changed); the step's report lists them.
// Key: «theme[+palette]/mode token on token».
const OUT_OF_AA = new Set([]);
const combos = [];
for (const skin of SKINS) {
  const modes = skin === 'retro' ? [true] : skin === 'cristal' ? [false] : [false, true];
  const palettes = skin === 'predeterminado' || skin === 'cristal' ? PALETTES : [undefined];
  for (const palette of palettes) for (const dark of modes) combos.push({ skin, palette, dark });
}

test('contrast AA: --foreground and --muted-foreground on --background and --card, in every theme and palette', () => {
  const failed = [];
  assert.equal(combos.length, 25, '12 default + 6 glass (with their palettes), Orb, Vaporwave and Candy by day and night, and Retro');
  let lowest = 99;
  for (const combo of combos) {
    const t = tokensOf(combo);
    for (const [fg, bg] of PAIRS) {
      const key = `${combo.skin}${combo.palette ? `+${combo.palette}` : ''}/${combo.dark ? 'dark' : 'light'} ${fg} on ${bg}`;
      const f = rgbOf(t[fg]), b = rgbOf(t[bg]);
      assert.equal(b.a, 1, `${key}: opaque background`);
      const r = ratio(f.rgb, b.rgb);
      lowest = Math.min(lowest, r);
      if (r < 4.5 && !OUT_OF_AA.has(key)) failed.push(`${key}: ${r.toFixed(2)}`);
    }
  }
  if (process.env.TEMAS_RATIOS) console.log('lowest ratio', lowest.toFixed(2));
  assert.deepEqual(failed, []);
});
