// Órbita F2: the «Retro» theme is dark only. The rule lives in appearance.mjs (darkOnlySkin); lib/store.js applies it
// without touching ui.theme, so the system-theme listener cannot undo it and leaving Retro restores the saved choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKINS, darkOnlySkin } from '../src/shared/appearance.mjs';
import es from '../src/shared/locales/es/comp.mjs';
import en from '../src/shared/locales/en/comp.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('darkOnlySkin: only retro is dark only', () => {
  assert.deepEqual(SKINS.filter(darkOnlySkin), ['retro']);
  assert.equal(darkOnlySkin(undefined), false);
});

test('applyTheme forces .dark for a dark-only theme and keeps the saved choice', () => {
  const store = read('src', 'ui', 'lib', 'store.js');
  assert.match(store, /const dark = darkOnlySkin\(currentSkin\) \|\| \(!lightOnlySkin\(currentSkin\) && \(theme === 'oscuro'/);
  assert.match(store, /currentSkin = skin;/);
  // applyAppearance re-evaluates the mode, so changing theme neither leaves Retro light nor Orb stuck dark
  assert.match(store, /root\.motion = [^\n]*\n[\s\S]*?\n\s*applyTheme\(\);/);
  // the system-theme listener goes through the same function, with no argument
  assert.match(store, /media\.addEventListener\('change', \(\) => applyTheme\(\)\)/);
});

test('the day / night controls explain why they are disabled', () => {
  const menu = read('src', 'ui', 'components', 'mobile-menu.jsx');
  assert.match(menu, /useDarkOnly\(\)/);
  assert.match(menu, /comp\.theme\.darkOnly/);
  // the sidebar's button is not drawn at all in a one-mode theme
  const toggle = read('src', 'ui', 'components', 'theme-toggle.jsx');
  assert.match(toggle, /useDarkOnly\(\)/);
  assert.match(toggle, /if \(darkOnly \|\| lightOnly\) return null;/);
  assert.match(read('src', 'ui', 'views', 'settings', 'general.jsx'), /darkOnly/);
  assert.ok(es['comp.theme.darkOnly'] && en['comp.theme.darkOnly']);
});

test('the tour and the animation meter skip Retro by day', () => {
  assert.match(read('test', 'tour.e2e.mjs'), /!look\.dark && darkOnlySkin\(skin\)/);
  assert.match(read('scripts', 'medir-animaciones.mjs'), /mode === 'claro' && darkOnlySkin\(skin\)/);
});

// ---- Contrast (WCAG AA). oklch → sRGB with the chroma reduced until it fits the gamut, as CSS does for colours the screen cannot show. ----
// Retro always wears .dark: the browser sees the dark base tokens with the Retro block over them.
const declsOf = (css, selector) => { const i = css.indexOf(selector); const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i)); return [...body.matchAll(/--([a-z0-9-]+)\s*:\s*(oklch\([^)]*\))/g)].map((m) => [m[1], m[2]]); };
const tok = Object.fromEntries([...declsOf(read('src', 'ui', 'tokens.css'), '.dark {'), ...declsOf(read('src', 'ui', 'themes', 'skins.css'), 'html[data-skin="retro"]{')]);
function toRgb(L, C, H) {
  const lin = (c) => { const h = (H * Math.PI) / 180, a = c * Math.cos(h), b = c * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]; };
  const fits = (v) => v.every((x) => x >= -0.0005 && x <= 1.0005);
  let c = C; if (!fits(lin(c))) { let lo = 0, hi = C; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(lin(mid))) lo = mid; else hi = mid; } c = lo; }
  return lin(c).map((x) => Math.min(1, Math.max(0, x)));
}
const colour = (name) => { const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(tok[name]); assert.ok(m, name); return { rgb: toRgb(+m[1], +m[2], +m[3]), a: m[4] ? +m[4] : 1 }; };
const lum = (rgb) => { const [r, g, b] = rgb.map((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
const C = (name) => colour(name).rgb;
// browsers blend in gamma-encoded sRGB
const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055), dec = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const mix = (top, under, alpha) => top.map((c, i) => dec(enc(c) * alpha + enc(under[i]) * (1 - alpha)));

test('Retro: text pairs reach AA (4.5:1) in its only mode', () => {
  const pairs = [['foreground', 'background'], ['foreground', 'card'], ['card-foreground', 'card'], ['popover-foreground', 'popover'], ['foreground', 'sidebar'],
    ['muted-foreground', 'card'], ['muted-foreground', 'muted'], ['muted-foreground', 'background'], ['faint-foreground', 'card'], ['faint-foreground', 'muted'], ['faint-foreground', 'background'],
    ['primary-foreground', 'primary'], ['primary-text', 'card'], ['primary-text', 'primary-soft'], ['secondary-foreground', 'secondary'], ['accent-foreground', 'accent'],
    ['success', 'success-soft'], ['warning-ink', 'background'], ['warning-ink', 'card'], ['warning-ink', 'warning-soft'], ['warning-foreground', 'warning'],
    ['destructive', 'destructive-soft'], ['destructive', 'card'], ['destructive', 'background'], ['primary-foreground', 'destructive'], ['info', 'card'], ['bubble-foreground', 'bubble']];
  if (process.env.RETRO_RATIOS) console.log(pairs.map(([f, b]) => `${f}/${b} ${ratio(C(f), C(b)).toFixed(2)}`).join(' | '));
  for (const [f, b] of pairs) assert.ok(ratio(C(f), C(b)) >= 4.5, `${f} on ${b}: ${ratio(C(f), C(b)).toFixed(2)}`);
});

test('Retro: field borders, the focus ring and the empty chart bars are visible', () => {
  for (const b of ['card', 'background', 'sidebar']) assert.ok(ratio(C('input'), C(b)) >= 3, `input on ${b}`);
  for (const b of ['card', 'background']) assert.ok(ratio(C('ring'), C(b)) >= 3, `ring on ${b}`);
  assert.ok(ratio(C('chart-empty'), C('card')) >= 1.5, 'chart-empty on card');
});

test('Retro: the chat text reads over the brightest piece of the backdrop', () => {
  // the phosphor at its brightest under the part of the page colour that the veil lets through
  const brightest = mix(C('background'), mix(C('primary'), C('background'), 0.22), 0.24);
  assert.ok(ratio(C('foreground'), brightest) >= 4.5, ratio(C('foreground'), brightest).toFixed(2));
  assert.ok(ratio(C('muted-foreground'), brightest) >= 4.5, ratio(C('muted-foreground'), brightest).toFixed(2));
});

test('Retro tokens are on html[data-skin] alone: .dark changes nothing, and no light variant remains', () => {
  const all = ['skins'].map((n) => read('src', 'ui', 'themes', `${n}.css`)).join('') + read('src', 'ui', 'app.css');
  assert.doesNotMatch(all, /html:not\(\.dark\)[^{]*\[data-skin="retro"\]|html\[data-skin="retro"\]:not\(\.dark\)/);
  assert.doesNotMatch(all, /html\.dark\[data-skin="retro"\] \{\s*--/);
  assert.doesNotMatch(read('src', 'ui', 'tokens.css'), /html\[data-skin\]:not\(/, 'every theme has its own soft / faint tokens now');
});

test('Retro: the CRT glass takes no clicks and the phosphor is a text-shadow, not a filter', () => {
  const skins = read('src', 'ui', 'themes', 'skins.css');
  assert.match(skins, /^\.crt \{[^}]*pointer-events: none/m);
  assert.match(skins, /html\[data-skin="retro"\] body \{ text-shadow: 0 0 6px/);
  assert.doesNotMatch(skins, /html\[data-skin="retro"\][^{]*\{[^}]*[^-]filter:/);
  assert.match(read('src', 'ui', 'components', 'scene.jsx'), /skin === 'retro' \? <div className="crt"/);
});
