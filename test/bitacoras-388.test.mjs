// Bitácoras as in the approved mock-up (09-bitacoras): the tabs sit in the content, the logs have two aligned columns,
// the activity filters are the app's own menus, and nothing that worked before lost its test id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { countLogEntries } from '../src/domain/journal/journal.mjs';
import { parseEntries, authorAgent, countHits } from '../src/ui/lib/logbook.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const src = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');

test('the three tabs are the line tabs of the content, with an icon each', () => {
  const m = src('views/memories.jsx');
  assert.match(m, /<TabsList variant="line"/);
  assert.match(m, /data-testid=\{`memories-\$\{id\}`\}/);
  assert.match(m, /data-testid="memories-tabs"/);
  assert.match(m, /BookOpen, Activity, Scale/);
  // the common bar is drawn by the frame, and no view puts a Segmented in it any more
  assert.match(src('views/bitacoras-page.jsx'), /<PageHeader title=\{t\('logbooks\.title'\)\} meta=\{meta\}>/);
  assert.doesNotMatch(m, /Segmented/);
});

test('Bitácoras: two columns, the search of all of them, the list with sizes and the lock note', () => {
  const l = src('views/logs.jsx');
  assert.match(l, /lg:grid-cols-\[260px_minmax\(0,1fr\)\]/);
  assert.match(l, /data-testid="log-search-all"/);
  assert.match(l, /data-testid="log-search"/);
  assert.match(l, /data-testid="log-body"/);
  assert.match(l, /<Lock [^>]*\/>\{dir \? t\('logbooks\.privateAt', \{ dir \}\) : t\('logbooks\.private'\)\}/);
  assert.match(l, /kb\(l\.size\)/);
  assert.match(l, /logbooks\.readOnly/);
  // read only: nothing here writes a log
  assert.doesNotMatch(l, /logs\.(append|write|save|delete|edit)/);
});

test('Actividad: every filter is a menu of the app, never the system select', () => {
  const a = src('views/activity.jsx');
  assert.match(a, /<Select [\s\S]*?prefix=\{t\('logbooks\.project'\)\}/);
  assert.doesNotMatch(a, /<select\b/);
  for (const id of ['activity-filters', 'activity-level', 'activity-project', 'activity-from', 'activity-to', 'activity-search', 'activity-more', 'activity-report-open']) assert.ok(a.includes(`"${id}"`), id);
  assert.ok(a.includes('activity-source-${s}'));
});

test('Normas: the same test ids as before, the inner tabs and the sections', () => {
  const r = src('views/rules.jsx');
  for (const id of ['rules-view', 'rules-locked', 'rules-new', 'rules-restore-seed', 'rules-empty', 'rules-core', 'rules-texts', 'rules-rails', 'rules-removed', 'rules-side-orb', 'rules-side-agents']) assert.ok(r.includes(`"${id}"`), id);
  assert.match(r, /<TabsList variant="line"/);
  const c = src('views/rules-cards.jsx');
  for (const id of ['rule-${rule.id}', 'rule-edit-${rule.id}', 'rule-more-${rule.id}', 'rule-toggle-${rule.id}', 'rule-delete-${rule.id}', 'rule-body-${rule.id}', 'rail-fixed-${rail.id}', 'rail-${rail.id}', 'rail-switch-${rail.id}', 'rail-more-${rail.id}', 'rail-remove-${rail.id}', 'rail-removed-${rail.id}', 'rail-restore-${rail.id}', 'rail-save-${rail.id}', 'rail-value-${k}', 'rail-caps-${id}', 'rail-paths', 'rail-path-input']) assert.ok(c.includes(id), id);
  const d = src('views/rules-dialogs.jsx');
  for (const id of ['rule-title', 'rule-text', 'rule-hidden-note']) assert.ok(d.includes(`"${id}"`), id);
});

test('the report dialog keeps its test ids', () => {
  const d = src('views/activity-report.jsx');
  for (const id of ['activity-report', 'activity-report-copy', 'activity-report-preview']) assert.ok(d.includes(`"${id}"`), id);
});

test('nothing animated carries its own app-region and colours come from tokens', () => {
  for (const f of ['views/memories.jsx', 'views/logs.jsx', 'views/activity.jsx', 'views/rules.jsx', 'views/rules-cards.jsx', 'views/bitacoras-page.jsx']) {
    const code = src(f);
    assert.doesNotMatch(code, /app-region|no-drag/, f);
    assert.doesNotMatch(code, /text-primary(?!-)/, f);
    assert.doesNotMatch(code, /text-\[/, f);
  }
});

test('parseEntries: preamble, numbered entries, date, author and topic', () => {
  const body = 'Index\n\n### 2026-11-10 18:40 — Claude (Claude Code) — Textos en inglés\nPedido de Dani\n### 2026-11-11 10:12 — Codex — El pago\nHecho\n### sin forma\ncuerpo';
  const { pre, entries } = parseEntries(body);
  assert.equal(pre, 'Index');
  assert.deepEqual(entries.map((e) => e.n), [1, 2, 3]);
  assert.equal(entries[0].author, 'Claude (Claude Code)');
  assert.equal(entries[0].topic, 'Textos en inglés');
  assert.equal(entries[0].time, '18:40');
  assert.equal(entries[1].date.getDate(), 11);
  assert.equal(entries[2].date, null);
  assert.equal(entries[2].topic, 'sin forma');
  assert.deepEqual(parseEntries('').entries, []);
  assert.equal(authorAgent('Claude (Claude Code)'), 'claude');
  assert.equal(authorAgent('G-Bot'), 'other');
});

test('countHits: only the logs that mention the text', () => {
  const bodies = { a: '### one\nhello world', b: '### two\nnothing', c: 'no entries hello' };
  assert.deepEqual(countHits(bodies, 'HELLO'), { a: 1 });
  assert.deepEqual(countHits(bodies, ' '), {});
});

test('the new texts exist in both languages', () => {
  const keys = ['logbooks.metaLogs', 'logbooks.metaActivity', 'logbooks.metaRulesN', 'logbooks.refresh', 'logbooks.searchAll', 'logbooks.noHits', 'logbooks.entriesCount', 'logbooks.intro', 'logbooks.introGeneral', 'logbooks.today', 'logbooks.yesterday', 'logbooks.preamble', 'logbooks.all', 'logbooks.markShort', 'rules.noSwitch', 'rules.fixedMeta'];
  for (const k of keys) { assert.ok(es[k], `es ${k}`); assert.ok(en[k], `en ${k}`); }
  for (const f of ['views/memories.jsx', 'views/logs.jsx', 'views/activity.jsx', 'views/rules.jsx', 'views/rules-cards.jsx', 'views/bitacoras-page.jsx']) {
    for (const m of src(f).matchAll(/\bt\('([\w.]+)'/g)) { assert.ok(es[m[1]], `es ${m[1]} (${f})`); assert.ok(en[m[1]], `en ${m[1]} (${f})`); }
  }
});

test('the bar says the same on the three tabs, the list counts entries and an empty log says so', () => {
  for (const f of ['views/logs.jsx', 'views/activity.jsx', 'views/rules.jsx']) assert.match(src(f), /meta=\{t\('nav\.logbooksHint'\)\}/, f);
  assert.equal(es['nav.logbooksHint'], 'Diario, actividad y normas');
  const l = src('views/logs.jsx');
  assert.match(l, /l\.entries \?\? kb\(l\.size\)/);
  assert.match(l, /title=\{kb\(l\.size\)\}/);
  assert.match(l, /<ProjectIcon small name=\{title\} \/>/);
  assert.match(l, /needle \? 'logbooks\.noEntries' : 'logbooks\.noEntriesYet'/);
  assert.ok(es['logbooks.noEntriesYet'] && en['logbooks.noEntriesYet']);
});

test('the activity hour column is 52 px with the hour only; the day goes in the tooltip', () => {
  const a = src('views/activity.jsx');
  assert.match(a, /grid-cols-\[52px_/);
  assert.match(a, /title=\{fmtTime\(r\.at\)\}>\{hourOf\(r\.at\)\}/);
});

test('logs.list counts entries per file version and never throws', () => {
  assert.match(fs.readFileSync(new URL('../src/engine/api/index.mjs', import.meta.url), 'utf8'), /return \{ name, size, entries: countLogEntries\(file\), \.\.\.\(principal\?\.channel === 'desktop' && name === 'general'/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-log-'));
  try {
    const f = path.join(dir, 'a.md');
    assert.equal(countLogEntries(f), 0);
    fs.writeFileSync(f, ["index", "### one", "x", "### two", "y", ""].join(String.fromCharCode(10)));
    assert.equal(countLogEntries(f), 2);
    fs.appendFileSync(f, '### three' + String.fromCharCode(10));
    assert.equal(countLogEntries(f), 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
