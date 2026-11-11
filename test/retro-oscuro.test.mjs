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
  assert.match(store, /const dark = darkOnlySkin\(currentSkin\) \|\| theme === 'oscuro'/);
  assert.match(store, /currentSkin = skin;/);
  // applyAppearance re-evaluates the mode, so changing theme neither leaves Retro light nor Orb stuck dark
  assert.match(store, /root\.motion = [^\n]*\n\s*applyTheme\(\);/);
  // the system-theme listener goes through the same function, with no argument
  assert.match(store, /media\.addEventListener\('change', \(\) => applyTheme\(\)\)/);
});

test('the day / night controls explain why they are disabled', () => {
  for (const f of ['theme-toggle.jsx', 'mobile-menu.jsx']) {
    const src = read('src', 'ui', 'components', f);
    assert.match(src, /useDarkOnly\(\)/, f);
    assert.match(src, /comp\.theme\.darkOnly/, f);
  }
  assert.match(read('src', 'ui', 'components', 'theme-toggle.jsx'), /aria-disabled/);
  assert.match(read('src', 'ui', 'views', 'settings', 'general.jsx'), /darkOnly/);
  assert.ok(es['comp.theme.darkOnly'] && en['comp.theme.darkOnly']);
});

test('the tour and the animation meter skip Retro by day', () => {
  assert.match(read('test', 'tour.e2e.mjs'), /!look\.dark && darkOnlySkin\(skin\)/);
  assert.match(read('scripts', 'medir-animaciones.mjs'), /mode === 'claro' && darkOnlySkin\(skin\)/);
});
