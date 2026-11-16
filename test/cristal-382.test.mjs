// 3.8.2, phase 6 (item 14): the «Cristal» theme. It is Profesional plus a glass material: registered in appearance.mjs
// with its base, put on <html> as data-skin="profesional" + data-material="cristal", offered in Ajustes › Apariencia
// with its own preview, and its tokens keep the text readable (WCAG AA) on every surface over the brightest and the
// darkest point of its colour field, in light and dark. The CSS is read as source.
import { test } from 'node:test';
import { settingsSource } from './helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKINS, baseSkin, plainSkin } from '../src/shared/appearance.mjs';
import es from '../src/shared/locales/es/settings.mjs';
import en from '../src/shared/locales/en/settings.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');
// themes.css only imports the parts in themes/, in cascade order.
const themes = ['skins', 'scene', 'scene-vaporwave', 'scene-retro', 'scene-nube'].map((n) => read('themes', `${n}.css`)).join('');

test('Cristal is registered as a theme built on Profesional', () => {
  assert.ok(SKINS.includes('cristal'));
  assert.equal(SKINS[0], 'orb', 'the default theme does not change');
  assert.equal(baseSkin('cristal'), 'profesional');
  assert.equal(baseSkin('nube'), 'nube');
  assert.ok(plainSkin('cristal') && plainSkin('profesional') && !plainSkin('orb'));
  assert.equal(es['appearance.skin.cristal'], 'Cristal');
  assert.equal(en['appearance.skin.cristal'], 'Glass');
  // On <html>: the base's data-skin (every rule of Profesional applies) and its own data-material.
  const store = read('lib', 'store.js');
  assert.match(store, /root\.skin = baseSkin\(skin\);/);
  assert.match(store, /if \(skin !== root\.skin\) root\.material = skin; else delete root\.material;/);
  // Its preview in the picker.
  assert.match(read('components', 'skin-preview.jsx'), /cristal: null/);
  assert.match(read('components', 'skin-preview.css'), /\.skp\[data-skin-preview="cristal"\]/);
  // No robot, no scene, no companion: the same checks as Profesional.
  for (const f of [['components', 'robot.jsx'], ['components', 'scene.jsx'], ['components', 'companion.jsx']]) assert.match(read(...f), /plainSkin\(/, f.join('/'));
  assert.match(settingsSource(), /plainSkin\(/, 'views/settings');
});

test('Profesional is left as it was', () => {
  const start = themes.indexOf('PROFESIONAL: plain and sober');
  const end = themes.indexOf('CRISTAL (3.8.2)');
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(themes.slice(start, end), /cristal/i);
});

// The Cristal section of themes.css.
const section = themes.slice(themes.indexOf('CRISTAL (3.8.2)'), themes.indexOf('/* ====', themes.indexOf('CRISTAL (3.8.2)') + 20));

test('Cristal blurs only a few large surfaces and has no motion of its own', () => {
  const blurred = [...section.matchAll(/([^{}\n]+)\{[^}]*backdrop-filter: var\(--cr-blur\)/g)].map((m) => m[1].trim());
  assert.deepEqual(blurred, [
    'html[data-material="cristal"] aside.bg-sidebar::before',
    'html[data-material="cristal"] .chat-bar',
    'html[data-material="cristal"] [data-slot="composer"]',
    'html[data-material="cristal"] :is([data-slot="menu-content"], [data-slot="select-content"], [data-slot="dialog-content"])'
  ]);
  assert.doesNotMatch(section.slice(section.indexOf('*/') + 2).replace(/\/\*[\s\S]*?\*\//g, ''), /animation|transition|@keyframes|will-change/);
  assert.match(section, /prefers-reduced-transparency: reduce/);
});

// ---- Contrast. oklch → sRGB (Björn Ottosson's OKLab), alpha compositing in sRGB as the browser does. ----
function oklch(text) {
  const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(text);
  assert.ok(m, `not an oklch colour: ${text}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(H); const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
  const gamma = (x) => { const v = Math.min(1, Math.max(0, x)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
  return { rgb: lin.map(gamma), alpha: m[4] === undefined ? 1 : Number(m[4]) };
}
const over = (top, under) => ({ rgb: top.rgb.map((c, i) => c * top.alpha + under.rgb[i] * (1 - top.alpha)), alpha: 1 });
const luminance = ({ rgb }) => { const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (x, y) => { const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
function tokens(selector, source = section) {
  const at = source.indexOf(`${selector} {`);
  assert.ok(at >= 0, selector);
  const body = source.slice(at, source.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+): (oklch\([^)]+\))/g)].map((m) => [m[1], oklch(m[2])]));
}

for (const [mode, selector] of [['light', 'html[data-material="cristal"]'], ['dark', 'html.dark[data-material="cristal"]']]) {
  test(`Cristal keeps WCAG AA contrast in ${mode} mode`, () => {
    const t = tokens(selector);
    // What can be behind a surface: the field's base and each of its colour pools at full strength.
    const field = ['cr-base', 'cr-pool-1', 'cr-pool-2', 'cr-pool-3', 'cr-pool-4'].map((k) => t[k]);
    for (const ground of field) {
      const sidebar = over(t.sidebar, ground);
      const card = over(t.card, ground);
      const surfaces = {
        page: [ground, t.foreground], card: [card, t['card-foreground']], popover: [over(t.popover, ground), t['popover-foreground']],
        sidebar: [sidebar, t.foreground], selected: [over(t.accent, sidebar), t['accent-foreground']], secondary: [over(t.secondary, card), t['secondary-foreground']],
        bubble: [over(t.bubble, ground), t['bubble-foreground']], primary: [t.primary, t['primary-foreground']],
        'muted text': [ground, t['muted-foreground']], 'muted text on a card': [card, t['muted-foreground']], 'muted text on the sidebar': [sidebar, t['muted-foreground']],
        'muted text on muted': [over(t.muted, card), t['muted-foreground']],
        'faint text on the page': [ground, t['faint-foreground']], 'faint text on a card': [card, t['faint-foreground']], 'faint text on the sidebar': [sidebar, t['faint-foreground']],
        'primary text on a card': [card, t['primary-text']], 'primary text on its fill': [over(t['primary-soft'], card), t['primary-text']],
        'success on its fill': [over(t['success-soft'], card), t.success], 'destructive on its fill': [over(t['destructive-soft'], card), t.destructive],
        'warning on its fill': [over(t['warning-soft'], card), t.warning], 'warning ink on the page': [ground, t['warning-ink']], 'warning ink on a card': [card, t['warning-ink']],
        'warning ink on its fill': [over(t['warning-soft'], card), t['warning-ink']], 'success on a card': [card, t.success], 'destructive on a card': [card, t.destructive], 'info on a card': [card, t.info]
      };
      for (const [name, [bg, fg]] of Object.entries(surfaces)) assert.ok(ratio(bg, over(fg, bg)) >= 4.5, `${mode} ${name}: ${ratio(bg, over(fg, bg)).toFixed(2)}`);
      assert.ok(ratio(card, t.input) >= 3, `${mode} input border: ${ratio(card, t.input).toFixed(2)}`);
      assert.ok(ratio(ground, t.input) >= 3, `${mode} input border on the page: ${ratio(ground, t.input).toFixed(2)}`);
    }
  });
}

// Profesional has no translucent surface: every pair is checked on its own opaque colours, in light and dark.
const profesional = themes.slice(themes.indexOf('PROFESIONAL: plain and sober'), themes.indexOf('CRISTAL (3.8.2)'));
for (const [mode, selector] of [['light', 'html[data-skin="profesional"]'], ['dark', 'html.dark[data-skin="profesional"]']]) {
  test(`Profesional keeps WCAG AA contrast in ${mode} mode`, () => {
    const t = { ...tokens('html[data-skin="profesional"]', profesional), ...tokens(selector, profesional) };
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
