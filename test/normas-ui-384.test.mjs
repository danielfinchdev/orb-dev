// Bitácoras › Normas: which password each change asks for, that nothing changes without it, and that a rule's text is
// never taken for HTML. The pure part is run; the rest is fixed by the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FRESH_ACTIONS } from '../src/ui/lib/core-access.js';
import { ruleAction, railAction, asksEveryTime, asList, railsOf, ruleSide, isRemoved, readRemoved, writeRemoved, clampValue, shownValue, pruneRemoved, hasHiddenSecret, isMissingMethod, diffValues, changedValues, REMOVED_KEY } from '../src/ui/lib/rules-access.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';
import { RAILS } from '../src/shared/rails-registry.mjs';

const src = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
const files = ['views/rules.jsx', 'views/rules-cards.jsx', 'views/rules-dialogs.jsx', 'lib/rules-actions.js', 'lib/rules-access.js'];

test('rails and shipped rules ask the password every time, like the engine', () => {
  assert.ok(FRESH_ACTIONS.includes('rails') && FRESH_ACTIONS.includes('ruleSeed'));
  assert.ok(!FRESH_ACTIONS.includes('rules'), 'your own rules use the 5-minute unlock');
});

test('ruleAction: shipped pause / delete / save and the restore are ruleSeed; yours use the usual unlock', () => {
  for (const op of ['pause', 'delete', 'save']) {
    assert.equal(ruleAction(op, { de_serie: true }), 'ruleSeed');
    assert.equal(ruleAction(op, { de_serie: false }), 'rules');
  }
  assert.equal(ruleAction('restoreDefaults'), 'ruleSeed');
  assert.equal(ruleAction('create'), 'rules');
  assert.equal(ruleAction('resume', { de_serie: true }), 'rules');
  assert.equal(railAction(), 'rails');
  assert.ok(asksEveryTime('rails') && asksEveryTime('ruleSeed') && !asksEveryTime('rules'));
  for (const a of ['rails', 'ruleSeed', 'rules']) { assert.ok(es[`master.ask.${a}`], a); assert.ok(en[`master.ask.${a}`], a); }
});

test('every change goes through guarded(): unlockCore first, the call only with its token', () => {
  const s = src('lib/rules-actions.js');
  const guarded = s.slice(s.indexOf('async function guarded'), s.indexOf('// op:'));
  assert.ok(guarded.indexOf('unlockCore(action)') !== -1 && guarded.indexOf('unlockCore(action)') < guarded.indexOf('call(method'));
  assert.match(guarded, /if \(!unlock\) return undefined/);
  // the only place that sends a change is guarded()
  assert.equal((s.match(/\bcall\(/g) ?? []).length, 1);
  for (const m of ['rules.pause', 'rules.resume', 'rules.delete', 'rules.restoreDefaults', 'rules.save', 'rules.create']) assert.ok(src('lib/rules-access.js').includes(`'${m}'`), m);
  assert.ok(s.includes("'rails.set'"));
  // the view and its cards never call a change by themselves
  for (const f of ['views/rules.jsx', 'views/rules-cards.jsx', 'views/rules-dialogs.jsx']) {
    const code = src(f);
    assert.doesNotMatch(code, /call\('(?:rules|rails)\.(?:pause|resume|delete|restoreDefaults|save|create|set|restore)'/, f);
  }
  assert.match(src('views/rules.jsx'), /call\('rules\.list'/);
});

test('no HTML is injected and the type scale is used', () => {
  for (const f of files) {
    const code = src(f);
    assert.doesNotMatch(code, /dangerouslySetInnerHTML|innerHTML|Markdown/, f);
    assert.doesNotMatch(code, /text-\[/, f);
  }
});

test('pausing is orange (warn: --warning + its foreground), only deleting is red', () => {
  const dialogs = src('views/rules-dialogs.jsx');
  assert.match(dialogs.slice(dialogs.indexOf('export function confirmPauseRail')), /warn: true/);
  assert.match(src('components/dialogs.jsx'), /d\.warn \? 'warn'/);
  assert.match(src('components/ui/button.jsx'), /warn: 'bg-warning text-warning-foreground/);
  assert.match(dialogs, /confirmRemoveRail[^\n]*danger: true/);
  const tokens = src('tokens.css');
  const blocks = tokens.split(/\n\.dark\b/);
  for (const b of blocks) { assert.match(b, /--warning:/); assert.match(b, /--warning-foreground:/); }
});

test('the card does not call a rail change itself and tells which controls ask every time', () => {
  const cards = src('views/rules-cards.jsx');
  assert.ok((cards.match(/<EveryTime/g) ?? []).length >= 3);
  assert.match(cards, /rails\.\$\{rail\.id\}\.enabled/);
});

test('the texts: both languages have every key the tab uses, with the approved names', () => {
  const used = new Set();
  for (const f of ['views/rules.jsx', 'views/rules-cards.jsx', 'views/rules-dialogs.jsx']) for (const m of src(f).matchAll(/\bt\('(rules\.[\w.]+)'/g)) used.add(m[1]);
  assert.ok(used.size > 40);
  for (const k of used) { assert.ok(es[k], `es ${k}`); assert.ok(en[k], `en ${k}`); }
  for (const r of RAILS) { assert.ok(es[`rails.${r.id}.title`], r.id); assert.ok(en[`rails.${r.id}.title`], r.id); }
  assert.equal(es['rails.rondas-correccion.title'], 'Rondas de corrección');
  assert.equal(es['rails.revisar-secretos.title'], 'Revisar secretos antes de un commit');
  assert.equal(es['rules.restoreSeed'], 'Restaurar las de serie');
});

test('asList and railsOf: an unexpected answer never breaks the tab', () => {
  assert.deepEqual(asList(null), []);
  assert.deepEqual(asList({ a: 1 }), []);
  assert.deepEqual(asList([1, null, 'x', { id: 'a' }]), [{ id: 'a' }]);
  assert.deepEqual(railsOf('nope', 'orb'), { fixed: [], switchable: [] });
  const r = railsOf([{ id: 'a', grupo: 'orb', fijo: true }, { id: 'b', grupo: 'orb', fijo: false }, { id: 'c', grupo: 'subagentes' }], 'orb');
  assert.deepEqual([r.fixed.length, r.switchable.length], [1, 1]);
  assert.ok(ruleSide({ para: 'ambos' }, 'orb') && ruleSide({ para: 'orb' }, 'orb') && !ruleSide({ para: 'subagentes' }, 'orb'));
});

test('removed rails: kept per window, only when the rail is off', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(readRemoved(storage), []);
  writeRemoved(storage, ['publicar', 'publicar', 'usar-adb']);
  assert.deepEqual(readRemoved(storage), ['publicar', 'usar-adb']);
  mem.set(REMOVED_KEY, '{"x":1}');
  assert.deepEqual(readRemoved(storage), []);
  assert.deepEqual(readRemoved(null), []);
  assert.ok(isRemoved({ id: 'a', activo: false }, ['a']));
  assert.ok(!isRemoved({ id: 'a', activo: true }, ['a']));
  assert.ok(!isRemoved({ id: 'a', fijo: true, activo: false }, ['a']));
});

test('values: clamped to the engine limits, percent kept as a fraction, before → after for the dialog', () => {
  assert.equal(clampValue('budget.stopAt', '100'), 1);
  assert.equal(clampValue('budget.stopAt', '10'), 0.5);
  assert.equal(clampValue('perAgent', '9'), 5);
  assert.equal(clampValue('timeoutMinutes', '60'), 60);
  assert.equal(clampValue('timeoutMinutes', ''), undefined);
  assert.equal(clampValue('timeoutMinutes', 'abc'), undefined);
  assert.equal(shownValue('budget.stopAt', 0.92), 92);
  assert.equal(shownValue('timeoutMinutes', 60), 60);
  const d = diffValues({ 'budget.stopAt': 0.92, protected: ['.ssh', '.env'] }, { 'budget.stopAt': 1, protected: ['.ssh'] });
  assert.deepEqual(d, [{ key: 'budget.stopAt', before: '92', after: '100' }, { key: 'protected', before: '.ssh, .env', after: '.ssh' }]);
  assert.deepEqual(changedValues({ a: 1, b: 2 }, { a: 1, b: 3 }, ['a', 'b']), { b: 3 });
  assert.deepEqual(changedValues({ a: 1 }, { a: 1 }, ['a']), {});
});

test('Ajustes › save asks the password when a patch changes a rail value', () => {
  const rows = src('views/settings/rows.jsx');
  assert.match(rows, /railValuesChange\(patch, getState\(\)\.app\?\.config\)\) \{ unlock = await unlockCore\('rails'\)/);
});

test('save() asks the rails password even when another token comes, and Ajustes does not ask a second one', () => {
  const rows = src('views/settings/rows.jsx');
  assert.match(rows, /patch\?\.rails !== undefined \|\| railValuesChange\(patch, getState\(\)\.app\?\.config\)\) \{ unlock = await unlockCore\('rails'\)/);
  assert.doesNotMatch(rows, /!unlock && railValuesChange/);
  const general = src('views/settings/general.jsx');
  assert.doesNotMatch(general, /unlockCore\('protected'\)/);
  assert.match(general, /return save\(\{ protected: clean\.slice\(0, 50\) \}, t\('settings\.protectedSaved'\)\);/);
  assert.ok((general.match(/\.then\(\(r\) => \{ if \(!r\)/g) ?? []).length >= 3, 'cancelled password puts the controls back');
});

test('a masked secret in a rule cannot be saved back', () => {
  assert.ok(hasHiddenSecret('x [secreto oculto] y') && !hasHiddenSecret('x'));
  const d = src('views/rules-dialogs.jsx');
  assert.match(d, /hasHiddenSecret\(v\.titulo\) \|\| hasHiddenSecret\(v\.texto\)\) throw/);
  assert.ok(es['rules.hiddenSecret'] && en['rules.hiddenSecret']);
});

test('removing a rail asks the password even when it is already off; stale removed ids are dropped', () => {
  const v = src('views/rules.jsx');
  const fn = v.slice(v.indexOf('const railRemove'), v.indexOf('const railRestore'));
  assert.match(fn, /await changeRail\(rail\.id, \{ enabled: false \}/);
  assert.doesNotMatch(fn, /activo === false \|\|/);
  assert.deepEqual(pruneRemoved(['a', 'b'], [{ id: 'a', activo: false }, { id: 'b', activo: true }]), ['a']);
  assert.deepEqual(pruneRemoved(['a'], []), ['a']);
  assert.ok(isMissingMethod(new Error('unknown method rails.list')) && !isMissingMethod(new Error('disk full')));
  assert.match(v, /bridge\.mobile \? null : \(<>/);
});
