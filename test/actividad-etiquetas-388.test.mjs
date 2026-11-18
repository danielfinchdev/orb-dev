// Every event kind the engine writes must read as plain words in the activity list (es and en), and the internal
// task states in an event's detail must be told with the same labels the Tareas view uses.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';
import { activityLabel, activityDetail } from '../src/ui/lib/activity.js';

const SRC = path.resolve(import.meta.dirname, '..', 'src');
const BACKSLASH = String.fromCharCode(92);
const KIND = /'([a-z]+(?:\.[A-Za-z_]+)+)'/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// Kinds that cannot be found by text: the defaults of board.patch / board.requeue and the ones built at run time.
const BY_HAND = ['task.updated', 'task.followup'];

// Collects the kind-shaped string literals passed straight as arguments to event(), patch() and requeue().
function engineKinds() {
  const found = new Set(BY_HAND);
  for (const dir of ['engine', 'domain', 'agents', 'mcp', 'platform']) {
    if (!fs.existsSync(path.join(SRC, dir))) continue;
    for (const file of walk(path.join(SRC, dir))) {
      const s = fs.readFileSync(file, 'utf8');
      for (const m of s.matchAll(/\b(?:event|patch|requeue)\(/g)) {
        let i = m.index + m[0].length; let depth = 1; let q = null; let cur = ''; const args = [];
        for (; i < s.length && depth > 0; i++) {
          const c = s[i];
          if (q) { cur += c; if (c === BACKSLASH) cur += s[++i]; else if (c === q) q = null; continue; }
          if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
          if ('([{'.includes(c)) depth++;
          if (')]}'.includes(c)) { depth--; if (depth === 0) break; }
          if (c === ',' && depth === 1) { args.push(cur); cur = ''; continue; }
          cur += c;
        }
        args.push(cur);
        for (const a of args) {
          if (/[({]/.test(a)) continue; // nested calls hold details and keys, not the kind
          for (const l of a.matchAll(KIND)) found.add(l[1]);
        }
      }
    }
  }
  return [...found].sort();
}

const keyOf = (kind) => `activity.kind.${kind.replace(/\./g, '_')}`;

test('every event kind the engine writes has a label in es and en', () => {
  const kinds = engineKinds();
  assert.ok(kinds.length > 40, `the scan found too few kinds (${kinds.length})`);
  const missing = kinds.filter((k) => !es[keyOf(k)] || !en[keyOf(k)]);
  assert.deepEqual(missing, [], `event kinds without a label: ${missing.join(', ')}`);
});

test('no label shows internal words', () => {
  for (const [lang, dict] of [['es', es], ['en', en]]) {
    for (const [k, v] of Object.entries(dict)) {
      if (!k.startsWith('activity.kind.')) continue;
      assert.doesNotMatch(v, /\b(pid|checkpoint|worktree|process|proceso)\b/i, `${lang} ${k}: ${v}`);
    }
  }
});

test('activityLabel tells the event in words, and keeps the raw name only for unknown kinds', () => {
  const t = (k) => es[k] ?? k;
  assert.equal(activityLabel(t, 'task.finished'), es['activity.kind.task_finished']);
  assert.equal(activityLabel(t, 'device.revokedAll'), es['activity.kind.device_revokedAll']);
  assert.equal(activityLabel(t, 'something.new'), 'something.new');
});

test('activityDetail translates internal task states and hides the process number', () => {
  const t = (k, v) => { let s = es[k] ?? k; for (const [a, b] of Object.entries(v ?? {})) s = s.replace(`{${a}}`, b); return s; };
  assert.equal(activityDetail(t, { kind: 'task.finished', detail: 'done' }, 'es'), es['status.done']);
  assert.equal(activityDetail(t, { kind: 'task.finished', detail: 'failed' }, 'es'), es['status.failed']);
  assert.equal(activityDetail(t, { kind: 'task.launched', detail: 'running' }, 'es'), es['status.running']);
  assert.equal(activityDetail(t, { kind: 'task.created', detail: 'queued' }, 'es'), es['status.queued']);
  assert.equal(activityDetail(t, { kind: 'task.process', detail: '' }, 'es'), '');
  // free text stays as it is
  assert.equal(activityDetail(t, { kind: 'project.finished', detail: 'web-antigua' }, 'es'), 'web-antigua');
});
