// 3.8.8 paso 11b (G4), terminal con pestañas del God mode e historial dentro del panel Git (se lee el código como texto).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const view = read('src/ui/views/expert.jsx');
const panel = read('src/ui/components/terminal-panel.jsx');
const chat = read('src/ui/views/chat.jsx');
const tools = read('src/ui/components/project-tools.jsx');
const out = read('src/ui/components/task-output.jsx');
const git = read('src/ui/components/expert-git.jsx');

test('el God mode usa el mismo componente y las mismas llamadas del terminal, sin Rust nuevo', () => {
  assert.match(view, /<TerminalPanel key=\{project\} dock dir=\{info\.path\}/);
  for (const m of ['open', 'write', 'close', 'list']) assert.ok(panel.includes(`call('terminal.${m}'`), m);
  assert.doesNotMatch(view + out, /call\('terminal\.|bridge\.(pty|terminal)|invoke\(/);
  assert.doesNotMatch(panel, /invoke\(|bridge\.(pty|spawn)/);
});

test('pestañas con tope de 4, nueva, cerrar la activa y ocultar sin perder procesos', () => {
  assert.match(panel, /const MAX_TABS = 4/);
  assert.match(panel, /disabled=\{terms\.length >= MAX_TABS\}/);
  for (const id of ['terminal-tabs', 'terminal-new', 'terminal-close', 'terminal-fold', 'terminal-tab-task', 'terminal-input']) assert.ok(panel.includes(id), id);
  assert.match(view, /data-testid="terminal-strip"/); assert.match(view, /data-testid="terminal-open"/);
  assert.match(panel, /role="tablist"/);
});

test('los procesos se cierran con el panel: al salir, cambiar de proyecto o cerrar la pestaña', () => {
  assert.ok(panel.includes("for (const id of opened.current) { claimed.delete(id); call('terminal.close', { id })"));
  assert.match(panel, /if \(gone\.current\) \{ call\('terminal\.close'/);
  assert.match(panel, /await act\(call\('terminal\.close', \{ id \}\)\);\s*opened\.current\.delete\(id\)/);
  assert.match(panel, /master:locked/);
});

test('nada se ejecuta solo: una acción deja el comando en la línea y espera a Intro', () => {
  assert.ok(panel.includes('setLine(launch.command, r.id)'));
  assert.doesNotMatch(panel.slice(panel.indexOf('launch.n, ready')-600, panel.indexOf('launch.n, ready')+40), /terminal\.write/);
  assert.match(view, /oneCommand\(a\.command\)/);
  assert.match(view, /onRun=\{info\?\.path \? runInTerminal : undefined\}/);
  assert.match(tools, /onRun \? onRun\(a\) : runProjectAction\(project, a\)/);
  assert.match(tools, /data-testid=\{`action-window-/); // la ventana aparte sigue, en el botón de la línea
});

test('la salida de la tarea es de solo lectura y sale de los eventos del motor', () => {
  assert.match(out, /call\('sessions\.items'/);
  assert.doesNotMatch(out, /call\('terminal\.|<input|<textarea|call\('tasks\.(create|followup)/);
  assert.match(panel, /active === READONLY && readonly/);
  assert.match(panel, /data-testid="terminal-task-output"/);
});

test('el chat incrustado del God mode no abre su propio terminal y el pegado va al panel', () => {
  assert.match(chat, /fullPc\(\) && !onConversation \? onTerminalPaste/);
  assert.match(chat, /fullPc\(\) && !embedded \? <DropdownMenuItem onSelect=\{\(\) => setTerminal/);
  assert.match(chat, /terminal && fullPc\(\) && !embedded \? <TerminalPanel/);
  assert.match(view, /onTerminalPaste/); assert.ok(view.includes('bridge.mobile || !info?.path ? undefined : onTerminalPaste'));
  assert.match(view, /data-testid="expert-terminal"/); // «Abrir un terminal aquí» (ventana externa) se queda en el ⋯
});

test('el panel no se ofrece en el móvil (el motor solo atiende terminal.* a la ventana del PC)', () => {
  const perms = read('src/domain/security/permissions.mjs');
  assert.match(perms, /'terminal\.list': 'pc', 'terminal\.open': 'pc', 'terminal\.write': 'pc', 'terminal\.close': 'pc'/);
  assert.match(view, /if \(bridge\.mobile\) return/);
});

test('textos en es y en', () => {
  for (const k of ['terminal.tabs', 'terminal.task', 'terminal.taskId', 'terminal.taskNone', 'terminal.taskWaiting', 'terminal.open', 'tools.runInWindow', 'expert.git.seeAll']) assert.ok(es[k] && en[k], k);
});

test('el historial vive dentro del panel Git con sus 5 últimas filas y «Ver todo»', () => {
  assert.match(git, /const RECENT = 5/);
  assert.match(git, /call\('expert\.log', \{ project, limit: RECENT \}\)/);
  for (const id of ['expert-git-history', 'expert-git-history-all', 'expert-git-history-row']) assert.match(git, new RegExp(`data-testid="${id}"`));
  assert.match(view, /onHistory=\{\(\) => setHistoryAll\(true\)\}/);
  assert.match(view, /on\('history'\) \|\| historyAll \? <HistoryPanel/);
});

test('el panel Historial aparte solo se ve por defecto si el usuario lo encendió', () => {
  assert.match(view, /id === 'history' \? panels\.history === true : panels\[id\] !== false/);
  assert.match(read('src/ui/views/settings/general.jsx'), /panelOn\(panels, id\)/);
});

test('ExpertView: ninguna variable se usa antes de declararse (project en los arrays de dependencias)', () => {
  const body = view.slice(view.indexOf('export function ExpertView'));
  const decl = body.indexOf('const [project, setProject]');
  assert.ok(decl > 0);
  for (const m of body.matchAll(/\}, \[[^\]]*\bproject\b[^\]]*\]\)|\), \[[^\]]*\bproject\b[^\]]*\]\)/g)) assert.ok(m.index > decl, `dependencia de project antes de su declaración: ${m[0]}`);
  for (const name of ['info', 'running', 'tab', 'term', 'launch', 'historyAll']) {
    const d = Math.max(body.indexOf(`const [${name},`), body.indexOf(`const ${name} =`)); const u = Math.min(...[`, [${name}]`, `, [${name},`].map((x) => { const k = body.indexOf(x); return k < 0 ? Infinity : k; }));
    if (d >= 0 && u < Infinity) assert.ok(d < u, `${name} se usa en un array de dependencias antes de declararse`);
  }
});

test('los shells del dock que no se pudieron cerrar (Orb bloqueado) se cierran al desbloquear y se reenganchan', () => {
  assert.match(panel, /const dockOwned = new Set\(\)/);
  assert.match(panel, /bridge\.on\('master:unlocked', sweep\)/);
  assert.match(panel, /call\('terminal\.close', \{ id \}\)\.then\(\(\) => dockOwned\.delete\(id\)\)/); // solo se olvida si el cierre salió bien
  assert.match(panel, /if \(dockOwned\.has\(x\.id\)\) \{ opened\.current\.add\(x\.id\); claimed\.add\(x\.id\); \}/);
});

test('la acción se consume una vez, la línea es por pestaña, el comando se ve entero y la vista previa se explica', () => {
  assert.match(view, /onClose=\{\(\) => \{ setTerm\(false\); setLaunch\(null\); \}\}/);
  assert.match(panel, /const line = lines\[active\] \?\? ''/);
  assert.match(panel, /data-testid="terminal-action-command"/);
  assert.match(panel, /title=\{line\}/);
  assert.match(panel, /terminal\.previewWindow/);
  assert.ok(es['terminal.previewWindow'] && en['terminal.previewWindow']);
  assert.match(view, /onTerminalPaste\(\(line, from\)/); assert.match(view, /bridge\.mobile \|\| !info\?\.path \? undefined : onTerminalPaste/);
});
