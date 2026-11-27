// 3.8.10, the chosen option of pick-one menus: a soft accent fill and a check, never a circle. Read as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const overlay = read('src', 'ui', 'components', 'ui', 'overlay.jsx');
const css = read('src', 'ui', 'app.css');

test('38: the radio menu item and the select item share the pick class and draw no dot', () => {
  const radio = overlay.slice(overlay.indexOf('export function DropdownMenuRadioItem'), overlay.indexOf('DropdownMenuSeparator'));
  assert.match(radio, /'it pick /);
  assert.doesNotMatch(radio, /rounded-full/);
  assert.match(radio, /CheckIcon/);
  assert.match(overlay, /SelectPrimitive\.Item[^>]*className="it pick /);
  assert.match(read('src', 'ui', 'components', 'autonomy-switch.jsx'), /data-picked=\{on\}/);
});

test('38: the chosen fill is an accent tint, stronger and edged when highlighted', () => {
  assert.match(css, /\.pick\.pick:is\(\[data-state="checked"\], \[data-picked="true"\]\) \{ background-color: color-mix\(in oklab, var\(--primary-text\) 14%/);
  assert.match(css, /\[data-highlighted\], :hover, :focus-visible\) \{ background-color: color-mix\(in oklab, var\(--primary-text\) 24%/);
});

test('38: the Android pick-one lists have no empty or filled circles', () => {
  const files = ['kit/Overlays.kt', 'projects/PrScreens.kt', 'share/ShareScreen.kt', 'tasks/TaskDetailScreen.kt'];
  for (const f of files) {
    const k = read('android', 'app', 'src', 'main', 'java', 'dev', 'orb', 'app', 'ui', ...f.split('/'));
    assert.doesNotMatch(k, /OrbIcons\.Circle\b|if \((selected|method == m)\) OrbIcons\.CircleCheck/, f);
  }
  assert.match(read('android', 'app', 'src', 'main', 'java', 'dev', 'orb', 'app', 'ui', 'kit', 'Overlays.kt'), /fun Modifier\.chosenFill/);
});
