// The «Cristal» theme: its own theme (data-skin="cristal"), light only, plain (no robot, no backdrop, no motion) and
// painted by a palette. Registered in appearance.mjs, put on <html> by lib/store.js and offered in Ajustes › Apariencia.
// Its CSS (themes/skins.css) is checked at the end; the contrast of every theme is in temas-388.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKINS, plainSkin, robotSkin, darkOnlySkin, lightOnlySkin } from '../src/shared/appearance.mjs';
import { settingsSource } from './helpers.mjs';
import es from '../src/shared/locales/es/settings.mjs';
import en from '../src/shared/locales/en/settings.mjs';
import compEs from '../src/shared/locales/es/comp.mjs';
import compEn from '../src/shared/locales/en/comp.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');

test('Cristal is a theme of its own, plain and light only', () => {
  assert.ok(SKINS.includes('cristal'));
  assert.equal(SKINS[0], 'predeterminado', 'the default theme');
  assert.ok(plainSkin('cristal') && plainSkin('predeterminado') && !plainSkin('orb'));
  assert.ok(!robotSkin('cristal'));
  assert.ok(lightOnlySkin('cristal') && !darkOnlySkin('cristal'));
  assert.equal(es['appearance.skin.cristal'], 'Cristal');
  assert.equal(en['appearance.skin.cristal'], 'Glass');
  // On <html>: its own data-skin, no data-material.
  const store = read('lib', 'store.js');
  assert.match(store, /root\.skin = skin;/);
  assert.doesNotMatch(store, /root\.material = /);
  assert.match(read('components', 'skin-preview.jsx'), /cristal: null/);
  // No robot; its backdrop is the shader of the theme, mounted by the same component as the others.
  assert.match(read('components', 'scene.jsx'), /hasShader\(skin\)/);
  for (const f of ['robot.jsx', 'companion.jsx']) assert.match(read('components', f), /robotSkin\(/, f);
  assert.match(settingsSource(), /plainSkin\(/, 'views/settings');
});

test('the day / night controls explain why Cristal locks them to light', () => {
  const store = read('lib', 'store.js');
  assert.match(store, /!lightOnlySkin\(currentSkin\) && \(theme === 'oscuro'/);
  assert.match(store, /export const useLightOnly/);
  assert.match(read('components', 'theme-toggle.jsx'), /useLightOnly\(\)/);
  assert.match(read('views', 'settings', 'general.jsx'), /lightOnly/);
  assert.ok(compEs['comp.theme.lightOnly'] && compEn['comp.theme.lightOnly']);
});

test('the CSS of Cristal: glass variables, light only, blur on the few floating panes and a solid fallback', () => {
  const skins = read('themes', 'skins.css');
  const block = skins.slice(skins.indexOf('html[data-skin="cristal"]{'), skins.indexOf('\n', skins.indexOf('--g-base:')));
  for (const v of ['--g-fill', '--g-fill-strong', '--g-rim', '--g-rim-low', '--g-line', '--g-shadow', '--g-shadow-near', '--veil', '--veil-side', '--r-ctl', '--r-card', '--r-big']) assert.match(block, new RegExp(`${v}:`), v);
  assert.match(block, /color-scheme:light/);
  assert.doesNotMatch(skins, /html\.dark\[data-skin="cristal"\]/, 'no night for Cristal');
  // blur only on the sidebar layer, the chat bar, the message box, menus, selects, dialogs and their overlay; never on cards
  const blurred = [...skins.matchAll(/(html\[data-skin="cristal"\][^{]*)\{[^}]*backdrop-filter: blur/g)].map((m) => m[1]);
  assert.ok(blurred.length >= 4, String(blurred.length));
  assert.ok(blurred.every((s) => !/\[data-slot="card"\]/.test(s)), 'cards stay solid');
  assert.match(skins, /@media \(prefers-reduced-transparency: reduce\) \{[^]*html\[data-skin="cristal"\][^]*backdrop-filter: none/);
  // the Android build's glass look (glass.css) hangs from html.glass alone and never reads a theme
  assert.doesNotMatch(read('glass.css'), /data-skin|data-material/);
});
