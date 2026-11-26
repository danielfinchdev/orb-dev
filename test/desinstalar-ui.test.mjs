// The window's side of uninstall and reset: its texts exist in Spanish and English, the blocks sit at the end of Ajustes › Datos,
// the question comes before the welcome, and the welcome after a reset starts from its first step.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';
import { startupPhase } from '../src/ui/lib/startup.js';
import { BOXES } from '../src/shared/uninstall-boxes.mjs';

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const view = read('src', 'ui', 'views', 'uninstall.jsx');

test('every text the window and the engine use exists in Spanish and English, with the same placeholders', () => {
  const used = new Set([...view.matchAll(/'(uninstall\.[A-Za-z.]+)'/g)].map((m) => m[1]));
  for (const b of BOXES) { used.add(`uninstall.box.${b}`); used.add(`uninstall.box.${b}Desc`); }
  for (const k of ['phones', 'dirty', 'folders', 'oldKept']) { used.add(`uninstall.${k}.one`); used.add(`uninstall.${k}.other`); }
  used.delete('uninstall.plan'); used.delete('uninstall.run'); used.delete('uninstall.restart'); used.delete('uninstall.phones'); used.delete('uninstall.dirty'); used.delete('uninstall.folders'); used.delete('uninstall.oldKept');
  for (const m of read('src', 'engine', 'api', 'uninstall.mjs').matchAll(/tr\('(uninstall\.[A-Za-z.]+)'/g)) used.add(m[1]);
  for (const m of read('src', 'engine', 'engine.mjs').matchAll(/tr\('(uninstall\.[A-Za-z.]+)'/g)) used.add(m[1]);
  assert.ok(used.size > 60);
  const holes = [...used].filter((k) => typeof es[k] !== 'string' || typeof en[k] !== 'string');
  assert.deepEqual(holes, []);
  const slots = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of Object.keys(es).filter((x) => x.startsWith('uninstall.'))) assert.equal(slots(es[k]), slots(en[k]), k);
  assert.deepEqual(Object.keys(es).filter((x) => x.startsWith('uninstall.')).sort(), Object.keys(en).filter((x) => x.startsWith('uninstall.')).sort(), 'the same keys in both languages');
});

test('the style guide: no «por favor», no exclamations, no semicolons, plain ellipsis only on the buttons that open a dialog', () => {
  for (const [lang, dict] of [['es', es], ['en', en]]) {
    for (const [k, v] of Object.entries(dict).filter(([x]) => x.startsWith('uninstall.'))) {
      assert.ok(!/por favor|please|oops|!/i.test(v), `${lang} ${k}`);
      assert.ok(!/;/.test(v), `${lang} ${k}`);
      if (/…/.test(v)) assert.ok(/Button$|\.running$|^uninstall\.(resetButton|removeButton)$/.test(k) || /uninstall\.running|uninstall\.removing/.test(k), `${lang} ${k}`);
    }
  }
  assert.equal(es['uninstall.final'], 'Esto no se puede deshacer desde Orb.');
  assert.equal(es['uninstall.q.title'], 'He encontrado tus chats y ajustes de antes');
  assert.equal(es['uninstall.q.hint'], '¿Los recupero o empiezo de cero?');
});

test('the blocks close Ajustes › Datos (the older data above the reset), only on this PC\'s window', () => {
  const data = read('src', 'ui', 'views', 'data.jsx');
  assert.match(data, /<CoreCard \/><PreviousBlock \/><UninstallBlock \/>/);
  assert.match(view, /if \(bridge\.mobile \|\| !bridge\.uninstall\) return null;/);
  assert.match(view, /if \(bridge\.mobile \|\| !list\.length\) return null;/);
  // «Restablecer…» and «Desinstalar…» ask for the unlock before the plan, the word for «Borrar todo», and the run is the one the user saw
  assert.match(view, /unlockCore\('uninstall'\)/);
  assert.match(view, /planId: plan\.id/);
  assert.match(view, /mode === 'uninstall' && BOXES\.every\(\(b\) => !plan\.keep\[b\]\)/);
  assert.match(view, /lockBusy: true/, 'the run cannot be walked away from');
  assert.ok(view.includes('plan.boxes.key?.items > 0'), 'the PC key is a row of the list');
  assert.ok(view.includes("call('uninstall.restart')"), 'a uninstaller that cannot start does not leave the engine closed');
  // the place the survey (the next step) goes in is marked
  assert.match(view, /survey/i);
});

test('the question comes before the welcome, and answering reloads into a plain start', () => {
  const main = read('src', 'ui', 'main.jsx');
  assert.match(main, /if \(info\.needsSetup && info\.previous\) return alive && setPhase\('previous'\);/);
  assert.ok(main.indexOf("setPhase('previous')") < main.indexOf("setPhase('setup')"));
  assert.match(main, /onAnswered=\{\(\) => window\.location\.reload\(\)\}/);
  const bridge = read('src', 'ui', 'lib', 'tauri-bridge.js');
  assert.match(bridge, /previous: \(choice\) => invoke\('app_previous'/);
  assert.match(bridge, /uninstall: \(code\) => invoke\('app_uninstall'/);
  assert.ok(!/previous|uninstall/.test(read('src', 'ui', 'lib', 'web-bridge.js').replace(/switchHome/g, '')), 'the phone has no such calls');
});

test('after a reset or «Empezar de cero» the welcome starts from its first step, with the folder already there', async () => {
  const state = (extra) => ({ config: { setupPending: true, assistantName: 'Orb' }, home: 'C:\\Orb', ...extra });
  const call = (st) => async (method) => ({ 'app.coreState': { missing: false }, 'app.migrationState': {}, 'master.state': { exists: false }, 'app.layoutPlan': { pending: false }, 'app.state': st })[method];
  const fresh = await startupPhase(call(state({ welcomeFresh: true })));
  assert.equal(fresh.phase, 'setup'); assert.equal(fresh.data.step, 'datos'); assert.equal(fresh.data.fresh, true); assert.equal(fresh.data.home, 'C:\\Orb');
  const half = await startupPhase(call(state({})));
  assert.equal(half.data.step, 'maestra'); assert.equal(half.data.fresh, undefined, 'a welcome closed halfway goes on where it stopped');
  const setup = read('src', 'ui', 'views', 'setup.jsx');
  assert.match(setup, /const fresh = resume\?\.fresh === true;/);
  assert.match(setup, /if \(fresh\) await call\('config\.save', \{ patch: \{ assistantName: shown/);
});
