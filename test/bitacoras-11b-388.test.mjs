// 3.8.8 paso 11b (tanda 8), interfaz de Bitácoras, Actividad y Normas: totales por fuente y nivel, «Revisar tarea #N»,
// lo que de verdad rota, «desbloqueado, quedan N min» y los diálogos de normas con «Antes / Después» y la contraseña en línea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildQuery, normalizeActivity } from '../src/ui/lib/activity-filters.js';
import { linePatch, railSaveView } from '../src/ui/lib/rules-diff.js';
import { ruleAction, railAction, RULE_METHOD, asksEveryTime } from '../src/ui/lib/rules-access.js';
import { keepUnlock, dropUnlock, heldUnlock, heldUntil, FRESH_ACTIONS } from '../src/ui/lib/core-access.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const activity = read('src/ui/views/activity.jsx');
const rules = read('src/ui/views/rules.jsx');
const dialogs = read('src/ui/views/rules-dialogs.jsx');
const actions = read('src/ui/lib/rules-actions.js');

test('Actividad: los totales se piden con la primera página y se leen solo si tienen su forma', () => {
  assert.equal(buildQuery({ sources: [] }).counts, true);
  assert.equal(buildQuery({ sources: [] }, 'abc').counts, undefined);
  const good = { items: [], next: null, counts: { sources: { orb: 3, subagentes: 2, usuario: 1, app: 0 }, levels: { info: 4, warn: 1, error: 1 }, partial: true } };
  assert.deepEqual(normalizeActivity(good).counts, { sources: good.counts.sources, levels: good.counts.levels, partial: true });
  assert.equal(normalizeActivity({ items: [], next: null }).counts, null);
  assert.equal(normalizeActivity({ items: [], counts: { sources: { orb: 'x' }, levels: {} } }).counts, null);
  assert.match(activity, /data-testid="activity-count"/);
  assert.match(activity, /num\(counts\?\.sources\[s\]\)/);
  assert.match(activity, /num\(counts\?\.levels\[l\]\)/);
});

test('Actividad: «Revisar tarea #N» sale solo de una fila con tarea y abre esa tarea', () => {
  assert.match(activity, /r\.task != null \? <Button onClick=\{\(\) => go\(\{ view: 'tasks', id: r\.task \}\)\} data-testid="activity-review-task">/);
  assert.match(activity, /data-testid="activity-task"/);
  for (const l of [es, en]) { assert.match(l['logbooks.reviewTask'], /#\{n\}/); assert.ok(l['logbooks.task']); }
});

test('Actividad: el pie dice lo que rota de verdad (10 MB en Orb, Usuario y App; Subagentes no)', () => {
  assert.match(es['logbooks.local'], /10 MB/);
  assert.match(es['logbooks.local'], /Subagentes no rota/);
  assert.match(en['logbooks.local'], /10 MB/);
  assert.match(en['logbooks.local'], /Subagents one does not rotate/);
});

test('el desbloqueo: solo se lee cuánto queda, nunca la ficha', () => {
  dropUnlock();
  assert.equal(heldUntil(), null);
  const until = Date.now() + 4 * 60_000;
  keepUnlock({ unlock: 'token-de-prueba', until });
  assert.equal(heldUntil(), until);
  assert.equal(typeof heldUntil(), 'number');
  assert.equal(heldUnlock(), 'token-de-prueba');
  dropUnlock();
  assert.equal(heldUntil(), null);
  // a nearly spent unlock does not count as «quedan N min»
  keepUnlock({ unlock: 'x', until: Date.now() + 3000 });
  assert.equal(heldUntil(), null);
  dropUnlock();
});

test('Normas: «Desbloquear» abre el mismo diálogo de contraseña y no hay otra forma de desbloquear', () => {
  assert.match(rules, /const unlock = async \(\) => \{ await unlockCore\('rules'\); setNow\(Date\.now\(\)\); \};/);
  assert.match(rules, /data-testid="rules-unlock"/);
  assert.match(rules, /\{!left && !bridge\.mobile \?/);
  assert.doesNotMatch(rules, /call\('master\./);
  assert.doesNotMatch(rules, /useState\([^)]*assword/);
  assert.doesNotMatch(rules, /Bloquear ahora/);
  assert.match(es['rules.unlockedPill'], /quedan \{n\} min/);
  assert.match(en['rules.unlockedPill'], /\{n\} min left/);
});

test('Normas: las llamadas y lo que pide cada cambio son los de siempre', () => {
  assert.deepEqual({ ...RULE_METHOD }, { create: 'rules.create', save: 'rules.save', pause: 'rules.pause', resume: 'rules.resume', delete: 'rules.delete', restoreDefaults: 'rules.restoreDefaults' });
  assert.equal(ruleAction('create'), 'rules');
  assert.equal(ruleAction('save', { de_serie: true }), 'ruleSeed');
  assert.equal(ruleAction('save', { de_serie: false }), 'rules');
  assert.equal(ruleAction('pause', { de_serie: true }), 'ruleSeed');
  assert.equal(ruleAction('delete', { de_serie: true }), 'ruleSeed');
  assert.equal(ruleAction('restoreDefaults'), 'ruleSeed');
  assert.equal(railAction(), 'rails');
  assert.deepEqual([...FRESH_ACTIONS].sort(), ['deleteProject', 'newKey', 'rails', 'ruleSeed', 'secretSave', 'secretSaved']);
  assert.ok(asksEveryTime('rails') && asksEveryTime('ruleSeed') && !asksEveryTime('rules'));
  // the call and its parameters are built where they always were; a token already asked in line only replaces the asking
  assert.match(actions, /const unlock = given \?\? await unlockCore\(action\);/);
  assert.match(actions, /return act\(call\(method, \{ \.\.\.params, unlock \}\), ok\);/);
  assert.match(actions, /guarded\(railAction\(\), 'rails\.set', \{ id, \.\.\.change \}, ok, unlock\)/);
});

test('Normas: la contraseña va en línea, solo a master.unlock, y se vacía si falla', () => {
  assert.match(dialogs, /type="password" autoComplete="off"/);
  assert.match(dialogs, /call\('master\.unlock', \{ password, \.\.\.\(fresh \? \{ purpose: action \} : \{\}\) \}\)/);
  assert.equal([...dialogs.matchAll(/call\('master\./g)].length, 1);
  // a fresh action never keeps its token; the usual unlock keeps it the same way the separate dialog did
  assert.match(dialogs, /return fresh \? r\?\.unlock \?\? null : keepUnlock\(r\);/);
  assert.match(dialogs, /reset\?\.\(\{ password: '', askPw: true \}\)/);
  assert.doesNotMatch(dialogs, /localStorage|sessionStorage|console\./);
  // the typed password is read only by takeUnlock: no other place copies it
  assert.equal([...dialogs.matchAll(/v\.password/g)].length, 3);
});

test('Normas: cada diálogo vuelve a leer lo que el motor tiene ahora antes de enseñar «Antes / Después»', () => {
  for (const name of ['confirmPauseRail', 'confirmResumeRail', 'confirmRemoveRail', 'confirmRestoreRail', 'confirmSaveRail']) assert.match(dialogs, new RegExp(`export async function ${name}\\([^)]*\\) \\{\\n  const now = await currentRail\\(`), name);
  for (const name of ['confirmPauseRule', 'confirmDeleteRule', 'confirmSaveRule']) assert.match(dialogs, new RegExp(`export async function ${name}\\([^)]*\\) \\{\\n  const now = await currentRule\\(`), name);
  assert.match(dialogs, /call\('rails\.list', \{\}\)/);
  assert.match(dialogs, /call\('rules\.read', \{ id \}\)/);
  assert.match(dialogs, /data-testid="rules-compare"/);
  // the values saved are those compared against the engine's own
  assert.match(rules, /changeRail\(rail\.id, \{ values: ok\.changed \}/);
});

test('Normas: editar una norma pide su confirmación con Antes / Después antes de guardar; crear la pide en línea', () => {
  assert.match(rules, /const ok = await confirmSaveRule\(rule, r\.fields, r\.initial\);\n    if \(ok && await changeRule\('save', rule, r\.fields, t\('rules\.saved'\), ok\.unlock\)\) load\(\);/);
  assert.match(rules, /if \(r\?\.fields && await changeRule\('create', null, r\.fields, t\('rules\.created'\), r\.unlock\)\) load\(\);/);
  assert.match(dialogs, /if \(current\) return \{ fields, initial \};/);
  for (const id of ['rule-preview', 'rule-state', 'rule-file', 'rule-dirty', 'rule-editor-toggle', 'rule-editor-delete']) assert.match(dialogs, new RegExp(`data-testid="${id}"`));
  // the pause and delete buttons of the editor lead to the confirmations of the list
  assert.match(rules, /if \(r\.op === 'delete'\) \{ await del\(rule\); return; \}/);
});

test('Antes / Después de un texto: un parche con lo quitado y lo añadido', () => {
  assert.equal(linePatch('a\nb', 'a\nb'), '');
  const p = linePatch('uno\ndos\ntres', 'uno\n2\ntres\ncuatro');
  assert.match(p, /^@@ -1,3 \+1,4 @@\n/);
  assert.deepEqual(p.split('\n').slice(1, -1), [' uno', '-dos', '+2', ' tres', '+cuatro']);
  assert.deepEqual(linePatch('', 'x').split('\n').slice(1, -1), ['-', '+x']);
  const big = Array.from({ length: 2100 }, (_, i) => `l${i}`).join('\n');
  assert.ok(linePatch(big, `${big}\nmás`).includes('+más'));
});

test('los textos nuevos existen en español y en inglés', () => {
  const keys = ['rules.unlockedPill', 'rules.unlock', 'rules.needPassword', 'rules.unlockedNote', 'rules.askNote', 'rules.unsaved', 'rules.preview', 'rules.fieldState', 'rules.file', 'rules.fileNew', 'rules.appendOrb', 'rules.appendAgents', 'rules.appendBoth', 'rules.seedNote', 'rules.mineNote', 'rules.newNote', 'rules.saveRuleTitle', 'rules.saveRuleBody', 'rules.saveRailBody', 'rules.noChanges', 'rules.deletedState', 'rules.removedState', 'rules.nowValues', 'rules.newValues', 'rules.pauseRule', 'rules.deleteRule'];
  for (const k of keys) for (const l of [es, en]) assert.ok(l[k], k);
  assert.match(es['rules.textHint'], /vista previa/);
});

test('guardar un raíl: solo se guarda lo que el usuario editó, y lo que cambió por debajo se avisa', () => {
  const loaded = { a: 1, protected: ['x'] };
  const nowEngine = { a: 1, protected: ['x', 'y'] };
  const v = railSaveView(loaded, nowEngine, { a: 2 });
  assert.deepEqual(v.changed, { a: 2 });
  assert.deepEqual(v.before, { a: 1 });
  assert.deepEqual(v.stale, []);
  const w = railSaveView(loaded, nowEngine, { a: 2, protected: ['x', 'z'] });
  assert.deepEqual(w.stale, ['protected']);
  assert.deepEqual(w.before.protected, ['x', 'y']);
});

test('Normas y Actividad: avisos de lo que cambió, botones del editor y totales sin teclear', () => {
  const dialogs = fs.readFileSync('src/ui/views/rules-dialogs.jsx', 'utf8');
  assert.match(dialogs, /railSaveView\(/);
  assert.match(dialogs, /rules\.staleValues/);
  assert.match(dialogs, /rules\.staleRule/);
  assert.equal((dialogs.match(/disabled=\{dirty\} title=\{dirty \? t\('rules\.saveFirst'\)/g) ?? []).length, 2);
  const rules = fs.readFileSync('src/ui/views/rules.jsx', 'utf8');
  assert.match(rules, /await toggle\(rule, r\.op\)/);
  assert.match(rules, /rules\.alreadyState/);
  const act = fs.readFileSync('src/ui/views/activity.jsx', 'utf8');
  assert.match(act, /countsKey\(filters\)/);
  assert.equal(buildQuery({ sources: [] }, null, { counts: false }).counts, undefined);
  for (const k of ['rules.staleValues', 'rules.staleRule', 'rules.saveFirst', 'rules.alreadyState']) { assert.ok(es[k], k); assert.ok(en[k], k); }
});
