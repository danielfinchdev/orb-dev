// Themes from three seeds (ui/lib/theme-seeds.js, theme «paletas») and the three size settings (density, chat width, text
// size). The derived tokens must reach WCAG AA for every palette, accent, strength and mode; the size settings must leave the
// default scale exactly as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKINS, PALETTES, ACCENTS, CONTRASTS, DENSITIES, CHAT_WIDTHS, FONT_SIZES, BASE_FONT, APPEARANCE_DEFAULTS, baseSkin, plainSkin } from '../src/shared/appearance.mjs';
import { deriveTokens, seedCss, seedsOf, ratio, previewColors } from '../src/ui/lib/theme-seeds.js';
import { validateConfig } from '../src/platform/config.mjs';
import { DEFAULT_CONFIG, merge } from '../src/platform/config-file.mjs';
import es from '../src/shared/locales/es/settings.mjs';
import en from '../src/shared/locales/en/settings.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('«paletas» is registered last and is plain like Profesional', () => {
  assert.equal(SKINS.at(-1), 'paletas');
  assert.equal(baseSkin('paletas'), 'profesional');
  assert.ok(plainSkin('paletas'));
  assert.ok(PALETTES.length >= 26 && PALETTES.length <= 30);
  assert.equal(new Set(PALETTES).size, PALETTES.length);
  for (const key of [...PALETTES.map((p) => `appearance.palette.${p}`), ...ACCENTS.map((a) => `appearance.accent.${a}`), ...CONTRASTS.map((c) => `appearance.contrast.${c}`), 'appearance.skin.paletas']) {
    assert.ok(es[key], `es ${key}`); assert.ok(en[key], `en ${key}`);
  }
});

const TEXT_ON = [['--foreground', '--background', 7], ['--foreground', '--card', 7], ['--card-foreground', '--card', 7], ['--popover-foreground', '--popover', 7], ['--muted-foreground', '--background', 4.5], ['--muted-foreground', '--muted', 4.5], ['--muted-foreground', '--sidebar', 4.5],
  ['--faint-foreground', '--background', 4.5], ['--faint-foreground', '--muted', 4.5], ['--primary-foreground', '--primary', 4.5], ['--primary-text', '--background', 4.5], ['--primary-text', '--primary-soft', 4.5], ['--primary-text', '--accent', 4.5], ['--accent-foreground', '--accent', 7],
  ['--secondary-foreground', '--secondary', 7], ['--bubble-foreground', '--bubble', 7], ['--destructive', '--background', 4.5], ['--destructive', '--destructive-soft', 4.5], ['--success', '--background', 4.5], ['--success', '--success-soft', 4.5],
  ['--warning', '--warning-soft', 4.5], ['--warning', '--background', 4.5], ['--info', '--background', 4.5], ['--input', '--background', 3], ['--input', '--card', 3], ['--ring', '--background', 3], ['--ring', '--card', 3]];

test('every palette × accent × strength × mode reaches AA (text 4.5, controls 3)', () => {
  let worst = 99; let n = 0;
  for (const id of PALETTES) for (const accent of ACCENTS) for (const contrast of CONTRASTS) for (const mode of ['light', 'dark']) {
    const t = deriveTokens(id, mode, accent, contrast);
    for (const [fg, bg, min] of TEXT_ON) {
      const r = ratio(t[fg], t[bg]); n += 1; worst = Math.min(worst, r / min);
      assert.ok(r >= min - 0.001, `${id}/${accent}/${contrast}/${mode}: ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`);
    }
  }
  assert.ok(n > 10000 && worst >= 0.999);
});

test('tokens are opaque hex, complete and the same set in both modes', () => {
  const a = deriveTokens('carbon', 'light'); const b = deriveTokens('carbon', 'dark');
  assert.deepEqual(Object.keys(a), Object.keys(b));
  assert.ok(Object.keys(a).length >= 33);
  for (const v of Object.values({ ...a, ...b })) assert.match(v, /^#[0-9a-f]{6}$/);
  assert.notEqual(a['--background'], b['--background']);
  assert.ok(ratio(seedsOf('carbon', 'light').surface, seedsOf('carbon', 'light').ink) > 10);
  assert.notEqual(deriveTokens('carbon', 'light', 'azul')['--primary'], deriveTokens('carbon', 'light')['--primary']);
  assert.deepEqual(Object.keys(previewColors('mora', 'dark')).length, 12);
});

test('the generated CSS targets both modes of «paletas» and holds no motion', () => {
  const css = seedCss('oceano', 'verde', 'alto');
  assert.match(css, /^html\[data-skin\]\[data-material="paletas"\] \{/);
  assert.match(css, /html\.dark\[data-skin\]\[data-material="paletas"\] \{/);
  assert.doesNotMatch(css, /animation|transition|backdrop-filter/);
});

test('Grafito, Profesional and Cristal are untouched by the palettes', () => {
  const skins = read('src/ui/themes/skins.css');
  const start = skins.indexOf('PALETAS');
  assert.ok(start > 0);
  const section = skins.slice(start, skins.indexOf('/* ====', skins.indexOf('*/', start)));
  assert.doesNotMatch(skins.slice(0, start).replace(/PALETAS/g, ''), /data-material="paletas"/);
  assert.doesNotMatch(section.replace(/\/\*[\s\S]*?\*\//g, ''), /animation|transition|@keyframes|will-change|backdrop-filter/);
  assert.match(read('src/ui/components/skin-preview.jsx'), /paletas/);
});

test('size settings: the default scale is the one Orb always had', () => {
  assert.equal(DENSITIES.normal, 1);
  assert.equal(CHAT_WIDTHS.normal, '48rem'); // Tailwind max-w-3xl
  assert.equal(BASE_FONT, 14.5);
  assert.ok(FONT_SIZES.includes(BASE_FONT) && Math.min(...FONT_SIZES) === 12 && Math.max(...FONT_SIZES) === 18);
  assert.deepEqual([APPEARANCE_DEFAULTS.density, APPEARANCE_DEFAULTS.chatWidth, APPEARANCE_DEFAULTS.fontSize], ['normal', 'normal', 14.5]);
  const tokens = read('src/ui/tokens.css');
  assert.match(tokens, /--font-k: 1;/);
  assert.match(tokens, /--app-density: 1;/);
  const sizes = { micro: [11, 16], caption: [12, 16], control: [13, 18], body: [14.5, 22], 'card-title': [15, 20], title: [16, 22], dialog: [18, 24], display: [24, 30] };
  for (const [role, [px, lh]] of Object.entries(sizes)) {
    assert.ok(tokens.includes(`--text-${role}: calc(${px}px * var(--font-k));`), role);
    assert.ok(tokens.includes(`--text-${role}--line-height: calc(${lh}px * var(--font-k));`), `${role} line`);
  }
  assert.match(tokens, /--chat-max-width: 48rem;/);
  assert.ok(read('src/ui/views/chat.jsx').includes('max-w-[var(--chat-max-width)]'));
  assert.ok(read('src/ui/components/conversation/composer.jsx').includes('max-w-[var(--chat-max-width)]'));
});

test('the config accepts the new appearance values and refuses the rest', () => {
  const base = structuredClone(DEFAULT_CONFIG);
  const ok = (ui) => { try { validateConfig(merge(structuredClone(base), { ui })); return true; } catch (e) { if (process.env.DBG) console.log(e.message); return false; } };
  assert.ok(ok({ skin: 'paletas', palette: 'mora', accent: 'azul', contrast: 'alto', density: 'compacta', chatWidth: 'completa', fontSize: 16 }));
  for (const bad of [{ palette: 'x' }, { accent: 'rojo' }, { contrast: 'max' }, { density: 'enorme' }, { chatWidth: '90rem' }, { fontSize: 40 }, { fontSize: '14' }]) assert.equal(ok(bad), false, JSON.stringify(bad));
});
