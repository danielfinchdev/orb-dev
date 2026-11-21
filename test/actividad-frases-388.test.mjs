// Every row of the Actividad list is one plain sentence (es and en): a template per event kind, holes that close without
// leaving marks, no exit codes, no internal words, and each event carries its own source.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';
import { activitySentence, activityDetail, activityPlain } from '../src/ui/lib/activity.js';
import { sourceOf } from '../src/domain/activity/activity.mjs';

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

const BY_HAND = ['task.updated', 'task.followup'];
// The same scan as the labels test: the kind-shaped literals passed straight to event(), patch() and requeue().
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
          if (/[({]/.test(a)) continue;
          for (const l of a.matchAll(KIND)) found.add(l[1]);
        }
      }
    }
  }
  return [...found].sort();
}

const sayKey = (kind) => `activity.say.${kind.replace(/\./g, '_')}`;
const mk = (dict) => (k, v) => { let s = dict[k] ?? k; for (const [a, b] of Object.entries(v ?? {})) s = s.replaceAll(`{${a}}`, b); return s; };
const tEs = mk(es); const tEn = mk(en);
const AGENTS = { claude: 'Claude', codex: 'Codex', orb: 'Orb' };
const say = (row, t = tEs, locale = 'es') => activitySentence(t, row, locale, AGENTS, 140);

test('every event kind the engine writes has a sentence in es and en', () => {
  const kinds = engineKinds();
  assert.ok(kinds.length > 40, `the scan found too few kinds (${kinds.length})`);
  const missing = kinds.filter((k) => !es[sayKey(k)] || !en[sayKey(k)]);
  assert.deepEqual(missing, [], `event kinds without a sentence: ${missing.join(', ')}`);
});

// the internal state words of the engine (English ones are only wrong in the Spanish text)
const STATES = /(done|failed|queued|running|blocked|cancelled)/;
const BAD = [/[{}"]/, /\bnull\b/, /\bundefined\b/, /orb_/, /c[oó]digo/i, /\bcode \d/i, /\s{2}/, /«\s*»/, /\s[:,;]/, /[:,;(]$/, /\.\.(?!\.)/];

// One realistic event of every kind, with and without a task, a title and a detail.
const DETAIL = {
  'task.usage': '{"minutes":2,"tokens":null,"costUsd":null}',
  'task.launch_options': '{"agent":"codex","model":"fake-codex-1"}',
  'task.finished': 'failed',
  'task.created': 'queued',
  'agent.reply': 'fallida: Claude Code se cerró (código 2). algo salió mal',
  'project.finished': 'web-antigua',
  'project.renamed': 'viejo -> nuevo',
  'project.saved': 'blog -> C:\\work\\blog',
  'project.active': 'ninguno',
  'files.changed': 'M src/a.js, A src/b.js',
  'task.delegated': '#7 Arreglar el login → codex · queued'
};
test('a battery of events gives clean sentences in es and en, with every hole filled or closed', () => {
  for (const [lang, t] of [['es', tEs], ['en', tEn]]) {
    for (const kind of engineKinds()) {
      for (const actor of ['orb', 'usuario', 'claude']) {
        for (const shape of [{ task: 42, title: 'Guardar el carrito' }, { task: null, title: null }, { task: 5, title: null }]) {
          const detail = DETAIL[kind] ?? (shape.task ? 'todo bien' : '');
          for (const d of [detail, '']) {
            const out = say({ kind, actor, detail: d, source: 'subagentes', ...shape, text: '' }, t, lang);
            const where = `${lang} ${kind} ${actor} ${JSON.stringify(shape)} «${d}» → ${out}`;
            assert.ok(out && /^[A-ZÁÉÍÓÚÑ¿¡]/.test(out), `capital: ${where}`);
            for (const re of BAD) assert.doesNotMatch(out, re, where);
            if (lang === 'es') assert.doesNotMatch(out, STATES, where);
            assert.doesNotMatch(out, /[:,;(]$/, where);
          }
        }
      }
    }
  }
});

test('the sentences of the examples', () => {
  const row = (kind, actor, extra = {}) => ({ kind, actor, source: 'subagentes', text: '', ...extra });
  assert.equal(say(row('task.launched', 'claude', { task: 42, title: 'Guardar el carrito entre recargas' })), 'Claude empezó la tarea #42 «Guardar el carrito entre recargas»');
  assert.equal(say(row('task.created', 'usuario', { task: 42, title: 'X' })), 'Creaste la tarea #42 «X»');
  assert.equal(say(row('task.created', 'usuario', { task: 42, title: 'X' }), tEn, 'en'), 'You created task #42 «X»');
  assert.equal(say(row('task.finished', 'orb', { task: 15, title: 'Informe', detail: 'done' })), 'La tarea #15 «Informe» terminó: completada');
  assert.equal(say(row('task.usage', 'orb', { task: 15, title: 'Informe', detail: '{"minutes":0,"tokens":null,"costUsd":null}' })), 'La tarea #15 «Informe» usó <1 min');
  assert.equal(say(row('project.finished', 'usuario', { detail: 'web-antigua' })), 'Diste por terminado el proyecto web-antigua');
  assert.equal(say(row('project.saved', 'usuario', { detail: 'blog -> C:\\work\\blog' })), 'Guardaste el proyecto blog');
  assert.equal(say(row('project.renamed', 'usuario', { detail: 'viejo -> nuevo' })), 'Cambiaste el nombre del proyecto viejo por nuevo');
  assert.equal(say(row('task.finished', 'orb', { task: 3 })), 'La tarea #3 terminó');
  assert.equal(say(row('agent.reply', 'claude', { task: 9, title: 'Revisión', detail: 'fallida: Claude Code se cerró (código 2). algo salió mal' })),
    'Claude respondió en la tarea #9 «Revisión» y la dio por fallida: Claude Code se cerró con un error. Algo salió mal.');
  assert.equal(say(row('files.changed', 'orb', { task: 9, title: 'R', detail: 'M src/a.js, A src/b.js' })), 'La tarea #9 «R» cambió archivos: src/a.js, src/b.js');
});

test('the exit code is never shown, in any place that tells a text', () => {
  assert.equal(activityPlain(tEs, 'Claude Code se cerró (código 2). algo salió mal'), 'Claude Code se cerró con un error. Algo salió mal.');
  assert.equal(activityPlain(tEn, 'Claude Code closed (code 2). something went wrong'), 'Claude Code closed with an error. Something went wrong.');
  assert.equal(activityDetail(tEs, { kind: 'agent.reply', detail: 'fallida: Claude Code se cerró (código 2). algo salió mal' }, 'es', AGENTS), 'fallida: Claude Code se cerró con un error. Algo salió mal');
  assert.doesNotMatch(activityPlain(tEs, 'tarea #14 terminó (código 1, estado: fallida)'), /c[oó]digo/);
  assert.doesNotMatch(activityPlain(tEs, 'salió con código 137'), /137/);
});

test('the engine log lines are sentences', () => {
  const line = (text) => say({ kind: 'motor', source: 'orb', text });
  assert.equal(line('tarea #15 terminó (código 0, estado done)'), 'La tarea #15 terminó: completada');
  assert.equal(line('tarea #14 terminó (código 1, estado failed)'), 'La tarea #14 terminó: fallida');
  assert.equal(line('tarea #14 terminó (código 1, estado failed, detenida)'), 'La tarea #14 se detuvo y terminó: fallida');
  assert.equal(line('tarea #1 lanzada con Codex (fake-codex-1) en C:\\Users\\x\\Proyectos\\blog'), 'La tarea #1 empezó con Codex (fake-codex-1)');
  assert.equal(line('tarea #2 lanzada con codex en /home/x/blog'), 'La tarea #2 empezó con Codex');
  assert.equal(line('arranca el motor (código 0)'), 'Arranca el motor');
  assert.equal(line('fallo al abrir (código 3)'), 'Fallo al abrir con un error');
});

test('settings are told in plain words', () => {
  const row = (text, extra = {}) => ({ kind: 'settings.change', source: 'usuario', text, ...extra });
  assert.equal(say(row('settings: ui.theme')), 'Cambiaste el tema de la aplicación');
  assert.equal(say(row('settings: ui.theme'), tEn, 'en'), 'You changed the app theme');
  assert.equal(say(row('[movil] settings: ui.zoom')), 'Cambiaste el tamaño de la interfaz desde el móvil');
  assert.equal(say(row('settings: ui.music.volume')), 'Cambiaste la música de fondo');
  assert.equal(say(row('settings: budget.stopAt')), 'Cambiaste el límite de uso');
  assert.equal(say(row('settings: algo.raro')), 'Cambiaste un ajuste');
  assert.equal(say(row('settings: ui.theme, budget.stopAt')), 'Cambiaste varios ajustes');
  assert.equal(say(row('settings: ui.theme, ui.skin')), 'Cambiaste varios ajustes');
  assert.equal(say(row('settings: -')), 'Cambiaste un ajuste');
});

test('what the user did is told in plain words', () => {
  const u = (kind, text) => say({ kind, source: 'usuario', text });
  assert.equal(u('approval.decision', 'task #7 approved'), 'Aprobaste la tarea #7');
  assert.equal(u('approval.decision', 'task #7 rejected'), 'Rechazaste la tarea #7');
  assert.equal(u('undo.task', 'task #7 undone'), 'Deshiciste los cambios de la tarea #7');
  assert.equal(u('chat.message', 'hola Orbe'), 'Escribiste en el chat: hola Orbe');
  assert.equal(u('file.create', 'created C:\\work\\blog\\notas.md'), 'Creaste el archivo notas.md');
  assert.equal(u('rules.pause', 'rules.pause r1: Límites'), 'Pausaste la norma «Límites»');
  assert.equal(u('rules.restoreDefaults', 'rules.restoreDefaults'), 'Restauraste las normas de serie');
  assert.equal(u('trash.restore', 'conversations 12 restored'), 'Recuperaste una conversación de la papelera');
  for (const [kind, text] of [['git.switch', 'branch a -> b'], ['git.branch', 'created branch x and switched to it'], ['git.undo', 'undid save abc123: arreglar el login'], ['approval.decision', 'session s1 request Bash: approved'], ['rails.set', 'rail r1'], ['rails.restore', 'all rails restored to defaults']]) {
    const out = u(kind, text);
    for (const re of BAD) assert.doesNotMatch(out, re, out);
    assert.doesNotMatch(out, /\b(approved|created|undid|branch|rail)\b/, out);
  }
});

test('the source of each event is its own', () => {
  assert.equal(sourceOf('usuario', 'project.finished'), 'usuario');
  assert.equal(sourceOf('usuario', 'task.approved'), 'usuario');
  assert.equal(sourceOf('orb', 'task.launched'), 'orb');
  assert.equal(sourceOf('orb', 'task.finished'), 'orb');
  assert.equal(sourceOf('orb', 'task.usage'), 'subagentes');
  assert.equal(sourceOf('orb', 'files.changed'), 'subagentes');
  assert.equal(sourceOf('claude', 'agent.reply'), 'subagentes');
  assert.equal(sourceOf('agente', 'agent.reply'), 'subagentes');
  assert.equal(sourceOf('claude', 'task.created'), 'subagentes');
});
