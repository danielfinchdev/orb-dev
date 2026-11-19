// 3.8.8: Proyectos y Un proyecto como las maquetas 04-proyectos y 05-proyecto. Se lee el código fuente como texto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');
const list = read('views/projects-pc.jsx');
const page = read('views/project-page.jsx');
const legacy = read('views/projects.jsx');
const FILES = ['views/projects.jsx', 'views/projects-pc.jsx', 'views/project-page.jsx', 'components/project-actions.jsx', 'components/project-tools.jsx', 'components/project-finder.jsx', 'components/project-icon.jsx', 'components/project-flows.jsx', 'components/project-github.jsx'];

const between = (src, from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, `${from} … ${to}`); return src.slice(a, b); };

test('la cabecera de Proyectos solo lleva iconos y «Nuevo proyecto» va en el contenido', () => {
  const header = between(list, '<PageHeader', '</PageHeader>');
  assert.match(header, /<BarPause \/>/);
  assert.match(header, /<NotificationBell \/>/);
  assert.match(header, /<MoreButton/);
  assert.doesNotMatch(header, /<Button\b/, 'ningún botón de texto en la cabecera');
  assert.doesNotMatch(header, /projects\.(clone|link|create)/);
  assert.ok(list.indexOf('<NewProject') > list.indexOf('<PageBody'), 'el botón principal está en el contenido');
  assert.match(list, /t\('projects\.create'\)/);
  for (const flow of ['createProjectFlow', 'linkFolderFlow', 'cloneRepoFlow']) assert.match(between(list, 'function NewProject', 'function ProjectsList'), new RegExp(flow), `${flow} sigue en el menú`);
});

test('la línea bajo el título es la corta de la maqueta con contadores reales', () => {
  assert.match(list, /projects\.sub\.active/);
  assert.match(list, /projects\.sub\.finished/);
  assert.match(list, /projects\.sub\.in/);
  assert.doesNotMatch(list, /projects\.meta'/, 'ya no va la línea larga que se montaba sobre los botones');
});

test('los botones de las filas miden 24 px', () => {
  const row = between(list, 'function RowMenu', 'function FinishedSection');
  assert.match(row, /<MoreButton small/);
  assert.match(row, /<Button size="xs" onClick=\{\(\) => onOpen\(p\.name\)\} data-testid="project-open"/);
  assert.match(read('components/project-tools.jsx'), /size=\{page \? 'default' : 'xs'\}/, '«Abrir en…» compacto en la fila');
  assert.match(list, /<Button size="xs" variant="outline" onClick=\{\(\) => reopen\(x\)\}/);
});

test('los filtros son menús y pestañas de Orb, nunca un select del sistema', () => {
  for (const src of [list, page]) assert.doesNotMatch(src, /<select\b/);
  assert.match(list, /<Select value=\{order\}/);
  assert.match(list, /<Segmented value=\{catNow\}/);
  assert.match(list, /<SearchInput/);
});

test('las filas usan el punto de proyecto y no pintan colores a mano', () => {
  assert.match(list, /<ProjectIcon name=\{p\.name\} \/>/);
  for (const src of [list, page]) {
    assert.doesNotMatch(src, /text-primary(?![-\w])/, 'el acento es text-primary-text');
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, 'colores con tokens');
  }
});

test('la página del proyecto tiene las seis pestañas, «Nuevo chat aquí» y el menú ⋯ con todo lo de antes', () => {
  for (const tab of ['resumen', 'chats', 'tareas', 'git', 'bitacora', 'pizarra']) assert.match(page, new RegExp(`'${tab}'`));
  assert.match(page, /data-testid="project-new-chat"/);
  const menu = between(page, '<DropdownMenuContent align="end" className="w-72"', '</DropdownMenuContent>');
  // the mock-up's menu: chat, rename (F2), icon, then finish and delete (a linked folder is unlinked in that same slot)
  const order = ['project-chat', 'project-rename', 'project-icon-change', 'project-finish', 'project-delete', 'project-unlink'];
  for (const id of order) assert.match(menu, new RegExp(`data-testid="${id}"`), id);
  assert.ok(order.slice(0, 4).every((id, i, all) => !i || menu.indexOf(`"${all[i - 1]}"`) < menu.indexOf(`"${id}"`)), 'orden de la maqueta');
  assert.match(menu, /<Kbd className="ml-auto">F2<\/Kbd>/);
  // what the menu no longer carries lives where the function map puts it: nothing is lost
  for (const id of ['project-review', 'project-security']) { assert.doesNotMatch(menu, new RegExp(`"${id}"`), id); assert.ok(page.includes(`data-testid="${id}"`), `${id} sigue en la página`); }
  // «Trabajar aquí» and the other functions the mock-up does not draw live in the ⋯ menu; the reviews in the task button's menu
  for (const id of ['project-set-active', 'project-git-refresh', 'project-expert-open']) assert.match(menu, new RegExp(`data-testid="${id}"`), id);
  assert.doesNotMatch(page, /data-testid="project-work-card"/);
  assert.match(page, /e\.key === 'F2'/, 'F2 renombra');
  assert.match(page, /<ProjectOpenMenu project=\{p\} page \/>/);
  assert.match(page, /projects\.mergePr/);
  assert.match(page, /danger: true/, 'fusionar pide confirmación seria');
});

test('el móvil y el navegador enlazado conservan su maquetación', () => {
  assert.match(legacy, /return fullPc\(\) \? <ProjectsPc route=\{route\} \/> : <ProjectsLegacy route=\{route\} \/>;/);
  assert.ok(legacy.includes('data-testid={`projects-tab-${id}`}'));
  assert.match(legacy, /bridge\.mobile \? null : <PathText path=\{p\.path\}/);
});

// Lo que había en HEAD (3.8.8 antes de este paso) y no puede faltar en ninguno de los archivos de estas vistas.
const TESTIDS = ['action-add', 'action-command', 'action-name', 'action-preview', 'action-shortcut', 'actions-menu', 'finder-input', 'finder-row', 'gh-contributions', 'open-in', 'open-in-main', 'open-in-menu', 'project-category', 'project-delete', 'project-finder', 'project-finish', 'project-finished', 'project-menu', 'project-menu-list', 'project-none', 'project-picker', 'project-rename', 'project-reopen', 'project-review', 'project-row', 'project-security'];
test('siguen todos los data-testid que había', () => {
  const all = FILES.map(read).join('\n');
  for (const id of TESTIDS) assert.ok(all.includes(`"${id}"`), id);
  for (const prefix of ['action-${a.id}', 'category-${', 'platform-${c}', 'projects-tab-${id}']) assert.ok(all.includes(prefix), prefix);
});

test('los textos de la interfaz existen en español e inglés', async () => {
  const es = (await import('../src/shared/locales/es/projects.mjs')).default ?? Object.values(await import('../src/shared/locales/es/projects.mjs'))[0];
  const en = (await import('../src/shared/locales/en/projects.mjs')).default ?? Object.values(await import('../src/shared/locales/en/projects.mjs'))[0];
  const used = new Set();
  for (const src of [list, page, read('lib/project-status.js')]) for (const m of src.matchAll(/(?:t\(|plural\(t, )'(projects\.[\w.]+)'/g)) used.add(m[1]);
  for (const base of ['projects.m.changes', 'projects.m.ahead', 'projects.m.pr', 'projects.m.run', 'projects.m.fail', 'projects.badge.changes', 'projects.unpushed', 'projects.prs.open', 'projects.chats', 'projects.tasks']) { used.add(`${base}One`); used.add(`${base}Other`); }
  for (const o of ['activity', 'name', 'category']) used.add(`projects.order.${o}`);
  for (const w of ['create', 'link', 'clone']) { used.add(`projects.new.${w}`); used.add(`projects.new.${w}Hint`); }
  // a key used with plural() is a base: its One and Other forms are what must exist.
  for (const k of used) { if (`${k}One` in es) continue; assert.ok(k in es, `es ${k}`); assert.ok(k in en, `en ${k}`); }
});

test('el estado de cada fila sale de lo que la ventana ya tiene', async () => {
  const { taskCounts, since, lastLogEntry, gitFacts, lastActivityAt } = await import('../src/ui/lib/project-status.js');
  const now = Date.parse('2026-11-18T12:00:00Z');
  const tasks = [
    { project: 'a', status: 'running', updated_at: '2026-11-18T11:59:00Z' }, { project: 'a', status: 'queued', updated_at: '2026-11-18T11:00:00Z' },
    { project: 'a', status: 'awaiting_approval', updated_at: '2026-11-18T10:00:00Z' },
    { project: 'a', status: 'failed', updated_at: '2026-11-17T10:00:00Z' }, { project: 'a', status: 'failed', updated_at: '2026-10-01T10:00:00Z' },
    { project: 'b', status: 'running', updated_at: '2026-11-18T11:00:00Z' }
  ];
  const c = taskCounts('a', tasks, now);
  assert.equal(c.running, 2); assert.equal(c.approve, 1); assert.equal(c.failed, 1, 'un fallo viejo ya no cuenta');
  assert.equal(lastActivityAt('a', { tasks, sessions: [{ project: 'a', updated_at: '2026-11-18T11:59:30Z' }] }), '2026-11-18T11:59:30Z');
  const t = (k, p = {}) => `${k}:${p.n ?? ''}`;
  assert.equal(since('2026-11-18T11:57:00Z', t, now), 'projects.ago.min:3');
  assert.equal(since('2026-11-17T09:00:00Z', t, now), 'projects.ago.yesterday:');
  assert.equal(since('2026-11-14T12:00:00Z', t, now), 'projects.ago.days:4');
  const e = lastLogEntry('# Bitácora\n\n### 2026-11-17 09:00 — Codex — Antes\n- viejo\n\n### 2026-11-18 10:12 — Claude (Claude Code, Opus) — El checkout valida\n- **Pedido**: algo\n- Hecho: mucho\n');
  assert.deepEqual([e.date, e.time, e.who, e.topic], ['2026-11-18', '10:12', 'Claude (Claude Code, Opus)', 'El checkout valida']);
  assert.equal(e.body, 'Pedido: algo\nHecho: mucho');
  assert.equal(lastLogEntry('mi-web: todavía no tiene entradas'), null);
  assert.deepEqual(gitFacts({ git: false }).map((f) => f.key), ['nogit']);
  assert.deepEqual(gitFacts({ git: true, branch: 'main', changes: 2, ahead: 0, remote: 'https://github.com/a/b', prs: [{}] }).map((f) => f.key), ['branch', 'changes', 'prs']);
  assert.deepEqual(gitFacts({ git: true, branch: 'main', changes: 0, ahead: 0, remote: null }).map((f) => f.key), ['branch', 'uptodate']);
});

test('fusionar pide una confirmación de peligro con repositorio, PR y rama, y sin atajo', async () => {
  const merge = between(page, 'const merge = async', 'const send = async');
  assert.match(merge, /confirm\(t\('projects\.prs\.mergeTitle'\), t\('projects\.prs\.mergeBody', \{ repo: nowRepo, n: now\.number, title: now\.title, base: now\.baseRefName \}\)/);
  assert.match(merge, /danger: true/);
  assert.ok(merge.indexOf('confirm(') < merge.indexOf("'projects.mergePr'"), 'primero se confirma');
  assert.match(merge, /if \(busy \|\| !repo\) return/);
  for (const lang of ['es', 'en']) {
    const loc = Object.values(await import(`../src/shared/locales/${lang}/projects.mjs`))[0];
    for (const k of ['{repo}', '{n}', '{title}', '{base}']) assert.ok(loc['projects.prs.mergeBody'].includes(k), `${lang} ${k}`);
  }
  assert.equal(readFileSync(new URL('../src/shared/keybindings.mjs', import.meta.url), 'utf8').includes('mergePr'), false);
  assert.doesNotMatch(page, /useShortcut\([^)]*(merge|Merge)/);
});

test('comentar enseña el texto exacto y dónde se publica antes de enviarlo', async () => {
  const send = between(page, 'const send = async', 'const checkIcon');
  assert.match(send, /const body = comment\.trim\(\)/);
  assert.match(send, /!body \|\| !repo\) return/);
  assert.match(send, /confirm\(t\('projects\.prs\.commentTitle'\), t\('projects\.prs\.commentBody', \{ repo, n: pr\.number, text: body \}\)/);
  assert.match(send, /'projects\.prComment', \{ name: p\.name, number: pr\.number, body \}/, 'se envía lo mismo que se enseña');
  assert.doesNotMatch(send, /danger/);
  assert.ok(send.indexOf('confirm(') < send.indexOf("'projects.prComment'"));
  for (const lang of ['es', 'en']) {
    const loc = Object.values(await import(`../src/shared/locales/${lang}/projects.mjs`))[0];
    for (const k of ['{repo}', '{n}', '{text}']) assert.ok(loc['projects.prs.commentBody'].includes(k), `${lang} ${k}`);
  }
  const { repoOf } = await import('../src/ui/lib/project-status.js');
  assert.equal(repoOf('git@github.com:acme/web.git'), 'acme/web');
  assert.equal(repoOf('https://github.com/acme/web'), 'acme/web');
  assert.equal(repoOf('https://gitlab.com/acme/web'), null);
});

test('ningún fusionar ni comentar se dispara solo', () => {
  const all = ['views/projects-pc.jsx', 'views/project-page.jsx', 'components/project-flows.jsx', 'components/project-github.jsx', 'lib/use-project-info.js', 'lib/project-status.js'].map((f) => [f, read(f)]);
  for (const [f, src] of all) {
    for (const m of src.matchAll(/useEffect\(/g)) {
      // the whole body of the effect: from its open parenthesis to the one that closes it
      let depth = 0; let end = m.index + 'useEffect'.length;
      for (; end < src.length; end += 1) { if (src[end] === '(') depth += 1; else if (src[end] === ')' && --depth === 0) break; }
      assert.doesNotMatch(src.slice(m.index, end), /mergePr|prComment/, `${f} lanza una acción de GitHub en un efecto`);
    }
  }
  // each call sits in a handler that starts with a click
  assert.equal([...page.matchAll(/projects\.(mergePr|prComment)/g)].length, 2);
  assert.match(page, /onClick=\{merge\}/); assert.match(page, /onClick=\{send\}/);
});

test('el repositorio de los diálogos sale de la URL de la PR', async () => {
  const { repoOfPr } = await import('../src/ui/lib/project-status.js');
  assert.equal(repoOfPr('https://github.com/acme/web/pull/12'), 'acme/web');
  assert.equal(repoOfPr('https://github.com/acme/web/pull/12/'), 'acme/web');
  assert.equal(repoOfPr('https://ghe.empresa.com/acme/web/pull/12'), 'acme/web');
  for (const bad of ['', null, undefined, 'https://github.com/acme/web', 'git@github.com:acme/web.git', 'not a url']) assert.equal(repoOfPr(bad), null, String(bad));
  assert.doesNotMatch(page, /repoOf\(remote\)|\?\? p\.name/, 'nunca el remoto de la carpeta ni el nombre del proyecto');
  assert.match(page, /repoOfPr\(pr\.url\)/);
  const merge = between(page, 'const merge = async', 'const send = async');
  assert.ok(merge.indexOf("'projects.pr'") < merge.indexOf('confirm('), 'se vuelve a leer la PR antes de preguntar');
  assert.match(merge, /number: now\.number, method: 'merge', headRefOid: now\.headRefOid/);
  assert.match(page, /disabled=\{busy \|\| !repo \|\| pr\.state !== 'OPEN' \|\| pr\.isDraft/);
  for (const lang of ['es', 'en']) assert.ok(Object.values(await import(`../src/shared/locales/${lang}/projects.mjs`))[0]['projects.prs.noRepo'], lang);
});

test('la lista pide el estado de git sin red, en cola, solo lo visible y con tiempo máximo', () => {
  const hook = read('lib/use-project-info.js');
  assert.match(hook, /call\('projects\.info', \{ name: job\.name, local: true \}\)/);
  assert.match(hook, /rowBusy/, 'de una en una');
  assert.match(hook, /IntersectionObserver/);
  assert.match(hook, /ROW_TTL = 10 \* 60_000/);
  assert.match(hook, /ROW_TIMEOUT = 8000/);
  assert.match(hook, /ROW_ENGINE_GRACE = 30_000/, 'la siguiente lectura espera al motor o a 30 s');
  assert.match(hook, /rowRunning\?\.name === name/, 'una fila que vuelve se une a la lectura en curso');
  assert.match(hook, /unavailable: true/);
  assert.match(hook, /job\.waiters\.delete/, 'se cancela al salir');
  assert.match(list, /useRowInfo\(p\.name, p\.path, stamp\)/);
  assert.match(list, /forgetRowInfos\(\)/);
  assert.doesNotMatch(list, /useProjectInfos|readInfo/);
  assert.match(page, /useProjectInfo\(p\.name\)/, 'la página sigue pidiendo la información completa');
});

test('correcciones 7C-a: margen, enlaces, icono grande, tareas de una línea y Git y PR', () => {
  assert.ok(list.includes('<PageBody className="md:pb-28">'), 'las tarjetas van a 24 px de la columna (el margen de PageBody)');
  assert.ok(page.includes('pt-5 pr-[calc(1.5rem-var(--sb-w))] pb-10 pl-6'));
  for (const src of [list, page]) assert.doesNotMatch(src, /variant="link"(?![^>]*text-info)/, 'los enlaces van en el azul de la maqueta (--info)');
  assert.ok(page.includes('<ProjectIcon name={p.name} size={48} big />'));
  assert.ok(read('components/project-icon.jsx').includes('big ? 48'));
  assert.ok(page.includes('<TaskRow key={x.id} x={x} compact />'), 'la tarjeta del Resumen lleva filas de una línea');
  assert.ok(page.includes('meta={compact ? null'));
  assert.ok(page.includes('nums={f.add != null'), 'cada archivo con sus +/−');
  // GitHub's account card is not in the list of the mock-up: it lives in the Git y PR tab
  assert.doesNotMatch(list, /GithubCard|ContributionGraph/);
  assert.ok(page.includes('<GithubCard />'));
  assert.ok(page.includes("'projects.prs.thread'"));
  assert.ok(list.includes("plural(t, 'projects.tasks'"), 'Terminados dice cuántas tareas tuvo');
});

test('los +/− de cada archivo salen de un solo numstat y los comentarios de la PR vienen en la misma lectura', () => {
  const gh = readFileSync(new URL('../src/engine/host/github.mjs', import.meta.url), 'utf8');
  assert.ok(gh.includes("'diff', 'HEAD', '--numstat', '-z'"));
  assert.ok(gh.includes('thread: (Array.isArray(x.comments)'));
});

test('«Encargar una tarea» abre el diálogo con el proyecto y las filas de tareas se abren con un clic', () => {
  assert.match(page, /askNewTask\(t, \[p\.name\], p\.name\)/);
  assert.ok(!page.includes("onClick={() => go({ view: 'tasks', project: p.name })}><Plus"));
  assert.match(page, /data-testid="project-task-row"[^\n]*go\(\{ view: 'tasks', id: x\.id \}\)/);
});

test('los interruptores de los frenos pasan el desbloqueo del diálogo a changeRail', () => {
  const usage = read('views/usage.jsx');
  const tab = read('views/settings/usage-tab.jsx');
  assert.match(usage, /changeRail\('freno-uso', \{ enabled \}, t\('rules\.railSaved'\), ok\.unlock\)/);
  assert.match(tab, /changeRail\(rail\.id, \{ enabled \}, t\('rules\.railSaved'\), ok\.unlock\)/);
});
