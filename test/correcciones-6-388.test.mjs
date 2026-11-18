// Sixth round of fidelity fixes: one check per point of the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(jsx?|mjs)$/.test(e.name) ? [`${dir}/${e.name}`] : []));

test('1: no JSON.stringify reaches a text node of a view or a component; engine events and tools are told in plain words', () => {
  // Legitimate uses only: storage, equality and cache keys, and values of `title` (the raw stays on hover).
  const allowed = [/localStorage\.setItem/, /JSON\.stringify\(\w+\) !== JSON\.stringify/, /JSON\.stringify\(v\[k\]\)/, /const key = JSON\.stringify\(\[/, /const rawTitle = /];
  for (const file of [...walk('src/ui/views'), ...walk('src/ui/components')]) {
    read(file).split('\n').forEach((line, i) => {
      if (line.includes('JSON.stringify') && !allowed.some((re) => re.test(line))) assert.fail(`${file}:${i + 1} puts JSON.stringify on screen`);
    });
  }
  const session = read('src/ui/views/session.jsx');
  assert.match(session, /title=\{rawTitle\(body\)\}>\{typeof body === 'string' \? body : t\('session\.unknownEvent'\)\}/);
  // the task's history spoke the engine's words («task.usage {"costUsd":null}», «orb_update_task»)
  const tasks = read('src/ui/views/tasks.jsx');
  assert.doesNotMatch(tasks, /<span className="font-medium">\{e\.kind\}<\/span>/);
  assert.equal((tasks.match(/activityLabel\(tr, e\.kind\)/g) ?? []).length, 2);
  assert.equal((tasks.match(/title=\{e\.detail\}/g) ?? []).length, 2);
  const act = read('src/ui/lib/activity.js');
  assert.match(act, /replace\(\/\\borb_\[a-z_\]\+\\b\/g, t\('activity\.tool'\)\)/);
  for (const lang of ['es', 'en']) {
    assert.match(locale(lang, 'activity.mjs'), /'activity\.tool'/);
    assert.match(locale(lang, 'session.mjs'), /'session\.unknownEvent'/);
  }
});
function locale(lang, file) { return read(`src/shared/locales/${lang}/${file}`); }

test('2: one «Mostrar» only: the browser\'s own reveal and clear buttons are hidden and ours is plain grey text, as in the mock-up', () => {
  assert.match(read('src/ui/app.css'), /input::-ms-reveal, input::-ms-clear \{ display: none; \}/);
  const master = read('src/ui/views/master.jsx');
  const reveal = master.slice(master.indexOf('function RevealButton'), master.indexOf('// «He olvidado la contraseña»'));
  assert.match(reveal, /text-muted-foreground/);
  assert.doesNotMatch(reveal, /text-info|<Eye/);
});

test('3: lock screen: «Usar código de recuperación» is a grey 24 px button (mock-up 17: oklch(.5 0 0), 13 px, 12 px side padding)', () => {
  const master = read('src/ui/views/master.jsx');
  const link = master.match(/const linkClass = '([^']+)'/)[1];
  for (const c of ['text-muted-foreground', 'h-6', 'px-3', 'text-[13px]']) assert.ok(link.split(' ').includes(c), c);
  assert.ok(!link.includes('text-info'));
  assert.match(master, /text-xs leading-\[1\.45\]" data-testid="master-screen-note"/);
});

test('4: the welcome centres its column as the mock-up does (32 px padding, 24 px gap): steps and card keep one rhythm in every step', () => {
  const wizard = read('src/ui/components/wizard.jsx');
  assert.match(wizard, /flex h-full flex-col overflow-y-auto px-6 py-8/);
  assert.match(wizard, /m-auto flex w-full flex-col items-center gap-6/);
  assert.match(wizard, /flex w-\[640px\] max-w-full flex-col gap-4/);
});

test('6: «Prepara tu equipo»: optional ones in their own group and Continuar off only while something installs', () => {
  const installer = read('src/ui/components/installer.jsx');
  assert.match(installer, /t\('install\.optionals'\)[\s\S]*data-testid="install-optional"/);
  const setup = read('src/ui/views/setup.jsx');
  const prepare = setup.slice(setup.indexOf('export function Prepare'));
  assert.match(prepare, /const installing = running && !progress\?\.finished && !progress\?\.interrupted;/);
  assert.match(prepare, /onClick=\{onDone\} disabled=\{installing\} data-testid="setup-continue"/);
  assert.doesNotMatch(prepare, /setup-continue[^>]*disabled=\{!/);
});

test('7: the little window shows the project of the page\'s conversation (additive field; nothing of the phone changes)', () => {
  const host = read('src/engine/browser/host-browser.mjs');
  assert.match(host, /project: t \? project\(sessionOf\(t\)\) \|\| null : null/);
  const engine = read('src/engine/engine.mjs');
  assert.match(engine, /project: \(session\) => \{ try \{ return sessionsOpen\?\.get\(session\)\?\.project \|\| null;/);
  const pip = read('src/ui/pip.jsx');
  assert.match(pip, /state\.project \? <Badge[^>]*data-testid="pip-project">\{state\.project\}<\/Badge>/);
  // the state still travels only to the window (host.pip.state), never to the phone
  assert.match(host, /call\('host\.pip\.state', \{ state: state\(\) \}\)/);
});
