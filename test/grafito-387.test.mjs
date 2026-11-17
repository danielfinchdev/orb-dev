// The themes a phone may wear, and the Grafito base of tokens.css and its fonts (the contrast of every theme is in
// temas-388.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKINS, phoneSkin } from '../src/shared/appearance.mjs';
import { phoneConfig } from '../src/engine/transport/remote.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');

test('the phone wears Orb, which reaches it with the PC settings, and nothing else but the default', () => {
  assert.equal(phoneSkin('orb'), 'orb');
  assert.equal(phoneSkin('predeterminado'), 'predeterminado');
  for (const skin of ['vaporwave', 'retro', 'candy', 'cristal', 'profesional', 'nope', undefined]) assert.equal(phoneSkin(skin), SKINS[0], String(skin));
  assert.equal(phoneConfig({ ui: { skin: 'orb', theme: 'oscuro' } }).ui.skin, 'orb', 'ui.skin travels in the settings of a phone');
  const store = read('lib', 'store.js');
  assert.match(store, /const skinOf = \(skin\) => \{[^}]*fullPc\(\) \? id : phoneSkin\(id\)/);
  assert.match(store, /const skin = skinOf\(ui\.skin\);/);
  assert.match(store, /useSkin = \(\) => useStore\(\(s\) => skinOf\(s\.app\?\.config\?\.ui\?\.skin\)\)/);
});

test('the base tokens are the Grafito of Orb UI 2.0: neutral greys, black buttons by day and white at night', () => {
  const tokens = read('tokens.css');
  const light = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('.dark {'));
  const dark = tokens.slice(tokens.indexOf('.dark {'), tokens.indexOf('@theme inline'));
  assert.match(light, /--primary: oklch\(0\.205 0 0\);/);
  assert.match(dark, /--primary: oklch\(0\.97 0 0\);/);
  assert.match(light, /--background: oklch\(0\.991 0 0\);/);
  assert.match(dark, /--background: oklch\(0\.164 0 0\);/);
  for (const v of ['--card-foreground', '--popover-foreground', '--secondary-foreground', '--accent-foreground', '--bubble-foreground']) {
    assert.match(light, new RegExp(`${v}: oklch\\(0\\.269 0 0\\);`), `light ${v}`);
    assert.match(dark, new RegExp(`${v}: oklch\\(0\\.97 0 0\\);`), `dark ${v}`);
  }
});

test('the fonts: the system UI font and JetBrains Mono while the defaults are selected; a font chosen in Ajustes is never overridden', () => {
  const skins = read('themes', 'skins.css');
  assert.match(skins, /html\[data-font="outfit"\] \{ --font-sans: "Segoe UI Variable Text"/);
  assert.match(skins, /html\[data-code-font="geist-mono"\] \{ --font-mono: "JetBrains Mono Variable"/);
  assert.match(skins, /html\[data-skin="retro"\]\[data-font="outfit"\] \{ --font-sans: var\(--font-mono\); \}/);
  for (const chosen of ['inter', 'geist', 'plex', 'system', 'jetbrains-mono', 'fira-code', 'plex-mono', 'cascadia']) assert.doesNotMatch(skins, new RegExp(`data-(code-)?font="${chosen}"`), chosen);
  // the titles take --title, which each theme may restate
  assert.match(read('app.css'), /:root \{ --font-title: var\(--title\); \}/);
  assert.match(skins, /--title:"Orbitron Variable"/);
  assert.match(skins, /--title:"Fredoka Variable"/);
  assert.match(skins, /--title:"VT323"/);
});
