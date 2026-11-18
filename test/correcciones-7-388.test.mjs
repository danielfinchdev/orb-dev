// Seventh round of fidelity fixes: the notice of a task that closed, the lock card, the branch menu and the event views.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { plainWhy } from '../src/engine/scheduler/finish.mjs';
import { branchList } from '../src/ui/lib/branches.js';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('1: every view that draws an event goes through activityDetail, and the raw JSON never reaches a text node', () => {
  for (const file of ['src/ui/views/activity.jsx', 'src/ui/views/expert.jsx', 'src/ui/views/tasks.jsx']) {
    const s = read(file);
    assert.match(s, /activityDetail\(/, file);
    for (const line of s.split('\n')) assert.ok(!line.includes('JSON.stringify') || /localStorage|!== JSON|const key|rawTitle/.test(line), `${file}: ${line.slice(0, 80)}`);
  }
  // the paged list draws its own parts, not the engine's pre-joined text
  assert.match(read('src/ui/views/activity.jsx'), /\{what\(r, t, locale, LINE\)\}/);
});

test('2: a closed agent is told in plain words and keeps its technical text in the result', () => {
  assert.equal(plainWhy('Codex se cerró (código 2). algo salió mal', 0.1), 'Codex se cerró con un error a los pocos segundos. Algo salió mal.');
  assert.equal(plainWhy('Codex se cerró (código 2). ', 3.2), 'Codex se cerró con un error a los 3 min.');
  assert.equal(plainWhy('no pude abrir el archivo', null), 'No pude abrir el archivo.');
  assert.doesNotMatch(plainWhy('Codex se cerró (código 2). x', 1), /código|tokens/);
  const finish = read('src/engine/scheduler/finish.mjs');
  // the full text still travels in meta.result
  assert.match(finish, /result: redactSecrets\(task\.result\)\.slice\(0, 1500\)/);
  assert.match(finish, /usageLine\(u, \{ plain: true \}\)/);
});

test('3: the lock card has the sizes of the mock-up', () => {
  const m = read('src/ui/views/master.jsx');
  assert.match(m, /w-\[440px\] max-w-full shrink-0 gap-3 border p-\[18px\]/);
  assert.match(m, /flex h-12 items-center gap-4/);
  assert.match(m, /<Label htmlFor=\{fieldId\} className="text-\[13px\] leading-\[1\.45\]">/);
  assert.match(m, /className="h-\(--ctl\) w-full"/);
  assert.match(m, /flex h-6 items-center gap-1/);
  assert.equal((m.match(/className="h-5"/g) ?? []).length, 2);
});

test('4: the branch menu always lists the current branch first, also when it is one of Orb\'s', () => {
  const list = [{ name: 'main' }, { name: 'orb/t1', orb: true }, { name: 'orb/contexto-real', orb: true, current: true }, { name: 'dev' }];
  assert.deepEqual(branchList(list, 'orb/contexto-real').map((b) => b.name), ['orb/contexto-real', 'main', 'dev']);
  assert.equal(branchList(list, 'orb/contexto-real')[0].current, true);
  assert.deepEqual(branchList([{ name: 'main', current: true }, { name: 'orb/x', orb: true }], 'main').map((b) => b.name), ['main']);
  assert.deepEqual(branchList([], 'solo').map((b) => b.name), ['solo']);
});

test('6: the summary of a rule in the list shows no template braces', async () => {
  const { readableRule } = await import('../src/ui/lib/rule-text.js');
  assert.equal(readableRule('{?navegador}Prueba en {orb} la tarea {tarea}{/}. {usuario} decide', { orb: 'Alex', usuario: 'Ana' }), 'Prueba en Alex la tarea la tarea. Ana decide');
  assert.doesNotMatch(readableRule('{orb} {del_usuario} {rama} {nota_grupo} {norma:abc}'), /[{}]/);
  assert.match(read('src/ui/views/rules-cards.jsx'), /ruleBlurb\(ruleSummary\(readableRule\(rule\.texto/);
});

test('r2-1: the row of an event says what happened, with the actor only when it is not Orb', () => {
  const a = read('src/ui/views/activity.jsx');
  assert.match(a, /activitySentence\(t, r, locale, AGENT, max\)/);
  assert.match(read('src/ui/views/expert.jsx'), /activityLabel\(t, r\.kind\)/);
  assert.equal((read('src/ui/views/tasks.jsx').match(/activityLabel\(tr, e\.kind\)/g) ?? []).length, 2);
});

test('r2-5: the notice of a closed agent is one plain sentence with the task, then the agent\'s message', async () => {
  const { closedEnd } = await import('../src/engine/scheduler/finish.mjs');
  const task = { id: 6, title: 'Limpiar dependencias sin usar' };
  assert.equal(closedEnd('Codex se cerró (código 2). algo salió mal', 0.1, task), 'Codex se cerró con un error a los pocos segundos en la tarea #6 «Limpiar dependencias sin usar». Algo salió mal.');
  assert.match(closedEnd('Codex se cerró (código 2). x', 3, task), /a los 3 min en la tarea #6/);
  assert.equal(closedEnd('no pude abrir', 1, task), null);
  assert.match(read('src/engine/scheduler/finish.mjs'), /closedLine \? `\$\{icon\} \$\{closedLine\}`/);
});
