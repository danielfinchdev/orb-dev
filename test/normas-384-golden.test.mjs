// Golden test: the persona, the task brief and the chat briefing as they are built today. The texts are the contract of
// the rules that feed them (src/domain/rules): with the default rules untouched, the bytes must not change.
// Regenerate the fixtures on purpose with ORB_GOLDEN_WRITE=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, ROOT } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { persona } from '../src/engine/orchestrator.mjs';
import { briefing } from '../src/domain/journal/journal.mjs';
import { checkDevTools, devToolsBrief } from '../src/platform/dev-tools.mjs';
import { ensureDefaultRules } from '../src/domain/rules/rules.mjs';

const DIR = path.join(ROOT, 'test', 'fixtures', 'normas-golden');
const WRITE = process.env.ORB_GOLDEN_WRITE === '1';
let h; let board; let sched;
const marks = [];

before(() => {
  h = tempHome();
  board = new Board();
  ensureDefaultRules(); // the prompts come from the shipped rule files, as in a running engine
  sched = new Scheduler(board, {}, { log: () => {} });
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
  marks.push(h.home, h.base, real(h.home), real(h.base));
});
after(() => { board.db.close(); h.cleanup(); });

// Anything that depends on this PC or on the temp folder becomes a marker, so the fixtures are the same everywhere.
function neutral(text) {
  let out = text;
  try { out = out.split(devToolsBrief(checkDevTools(), ctx.config.userName)).join('<DEVTOOLS>'); } catch { /* none */ }
  for (const m of [...new Set(marks)].sort((a, b) => b.length - a.length)) {
    for (const v of [m, m.replaceAll('\\', '/')]) out = out.split(v).join('<HOME>');
  }
  return out.replace(/<HOME>([\\/][^\s`"')]*)/g, (_, tail) => `<HOME>${tail.replaceAll('\\', '/')}`);
}
function check(name, text) {
  const file = path.join(DIR, `${name}.txt`);
  const got = neutral(text);
  if (WRITE) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file, got); return; }
  assert.ok(fs.existsSync(file), `missing fixture ${name}`);
  assert.equal(got, fs.readFileSync(file, 'utf8'), name);
}
// Runs fn with part of the config (and the browser) changed, then puts everything back.
function withCfg(patch, fn) {
  const c = ctx.config; const saved = {}; const { browser = false, ...rest } = patch;
  for (const k of Object.keys(rest)) saved[k] = c[k];
  const browserWas = ctx.browser;
  Object.assign(c, rest);
  ctx.browser = browser ? { pipe: 'pipe', token: 'tok' } : null;
  try { return fn(); } finally { for (const k of Object.keys(saved)) c[k] = saved[k]; ctx.browser = browserWas; }
}
const mode = (m) => ({ permissions: { ...(ctx.config.permissions ?? {}), mode: m } });
const budget = (b) => ({ budget: { ...(ctx.config.budget ?? {}), ...b } });

test('persona: the spend profiles, model choice, permission mode, browser, one-at-a-time and language', () => {
  const rows = [
    ['p0-auto-model', { ...budget({ profile: 0, autoModel: true }), ...mode('auto') }],
    ['p0-manual-model', { ...budget({ profile: 0, autoModel: false }), ...mode('auto') }],
    ['p1-auto-model-ask', { ...budget({ profile: 1, autoModel: true }), ...mode('preguntar') }],
    ['p1-manual-model-ask', { ...budget({ profile: 1, autoModel: false }), ...mode('preguntar') }],
    ['p2-auto-model-browser', { ...budget({ profile: 2, autoModel: true }), ...mode('auto'), browser: true }],
    ['p2-manual-model-ask-browser', { ...budget({ profile: 2, autoModel: false }), ...mode('preguntar'), browser: true }],
    ['p3-auto-model', { ...budget({ profile: 3, autoModel: true }), ...mode('auto') }],
    ['p3-manual-model-browser', { ...budget({ profile: 3, autoModel: false }), ...mode('auto'), browser: true }],
    ['p4-auto-model-ask-browser', { ...budget({ profile: 4, autoModel: true }), ...mode('preguntar'), browser: true }],
    ['p4-manual-model', { ...budget({ profile: 4, autoModel: false }), ...mode('auto') }],
    ['default-profile', { ...budget({ profile: undefined, autoModel: undefined }), ...mode('auto') }],
    ['one-at-a-time', { ...budget({ profile: 2, autoModel: true }), oneAtATime: true }],
    ['english', { ...budget({ profile: 2, autoModel: true }), language: 'en' }],
    ['no-agents-no-rounds', { ...budget({ profile: 2, autoModel: true, maxFixRounds: 5 }), agents: Object.fromEntries(Object.keys(ctx.config.agents).map((a) => [a, { ...ctx.config.agents[a], enabled: false }])) }],
    ['two-accounts', { ...budget({ profile: 2, autoModel: false }), accounts: [...(ctx.config.accounts ?? []), { id: 'claude-2', agent: 'claude', label: 'Claude Trabajo', enabled: true }] }],
    ['no-user-name', { ...budget({ profile: 2, autoModel: true }), userName: '' }]
  ];
  for (const [name, patch] of rows) withCfg(patch, () => check(`persona-${name}`, persona(board)));
});

test('promptFor: workspaces, notes, readonly, publish, autonomy, browser, later verification, dependencies, siblings and project log', () => {
  createProject(board, { name: 'web' }, 'usuario');
  const project = () => board.project('web');
  const make = (t) => board.createTask({ project: 'web', title: 't', description: 'd', agent: 'claude', ...t }, 'usuario');
  const brief = (task, loc = {}, agent = 'claude', asked = []) => sched.promptFor(task, project(), { cwd: project().path, folder: true, ...loc }, agent, asked);
  const plain = board.task(make({ title: 'Portada', description: 'Haz la portada' }).id);
  const ro = board.task(make({ title: 'Revisar', description: 'Solo lee', readonly: true }).id);

  check('brief-folder', brief(plain));
  check('brief-folder-readonly', brief(ro));
  check('brief-isolated-no-notes', brief(plain, { folder: false, branch: 'orb/t1' }));
  check('brief-isolated-notes', brief(plain, { folder: false, branch: 'orb/t1', notes: ['Trabaja en la copia de la tarea #9, que la espera.', 'Otra nota.'] }));
  check('brief-asked-publish', brief(plain, {}, 'claude', ['publish']));
  check('brief-autonomy-auto', brief({ ...plain, autonomy: 'auto' }));
  check('brief-autonomy-ask', brief({ ...plain, autonomy: 'preguntar' }));
  check('brief-browser-on', withCfg({ browser: true }, () => brief(plain)));
  check('brief-other-agent', brief(plain, {}, 'cursor'));
  fs.writeFileSync(path.join(project().path, 'CONTRATO.md'), 'contrato');
  check('brief-contract', brief(plain));
  check('brief-contract-readonly', brief(ro));
  fs.rmSync(path.join(project().path, 'CONTRATO.md'));

  // a project log with entries, then a read-only task that waits for another one
  fs.mkdirSync(ctx.paths.projectLogs, { recursive: true });
  fs.writeFileSync(board.projectLogFile('web'), '# web\n\n### 2026-01-01 10:00 — Orb — Primera\n- Hecho: algo.\n\n### 2026-01-02 11:00 — Orb — Segunda\n- Hecho: otra cosa.\n');
  check('brief-with-log', brief(plain));
  fs.writeFileSync(board.projectLogFile('web'), '# web\n');
  check('brief-empty-log', brief(plain));

  createProject(board, { name: 'ver' }, 'usuario');
  const mk = (p, t) => board.createTask({ project: p, title: 't', description: 'd', agent: 'claude', ...t }, 'usuario');
  const build = mk('ver', { title: 'Construir', description: 'Construye' });
  mk('ver', { title: 'Verificar', description: 'Prueba', readonly: true, depends_on: [build.id] });
  check('brief-verified-later', sched.promptFor(board.task(build.id), board.project('ver'), { cwd: board.project('ver').path, folder: true }, 'claude', []));

  createProject(board, { name: 'dep' }, 'usuario');
  const base = mk('dep', { title: 'Base', description: 'La base' });
  board.run("UPDATE tasks SET result = ?, status = 'done' WHERE id = ?", 'Estructura creada.', base.id);
  board.event(base.id, 'orb', 'files.changed', 'a.js, b.js');
  const piece = mk('dep', { title: 'Pieza', description: 'Una pieza', depends_on: [base.id] });
  mk('dep', { title: 'Hermana', description: 'Otra pieza' });
  check('brief-deps-siblings', sched.promptFor(board.task(piece.id), board.project('dep'), { cwd: board.project('dep').path, folder: true }, 'claude', []));
});

test('briefing: with and without a project, with the recent lines', () => {
  fs.mkdirSync(ctx.paths.projectLogs, { recursive: true });
  fs.writeFileSync(ctx.paths.generalLog, '# General\n\n### 2026-01-01 09:00 — Orb — Inicio\n- Hecho: nada.\n');
  check('briefing-no-project', briefing(board, { project: null }));
  const web = board.project('web');
  fs.writeFileSync(board.projectLogFile('web'), '# web\n\n### 2026-01-02 11:00 — Orb — Segunda\n- Hecho: otra cosa.\n');
  check('briefing-project', briefing(board, { project: web }));
  check('briefing-recent', briefing(board, { project: web, recent: 'Usuario: hola\nOrb: hola' }));
});
