// The «Grafito» theme: Profesional in near-monochrome graphite, built the same way as Cristal (data-skin="profesional" +
// data-material="grafito"). Registered after the existing ids, offered in the picker with its own preview, and its
// opaque tokens keep the text readable (WCAG AA) in light and dark. The CSS is read as source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKINS, baseSkin, plainSkin, phoneSkin } from '../src/shared/appearance.mjs';
import { phoneConfig } from '../src/engine/transport/remote.mjs';
import es from '../src/shared/locales/es/settings.mjs';
import en from '../src/shared/locales/en/settings.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');
const themes = ['skins', 'scene', 'scene-vaporwave', 'scene-retro', 'scene-nube'].map((n) => read('themes', `${n}.css`)).join('');
const start = themes.indexOf('GRAFITO: Profesional in near-monochrome');
const section = themes.slice(start, themes.indexOf('/* ====', start + 20) === -1 ? undefined : themes.indexOf('/* ====', themes.indexOf('*/', start)));

test('Grafito is registered after the existing themes, on top of Profesional', () => {
  assert.deepEqual(SKINS, ['orb', 'vaporwave', 'retro', 'profesional', 'nube', 'cristal', 'grafito']);
  assert.equal(baseSkin('grafito'), 'profesional');
  assert.ok(plainSkin('grafito'));
  assert.equal(es['appearance.skin.grafito'], 'Grafito');
  assert.equal(en['appearance.skin.grafito'], 'Graphite');
  assert.match(read('components', 'skin-preview.jsx'), /grafito: null/);
  assert.match(read('components', 'skin-preview.css'), /\.skp\[data-skin-preview="grafito"\]/);
  assert.match(read('components', 'skin-preview.css'), /\.dark \.skp\[data-skin-preview="grafito"\]/);
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts', 'medir-animaciones.mjs'), 'utf8'), /cristal,grafito/);
});

test('Grafito leaves Profesional and Cristal untouched and adds no motion', () => {
  const pro = themes.slice(themes.indexOf('PROFESIONAL: plain and sober'), themes.indexOf('CRISTAL (3.8.2)'));
  assert.doesNotMatch(pro, /grafito/i);
  assert.doesNotMatch(themes.slice(themes.indexOf('CRISTAL (3.8.2)'), start), /grafito/i);
  assert.ok(section.includes('data-material="grafito"'));
  assert.doesNotMatch(section.replace(/\/\*[\s\S]*?\*\//g, ''), /animation|transition|@keyframes|will-change|backdrop-filter/);
});

test('Grafito keeps the composer structure: only radius, border and shadow change', () => {
  const rules = [...section.matchAll(/\[data-slot="composer"\][^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rules.length >= 3);
  for (const body of rules) for (const prop of body.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean)) assert.ok(['border-radius', 'border-color', 'box-shadow'].includes(prop), prop);
});

// ---- Contrast (oklch → sRGB with Björn Ottosson's OKLab), all tokens opaque. ----
function oklch(text) {
  const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(text);
  assert.ok(m, `not an oklch colour: ${text}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(H); const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
  const gamma = (x) => { const v = Math.min(1, Math.max(0, x)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
  return lin.map(gamma);
}
const luminance = (rgb) => { const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (x, y) => { const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
function tokens(selector) {
  const at = section.indexOf(`${selector} {`);
  assert.ok(at >= 0, selector);
  const body = section.slice(at, section.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+): (oklch\([^)]+\))/g)].map((m) => [m[1], oklch(m[2])]));
}

for (const [mode, selector] of [['light', 'html[data-material="grafito"]'], ['dark', 'html.dark[data-material="grafito"]']]) {
  test(`Grafito keeps WCAG AA contrast in ${mode} mode`, () => {
    const t = { ...tokens('html[data-material="grafito"]'), ...tokens(selector) };
    const pairs = {
      text: [t.background, t.foreground], 'text on a card': [t.card, t['card-foreground']], 'text on a menu': [t.popover, t['popover-foreground']],
      'text on the sidebar': [t.sidebar, t.foreground], 'text on the selection': [t.accent, t['accent-foreground']], 'text on secondary': [t.secondary, t['secondary-foreground']],
      'user bubble': [t.bubble, t['bubble-foreground']], 'primary button': [t.primary, t['primary-foreground']],
      'muted text': [t.background, t['muted-foreground']], 'muted text on a card': [t.card, t['muted-foreground']], 'muted text on muted': [t.muted, t['muted-foreground']],
      'faint text on a card': [t.card, t['faint-foreground']], 'faint text on the page': [t.background, t['faint-foreground']], 'faint text on the sidebar': [t.sidebar, t['faint-foreground']],
      'primary text on a card': [t.card, t['primary-text']], 'primary text on its fill': [t['primary-soft'], t['primary-text']],
      'success on its fill': [t['success-soft'], t.success], 'destructive on its fill': [t['destructive-soft'], t.destructive], 'warning on its fill': [t['warning-soft'], t.warning],
      'warning ink on the page': [t.background, t['warning-ink']], 'warning ink on a card': [t.card, t['warning-ink']], 'warning ink on its fill': [t['warning-soft'], t['warning-ink']],
      'success on a card': [t.card, t.success], 'destructive on a card': [t.card, t.destructive], 'info on a card': [t.card, t.info]
    };
    for (const [name, [bg, fg]] of Object.entries(pairs)) assert.ok(ratio(bg, fg) >= 4.5, `${mode} ${name}: ${ratio(bg, fg).toFixed(2)}`);
    assert.ok(ratio(t.card, t.input) >= 3, `${mode} input border: ${ratio(t.card, t.input).toFixed(2)}`);
    assert.ok(ratio(t.background, t.input) >= 3, `${mode} input border on the page: ${ratio(t.background, t.input).toFixed(2)}`);
  });
}

test('the music is silent in every plain theme and stops when one is chosen', () => {
  const music = read('lib', 'music.js');
  assert.match(music, /export const available = \(\) => platformOk\(\) && !plainSkin\(ui\(\)\.skin\);/);
  assert.match(music, /export function stopIfPlain\(\) \{\s*if \(available\(\)\) return;/);
  assert.match(music, /onAppearance\(\(\) => stopIfPlain\(\)\);/);
  assert.match(read('lib', 'store.js'), /for \(const fn of appearanceListeners\) fn\(skin\);/);
  for (const skin of SKINS) assert.equal(plainSkin(skin) ? 'silent' : 'music', ['profesional', 'cristal', 'grafito'].includes(skin) ? 'silent' : 'music', skin);
});

test('the phone may wear Grafito, which reaches it with the PC settings, and nothing else but the default', () => {
  assert.equal(phoneSkin('grafito'), 'grafito');
  assert.equal(phoneSkin('orb'), 'orb');
  for (const skin of ['vaporwave', 'retro', 'profesional', 'nube', 'cristal', 'nope', undefined]) assert.equal(phoneSkin(skin), SKINS[0], String(skin));
  assert.equal(phoneConfig({ ui: { skin: 'grafito', theme: 'oscuro' } }).ui.skin, 'grafito', 'ui.skin travels in the settings of a phone');
  const store = read('lib', 'store.js');
  assert.match(store, /const skinOf = \(skin\) => \{[^}]*fullPc\(\) \? id : phoneSkin\(id\)/);
  assert.match(store, /const skin = skinOf\(ui\.skin\);/);
  assert.match(store, /baseSkin\(skinOf\(s\.app\?\.config\?\.ui\?\.skin\)\)/);
  assert.ok(plainSkin(phoneSkin('grafito')), 'no decorative motion on the phone');
});
