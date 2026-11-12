// Bitácoras (formerly «Memorias»): the Activity tab answers to both engines, Rules shows only when the engine has
// them, the old routes keep working and the new files use the type scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildQuery, dayEdge, normalizeActivity, appendPage, hasMethod, forgetMethods, previewLines, hasFilters, EMPTY_FILTERS } from '../src/ui/lib/activity-filters.js';
import { groupLogs, filterEntries } from '../src/ui/lib/logbook.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const src = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');

test('normalizeActivity: accepts the plain array and the paged answer', () => {
  const old = normalizeActivity([{ id: 3, at: '2026-11-11T10:00:00Z', actor: 'claude', kind: 'task.created', detail: 'x', task_id: 1 }]);
  assert.equal(old.paged, false);
  assert.equal(old.next, null);
  assert.equal(old.items[0].id, 'events:3');
  assert.equal(old.items[0].legacy.task_id, 1);
  const neu = normalizeActivity({ items: [{ id: 'orb:a:1', source: 'orb', level: 'warn', text: 't' }], next: 'abc' });
  assert.equal(neu.paged, true);
  assert.equal(neu.next, 'abc');
  assert.equal(neu.items.length, 1);
  assert.deepEqual(normalizeActivity(null), { paged: false, next: null, items: [] });
});

test('buildQuery: always asks with sources (so a new engine pages) and sends only the filters that are set', () => {
  const base = buildQuery(EMPTY_FILTERS);
  assert.equal(base.sources.length, 4);
  assert.equal('level' in base || 'project' in base || 'from' in base || 'cursor' in base || 'q' in base, false);
  const q = buildQuery({ sources: ['app', 'nope'], level: 'error', project: 'p', from: '2026-11-05', to: '2026-11-06', q: ' x ' }, 'cur');
  assert.deepEqual(q.sources, ['app']);
  assert.equal(q.level, 'error');
  assert.equal(q.project, 'p');
  assert.equal(q.cursor, 'cur');
  assert.equal(q.q, 'x');
  assert.ok(new Date(q.from) < new Date(q.to));
  assert.equal(dayEdge('bad', false), undefined);
  assert.equal(hasFilters(EMPTY_FILTERS), false);
  assert.equal(hasFilters({ ...EMPTY_FILTERS, level: 'warn' }), true);
});

test('appendPage never repeats a line', () => {
  assert.deepEqual(appendPage([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map((i) => i.id), ['a', 'b', 'c']);
});

test('hasMethod: an engine without the method says no, one with it says yes, and it asks once', async () => {
  forgetMethods();
  let calls = 0;
  const missing = async () => { calls += 1; throw new Error('acción desconocida: rules.list'); };
  assert.equal(await hasMethod(missing, 'rules.list'), false);
  assert.equal(await hasMethod(missing, 'rules.list'), false);
  assert.equal(calls, 1);
  assert.equal(await hasMethod(async () => [], 'activity.report', { lines: 1 }), true);
  assert.equal(await hasMethod(async () => { throw new Error('boom'); }, 'x.y'), true, 'another failure is not «missing»');
  forgetMethods();
});

test('previewLines skips the header and counts what follows', () => {
  const v = previewLines('Orb 3\nGenerado: x\nHasta: y\n\na\nb\nc', 2);
  assert.deepEqual(v.head, ['a', 'b']);
  assert.equal(v.more, 1);
  assert.equal(v.total, 3);
});

test('logbook: groups and entry search', () => {
  const g = groupLogs([{ name: 'general' }, { name: 'a' }, { name: 'vieja eliminado' }]);
  assert.equal(g.general.name, 'general');
  assert.equal(g.projects.length, 1);
  assert.equal(g.deleted.length, 1);
  const body = 'index\n### one\nhello\n### two\nworld\n';
  assert.equal(filterEntries(body, '').text, body);
  const r = filterEntries(body, 'WORLD');
  assert.equal(r.count, 1);
  assert.match(r.text, /two/);
  assert.equal(filterEntries(body, 'zzz').count, 0);
});

test('the tabs: Rules depends on rules.list and the three routes are registered', () => {
  const m = src('views/memories.jsx');
  assert.match(m, /hasMethod\(call, 'rules\.list'\)/);
  assert.match(m, /hasRules \?/);
  assert.match(m, /nav|memories-\$\{id\}/);
  const main = src('main.jsx');
  for (const r of ['logs', 'activity', 'rules']) assert.match(main, new RegExp(`${r}: MemoriesView`), `route ${r}`);
  assert.match(src('components/sidebar.jsx'), /testid: 'nav-memories'/);
  assert.match(src('components/sidebar.jsx'), /nav\.logbooks/);
  assert.match(src('views/rules.jsx'), /call\('rules\.list'/); // the real tab (test/normas-ui-384.test.mjs), no longer the «Próximamente» stub
});

test('the activity view hides the new controls on the old engine and the report without activity.report', () => {
  const a = src('views/activity.jsx');
  assert.match(a, /paged \? \(/);
  assert.match(a, /paged && canReport/);
  assert.match(a, /hasMethod\(call, 'activity\.report'/);
  assert.match(src('views/activity-report.jsx'), /call\('activity\.report', \{ at/);
});

test('texts: both languages, the privacy note says «se ocultan», and no raw pixel sizes in the new code', () => {
  const keys = Object.keys(es).filter((k) => k.startsWith('logbooks.') || k.startsWith('nav.logbooks'));
  assert.ok(keys.length > 30);
  for (const k of keys) assert.ok(en[k], `en has ${k}`);
  assert.match(es['logbooks.reportPrivacy'], /se ocultan las claves y tokens que se reconocen/);
  assert.doesNotMatch(es['logbooks.reportPrivacy'], /se quitan/);
  for (const f of ['views/memories.jsx', 'views/logs.jsx', 'views/activity.jsx', 'views/activity-report.jsx', 'views/rules.jsx']) assert.doesNotMatch(src(f), /text-\[/, f);
});
