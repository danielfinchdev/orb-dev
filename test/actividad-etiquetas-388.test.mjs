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

// The real cases that showed JSON and the engine's own names in Actividad.
const tr = (k, v) => { let s = es[k] ?? k; for (const [a, b] of Object.entries(v ?? {})) s = s.replace(`{${a}}`, b); return s; };
const AGENTS = { codex: 'Codex', claude: 'Claude' };
const detail = (kind, d, max) => activityDetail(tr, { kind, detail: d }, 'es', AGENTS, max);

test('task usage and launch options are told as a sentence', () => {
  assert.equal(detail('task.usage', '{"minutes":0,"tokens":null,"costUsd":null}'), '<1 min');
  assert.equal(detail('task.usage', '{"minutes":3,"tokens":12400,"costUsd":0.04}'), `3 min · ${(12400).toLocaleString('es')} tokens · $0,04`);
  assert.equal(detail('task.launch_options', '{"agent":"codex","account":"codex","model":"fake-codex-1","reasoning":null,"fast":false}'), 'Codex · modelo fake-codex-1');
  assert.equal(detail('task.launch_options', '{"agent":"codex","account":"codex-2","model":null}'), 'Codex · cuenta codex-2');
});

test('an object of an unknown kind says nothing; a cut-off one neither', () => {
  assert.equal(detail('task.other', '{"a":1,"b":"x"}'), '');
  assert.equal(detail('task.other', '["a","b"]'), '');
  assert.equal(detail('task.usage', '{"minutes":3,"tok'), '');
});

test('tool names and quoted states are told in words, and long texts are cut to one line', () => {
  assert.equal(detail('files.given', 'orb_give_files'), es['activity.tool.give_files']);
  const out = detail('user.message', 'AVISO DEL SISTEMA (no es Alex): pasa archivos con orb_give_files y vuelve a ponerla en cola con orb_update_task status "queued", o propón otro agente. '.repeat(3), 100);
  assert.ok(out.length <= 101 && out.endsWith('…') && !out.includes('\n'));
  assert.doesNotMatch(out, /orb_|"queued"/);
  assert.match(detail('x.y', 'orb_update_task status "queued"'), /actualizar la tarea · en cola/);
});

test('no detail shows JSON, null, a tool name or an internal state', () => {
  const battery = ['{"minutes":0,"tokens":null,"costUsd":null}', '{"agent":"codex","model":null}', '[1,2,{"a":null}]', '{"x":', 'orb_ask', 'orb_browser_click ref 3', 'orb_update_task status "blocked"', 'status "failed" y "done"', 'orb_cosa_nueva', 'null', '"queued"', 'running'];
  for (const kind of ['task.usage', 'task.launch_options', 'task.updated', 'note']) {
    for (const d of battery) {
      const out = detail(kind, d);
      assert.doesNotMatch(out, /[{}\[\]]|\bnull\b|orb_/, `${kind} ${d} → ${out}`);
      assert.doesNotMatch(out, /"/, `${kind} ${d} → ${out}`);
      assert.doesNotMatch(out, /\b(queued|running|failed|blocked|done)\b/, `${kind} ${d} → ${out}`);
    }
  }
});

test('every orb_ tool of the MCP server has a label in es and en', () => {
  const server = fs.readFileSync(path.join(SRC, 'mcp', 'server.mjs'), 'utf8') + fs.readdirSync(path.join(SRC, 'mcp')).map((f) => fs.readFileSync(path.join(SRC, 'mcp', f), 'utf8')).join('');
  const names = [...new Set([...server.matchAll(/name: '(orb_[a-z_]+)'/g)].map((m) => m[1]))];
  assert.ok(names.length > 20);
  for (const n of names) {
    const short = n.replace(/^orb_/, '').replace(/^browser_.*/, 'browser').replace(/^android_.*/, 'android');
    assert.ok(es[`activity.tool.${short}`] && en[`activity.tool.${short}`], n);
  }
});

test('agent ids, log lines and Markdown marks read in plain words', () => {
  assert.equal(detail('task.followup', 'misma conversación · codex', 0), 'misma conversación · Codex');
  assert.equal(activityDetail(tr, { kind: 'task.followup', detail: 'misma conversación · codex' }, 'es', AGENTS), 'misma conversación · Codex');
  assert.equal(activityDetail(tr, { kind: 'motor', detail: 'tarea #1 terminó (código 0, estado done)' }, 'es', AGENTS), `tarea #1 terminó (estado: ${es['status.done'].toLowerCase()})`);
  assert.equal(activityDetail(tr, { kind: 'motor', detail: 'tarea #1 terminó (código 2, estado failed)' }, 'es', AGENTS), `tarea #1 terminó (estado: ${es['status.failed'].toLowerCase()})`);
  const out = activityDetail(tr, { kind: 'asistente', detail: '## Contexto (lo añade Orbe al empezar)\n- Orbe: C:/Users/x/proyecto '.repeat(3) }, 'es', AGENTS, 60);
  assert.ok(!/^[#>*-]/.test(out) && out.endsWith('…') && out.length <= 61, out);
});
