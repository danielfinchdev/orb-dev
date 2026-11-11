// The text rules (src/domain/rules): the shipped files in core\normas, the template language, how the persona, the task
// brief and the briefing use them, and that agents cannot touch the folder.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { persona } from '../src/engine/orchestrator.mjs';
import { briefing } from '../src/domain/journal/journal.mjs';
import { decide, PERMISSIONS } from '../src/domain/security/guard.mjs';
import { render } from '../src/domain/rules/render.mjs';
import { DEFAULT_RULES, hashText } from '../src/domain/rules/defaults.mjs';
import {
  ensureDefaultRules, listRules, readRule, saveRule, createRule, setRuleState, deleteRule, restoreDefaults, setRulesLogger, RuleError
} from '../src/domain/rules/rules.mjs';

let h; let board; let sched; let notes; let fixed;
const file = (id) => path.join(ctx.paths.rules, `${id}.md`);
const read = (id) => fs.readFileSync(file(id), 'utf8');

before(() => {
  h = tempHome();
  board = new Board();
  sched = new Scheduler(board, {}, { log: () => {} });
  createProject(board, { name: 'web' }, 'usuario');
  fixed = board.createTask({ project: 'web', title: 'T', description: 'D', agent: 'claude' }, 'usuario').id;
});
after(() => { board.db.close(); h.cleanup(); });
beforeEach(() => {
  fs.rmSync(ctx.paths.rules, { recursive: true, force: true });
  notes = [];
  setRulesLogger((line) => notes.push(line));
  ensureDefaultRules();
});

const brief = (task = null, loc = {}) => {
  const t = task ? board.createTask({ project: 'web', title: 'T', description: 'D', agent: 'claude', ...task }, 'usuario') : { id: fixed };
  return sched.promptFor(board.task(t.id), board.project('web'), { cwd: board.project('web').path, folder: true, ...loc }, 'claude', []);
};

test('the ten shipped rules are created, once, and the paused one stays paused', () => {
  const ids = fs.readdirSync(ctx.paths.rules).sort();
  assert.equal(ids.length, 10);
  assert.deepEqual(DEFAULT_RULES.map((r) => `${r.id}.md`).sort(), ids);
  assert.equal(readRule('varios-agentes-poco-gasto').estado, 'pausada');
  assert.equal(readRule('limites').estado, 'activa');
  assert.match(read('como-corregir'), /^---\nid: como-corregir\ntitulo: Cómo corregir\npara: orb\ntipo: texto\nestado: activa\nde_serie: sí\nserie: [0-9a-f]{12}\n---\n/);
  assert.deepEqual(ensureDefaultRules(), { created: [], updated: [] });
});

test('a rule the user changed is never overwritten; one never touched follows the shipped text; a deleted one is not made again', () => {
  saveRule('limites', { texto: '## Límites\nLos míos.' });
  const mine = read('limites');
  // an untouched rule written by an older version (its text hashes to its serie) is brought up to date
  const old = 'Para el estado de las tareas usa orb_board (antiguo).';
  fs.writeFileSync(file('contexto-al-abrir-un-chat'), read('contexto-al-abrir-un-chat').replace(/^serie: .*/m, `serie: ${hashText(old)}`).replace(/\n---\n[\s\S]*$/, `\n---\n${old}\n`));
  deleteRule('al-terminar');
  const done = ensureDefaultRules();
  assert.deepEqual(done, { created: [], updated: ['contexto-al-abrir-un-chat'] });
  assert.equal(read('limites'), mine);
  assert.equal(readRule('contexto-al-abrir-un-chat').texto, 'Para el estado de las tareas usa orb_board.');
  assert.match(read('al-terminar'), /estado: eliminada/);
  assert.equal(readRule('al-terminar'), null);
  assert.ok(!listRules().some((r) => r.id === 'al-terminar'));
  assert.ok(listRules({ deleted: true }).some((r) => r.id === 'al-terminar'));
  // a user edit whose serie no longer matches is not "untouched"
  const edited = read('contexto-al-abrir-un-chat').replace(/^serie: .*/m, 'serie: 000000000000').replace('usa orb_board.', 'usa orb_board, gracias.');
  fs.writeFileSync(file('contexto-al-abrir-un-chat'), edited);
  assert.deepEqual(ensureDefaultRules().updated, []);
  assert.equal(read('contexto-al-abrir-un-chat'), edited);
});

test('restoreDefaults puts the shipped rules back and leaves the user ones alone', () => {
  const mine = createRule({ titulo: 'Mi norma', para: 'orb', texto: 'Haz esto.' }).after;
  saveRule('limites', { texto: 'Otro texto' });
  setRuleState('mientras-trabajas', 'pausada');
  deleteRule('al-terminar');
  const { before, after: back } = restoreDefaults();
  assert.deepEqual(before.map((r) => r.id).sort(), ['al-terminar', 'limites', 'mientras-trabajas']);
  assert.equal(back.length, 3);
  assert.equal(readRule('limites').texto, DEFAULT_RULES.find((r) => r.id === 'limites').texto);
  assert.equal(readRule('mientras-trabajas').estado, 'activa');
  assert.ok(readRule('al-terminar'));
  assert.equal(readRule(mine.id).texto, 'Haz esto.');
  assert.deepEqual(restoreDefaults(), { before: [], after: [] });
});

test('domain functions: ids, validation, before and after', () => {
  const made = createRule({ titulo: 'Cómo corregir', para: 'subagentes', texto: 'x' });
  assert.equal(made.before, null);
  assert.equal(made.after.id, 'como-corregir-2', 'never collides with a shipped id');
  assert.equal(made.after.de_serie, false);
  assert.equal(createRule({ titulo: '¡¡¡', texto: 'x' }).after.id, 'norma');
  assert.match(createRule({ titulo: 'a'.repeat(80), texto: 'x' }).after.id, /^[a-z0-9-]{1,60}$/);
  const saved = saveRule(made.after.id, { titulo: 'Nuevo', texto: 'Dos\r\nlíneas\n' });
  assert.equal(saved.before.titulo, 'Cómo corregir');
  assert.equal(saved.after.texto, 'Dos\nlíneas\n', 'one trailing newline of the user survives the round trip');
  assert.equal(readRule(made.after.id).texto, 'Dos\nlíneas\n');
  assert.equal(deleteRule(made.after.id).after, null);
  assert.ok(!fs.existsSync(file(made.after.id)));
  for (const bad of [{ titulo: '' }, { titulo: 'x'.repeat(81) }, { texto: ' ' }, { texto: 'x'.repeat(20_001) }, { para: 'nadie' }]) {
    assert.throws(() => createRule({ titulo: 'Ok', para: 'orb', texto: 'ok', ...bad }), RuleError);
  }
  assert.throws(() => readRule('../x') ?? saveRule('../x', { texto: 'a' }), RuleError);
  assert.throws(() => setRuleState('limites', 'eliminada'), RuleError);
  assert.throws(() => saveRule('no-existe', { texto: 'a' }), RuleError);
});

test('render: variables, nested conditions, one pass, empty lines and other rules', () => {
  const r = (t, o = {}) => render(t, { vars: { a: 'A', ruta: '{?x}{a}{/} {norma:y}' }, conds: { si: true, no: false, ...o.conds }, norma: o.norma });
  assert.equal(r('x {a} y {desconocida} {A}'), 'x A y {desconocida} {A}');
  assert.equal(r('{?si}uno{:}dos{/}|{?no}uno{:}dos{/}|{?no}solo{/}|{?desconocida}x{:}y{/}'), 'uno|dos||y');
  assert.equal(r('{?si}a{?no}b{:}c{?si}d{/}{/}e{/}'), 'acde');
  assert.equal(r('{?no}a{?si}b{/}c{:}z{/}'), 'z');
  // the values are not read again: a path that looks like template comes out as it is
  assert.equal(r('en {ruta}!', { norma: () => 'NO' }), 'en {?x}{a}{/} {norma:y}!');
  // a line with only tags goes away, and so does a line whose only content came out empty
  assert.equal(r('uno\n{?si}\ndos\n{/}\n{?no}\ntres\n{/}\ncuatro'), 'uno\ndos\ncuatro');
  assert.equal(r('uno\n{norma:vacia}\ndos\n  {a}  \n', { norma: () => '' }), 'uno\ndos\nA\n');
  assert.equal(r('uno\n{norma:vacia}', { norma: () => '' }), 'uno');
  assert.equal(r('{norma:vacia}\nuno', { norma: () => '' }), 'uno');
  // another rule goes where it is written; empty, it also takes the space before it
  assert.equal(r('antes {norma:y} después', { norma: (id) => `<${id}>` }), 'antes <y> después');
  assert.equal(r('antes {norma:y}', { norma: () => '' }), 'antes');
  // unbalanced tags do not break anything
  assert.equal(r('a{/}b{:}c{?si}d'), 'a{/}b{:}cd');
});

test('with the shipped rules and a broken file or folder, the prompts are the shipped ones', () => {
  const normal = persona(board);
  const normalBrief = brief();
  fs.writeFileSync(file('comprobar-cada-tarea'), 'esto no es una norma');
  fs.writeFileSync(file('limites'), '---\nid: otro\n---\nx');
  assert.equal(persona(board), normal);
  assert.equal(brief(), normalBrief);
  assert.ok(notes.some((n) => /comprobar-cada-tarea/.test(n)), 'the problem is noted');
  fs.rmSync(ctx.paths.rules, { recursive: true, force: true });
  fs.writeFileSync(ctx.paths.rules, 'una carpeta que es un archivo');
  assert.equal(persona(board), normal);
  assert.equal(brief(), normalBrief);
  assert.equal(listRules().length, 10);
  fs.rmSync(ctx.paths.rules, { force: true });
  assert.equal(persona(board), normal, 'no folder at all');
});

test('pausing a rule takes it out of the prompt; turning on the new one adds it after AHORRO', () => {
  const base = persona(board);
  assert.match(base, /VERIFICACIÓN readonly/);
  setRuleState('comprobar-cada-tarea', 'pausada');
  const paused = persona(board);
  assert.doesNotMatch(paused, /VERIFICACIÓN readonly/);
  // «Cómo corregir» lost its place, so it goes to the end
  assert.ok(paused.trimEnd().split('\n').at(-1).startsWith('Si hay fallos, una tarea de corrección'), 'the correction rule is not lost');
  setRuleState('comprobar-cada-tarea', 'activa');
  setRuleState('cuando-preguntarte', 'pausada');
  assert.doesNotMatch(persona(board), /PREGUNTAS CON OPCIONES/);
  assert.equal(base.split('\n').length - 1, persona(board).split('\n').length, 'no blank line is left behind');

  setRuleState('cuando-preguntarte', 'activa');
  setRuleState('varios-agentes-poco-gasto', 'activa');
  const lines = persona(board).split('\n');
  const at = lines.findIndex((l) => l.startsWith('AHORRO:'));
  assert.match(lines[at + 1], /^VARIOS AGENTES, POCO GASTO: delega lo mecánico/);
  assert.match(lines[at + 1], /Orbe te avisa/);
  assert.match(lines[at + 2], /^CONTROL:/);

  assert.match(brief(), /## Límites/);
  setRuleState('limites', 'pausada');
  assert.doesNotMatch(brief(), /## Límites/);
  // the host is paused but the project-log rule is not: it falls to the end instead of vanishing
  setRuleState('donde-trabajas', 'pausada');
  const gone = brief();
  assert.doesNotMatch(gone, /## Dónde trabajas/);
  assert.match(gone.trimEnd().split('\n\n').at(-1), /^- No escribas BITACORA\.md/);
  setRuleState('bitacora-del-proyecto', 'pausada');
  assert.doesNotMatch(brief(), /No escribas BITACORA/);
});

test('a rule of the user goes to the end of the persona, the brief or both; a paused one does not', () => {
  const orb = createRule({ titulo: 'Solo Orb', para: 'orb', texto: 'Habla con {usuario} de {orb}. {?si}x{/}' }).after;
  const sub = createRule({ titulo: 'Solo agentes', para: 'subagentes', texto: 'Comprueba {tarea}.' }).after;
  const both = createRule({ titulo: 'Los dos', para: 'ambos', texto: 'Sé breve.\nSin adornos.' }).after;
  const quiet = createRule({ titulo: 'Callada', para: 'ambos', texto: 'No debería verse.' }).after;
  setRuleState(quiet.id, 'pausada');
  const p = persona(board);
  assert.match(p, /\nNORMAS QUE HA AÑADIDO Ana:\n- Los dos: Sé breve\.\nSin adornos\.\n- Solo Orb: Habla con Ana de Orbe\. $/);
  assert.doesNotMatch(p, /Comprueba|No debería verse/);
  const b = brief();
  assert.match(b, /\n\n## Normas de Ana\n### Los dos\nSé breve\.\nSin adornos\.\n### Solo agentes\nComprueba \d+\.$/);
  assert.doesNotMatch(b, /Habla con|No debería verse/);
  void orb; void sub;
});

test('values that look like template are not read again in the brief', () => {
  const text = brief({ title: 'T', description: 'Usa {?navegador}x{/} y {orb}' }, { folder: false, branch: 'rama-{orb}', notes: ['nota {?auto}A{/}'] });
  assert.match(text, /Usa \{\?navegador\}x\{\/\} y \{orb\}/);
  assert.match(text, /\(rama `rama-\{orb\}`\)/);
  assert.match(text, /- nota \{\?auto\}A\{\/\}/);
});

test('agents cannot write, delete or list-and-read core\\normas: the rule on core covers it', () => {
  const internal = ctx.paths.core;
  const target = path.join(ctx.paths.rules, 'limites.md');
  const cases = [
    { tool: 'Edit', paths: [target] }, { tool: 'Write', paths: [path.join(ctx.paths.rules, 'nueva.md')] },
    { tool: 'Bash', command: `rm "${target}"`, cwd: internal },
    { tool: 'Bash', command: 'del normas\\limites.md', cwd: internal },
    { tool: 'PowerShell', command: `Set-Content -Path "${target}" -Value hola` },
    { tool: 'Read', paths: [target] }
  ];
  for (const action of cases) {
    for (const permission of PERMISSIONS) {
      assert.equal(decide({ permission, internalDir: internal, cwd: path.dirname(internal), ...action }).decision, 'deny', `${action.tool} ${action.command ?? action.paths} con «${permission}»`);
    }
  }
});
