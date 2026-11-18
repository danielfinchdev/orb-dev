// Orb UI 2.0, step 6A: the chat with Orbe as the mockup 02-chat-orbe, and the robot's cost in a window nobody looks at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pickGreeting, suggestionsFor } from '../src/ui/lib/greeting.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const chat = read('src/ui/views/chat.jsx');

test('applyAppearance writes an attribute of <html> only when its value changes', () => {
  const store = read('src/ui/lib/store.js');
  const fn = store.slice(store.indexOf('export function applyAppearance'), store.indexOf('// density, width of the chat column'));
  assert.match(fn, /const put = \(key, value\) =>[^\n]*root\[key\] !== value/, 'an unchanged value is not written');
  // a refresh runs every second while an agent works: no direct assignment may remain, each one would be a DOM mutation
  assert.doesNotMatch(fn, /root\.(skin|font|codeFont|codeTheme|motion|palette) = /);
  assert.doesNotMatch(fn, /delete root\./);
});

test('the robot does not float or glow for a window without focus', () => {
  const orb = read('src/ui/components/orb.jsx');
  assert.match(orb, /function float\(\) \{\n    if \(!document\.hasFocus\(\)\) return;/);
  assert.match(orb, /setHover\(document\.hasFocus\(\)\)/);
});

test('only the Orb theme draws the robot in the chat with Orbe; the other themes get a dot', () => {
  assert.match(chat, /robotSkin\(useStore\(\(s\) => s\.app\?\.config\?\.ui\?\.skin\)\)\) return <Robot size=\{size\} head still/);
  assert.match(chat, /robotSkin\(app\.config\.ui\?\.skin\) \? <Robot size=\{130\} mood="hello" live \/>/);
  assert.doesNotMatch(chat, /<Robot[^>]*\bmark\b/, 'the app icon no longer stands in for the robot here');
  assert.match(chat, /<span className="text-info shrink-0 leading-none"[^>]*>●<\/span>/);
});

test('the header says «project · mark Orbe · model» and has the panel button', () => {
  assert.match(chat, /data-testid="orb-chat-brain"/);
  assert.match(chat, /modelLabel\(catalog, brain\.agent, brain\.model\)/);
  assert.match(chat, /data-testid="orb-chat-panel"/);
  assert.match(chat, /<PanelRight \/>/);
});

test('the empty chat has the status line, four suggestions with icons and the hint', () => {
  assert.match(chat, /data-testid="empty-chat"/);
  assert.match(chat, /function HeroStatus\(\)/);
  assert.equal(suggestionsFor(null).length, 4);
  for (const key of suggestionsFor(null)) assert.ok(/chat\.suggestion5|chat\.suggestion[124]/.test(key));
  for (const lang of ['es', 'en']) {
    const text = read(`src/shared/locales/${lang}/chat.mjs`);
    for (const key of ['chat.suggestion5', 'chat.suggestions', 'chat.statusRunning.one', 'chat.statusRunning.many', 'chat.statusWaiting.one', 'chat.statusWaiting.many', 'chat.heroHint']) assert.ok(text.includes(`'${key}'`), `${lang}: ${key}`);
  }
  assert.ok(pickGreeting({ random: () => 0.5 }).key);
});

test('the composer lists permissions and orchestrator first, then the context and the brain, and Compactar shows the percentage', () => {
  const at = (s) => chat.indexOf(s);
  assert.ok(at('data-testid="composer-group-access"') < at('<ContextMeter context={context} />'));
  assert.ok(at('<ContextMeter context={context} />') < at('data-testid="composer-group-brain"'));
  assert.match(chat, /<CompactButton onCompact=\{compact\} busy=\{compacting\} percent=/);
  assert.match(read('src/ui/components/conversation/bar.jsx'), /\$\{percent\} %/);
});

test('every data-testid the chat had is still there', () => {
  const all = [chat, read('src/ui/components/conversation/composer.jsx'), read('src/ui/components/task-state.jsx')].join('\n');
  for (const id of ['bar-games', 'bar-title-text', 'board-suggestion', 'chat-autonomy', 'chat-greeting', 'chat-input', 'chat-lines', 'chat-older', 'chat-paused', 'chat-play', 'chat-resume', 'chat-task-approval', 'chat-task-approve', 'chat-task-open', 'chat-task-reject', 'chat-test', 'chat-waiting-turn', 'composer-group-access', 'composer-group-brain', 'more-info', 'open-board', 'orb-chat-bar', 'orb-chat-head', 'orb-chat-more', 'orb-chat-status', 'orchestrator', 'orchestrator-check', 'report-actions', 'task-line', 'task-line-cancel', 'task-lines']) {
    assert.ok(all.includes(`"${id}"`) || all.includes(`testid="${id}"`) || all.includes(`'${id}'`), id);
  }
});

test('paso 7C1: la caja del chat con Orbe en el PC lleva un solo chip de agente, modelo y razonamiento, y la fila «Proyecto» / «Compactar · %»', () => {
  const brain = read('src/ui/components/brain-picker.jsx');
  assert.match(brain, /export function BrainChip/);
  const chip = brain.slice(brain.indexOf('export function BrainChip'), brain.indexOf('// four small bars'));
  for (const id of ['brain-picker', 'reasoning-picker', 'reasoning-level', 'reasoning-menu']) assert.ok(chip.includes(`data-testid="${id}"`), id);
  assert.match(chip, /<ReasoningTail /);
  assert.match(chat, /fullPc\(\) \? <BrainChip catalog=\{catalog\} value=\{brain\}/);
  // the phone keeps the two buttons
  assert.match(chat, /<BrainPicker catalog=\{catalog\} value=\{brain\} onChange=\{pickBrain\}/);
  // the row over the box: «Sin proyecto ⌄» on the left, «Compactar · 62 %» always on the right (disabled with its reason)
  assert.match(chat, /fullPc\(\) \? <ProjectChip conversation=\{id\} \/>/);
  assert.match(chat, /<CompactButton onCompact=\{compact\} busy=\{compacting\} percent=\{percent\} reason=\{compactable \? null :/);
  assert.match(read('src/ui/components/conversation/project-chip.jsx'), /data-testid="project-picker"/);
  // copy and the time close each turn once; no «+» because chat.send takes no attachments
  assert.match(chat, /orbTurnTails\(lines,/);
  assert.match(chat, /<TurnActions at=\{turnEnds\.get\(lastLine\)\.at\}/);
  assert.doesNotMatch(chat, /AttachMenu/);
});

test('paso 7C1: el chat con Orbe muestra el terminal, las páginas HTML y los secretos de las tareas con los componentes del chat con un agente', () => {
  assert.match(chat, /<TerminalPanel dir=\{terminalDir\} draft=\{termDraft\}/);
  assert.match(chat, /onTerminalPaste\(\(line, from\) => \{[^\n]*setTerminal\(true\); setTermDraft\(line\); \}\)/);
  assert.match(chat, /data-testid="session-terminal"/);
  assert.match(chat, /<SecretCards key=\{sid\} sessionId=\{sid\} \/>/); assert.match(chat, /<HtmlPages sessionIds=\{list\}/);
  assert.match(chat, /sideSessionIds\(s\.tasks, conversation\)/);
});

test('step 7F: the pages of the tasks of a chat are ONE list (the internet rule sees them all), without answer buttons, and a paste reaches only its pane', async () => {
  const chat = fs.readFileSync(new URL('../src/ui/views/chat.jsx', import.meta.url), 'utf8');
  const side = chat.slice(chat.indexOf('function TaskSideCards'), chat.indexOf('function TaskLines'));
  assert.match(side, /<HtmlPages sessionIds=\{list\} choices=\{false\} \/>/);
  assert.doesNotMatch(side, /<HtmlPages sessionId=/);
  const { sideSessionIds } = await import('../src/ui/lib/html-mount.js');
  const tasks = [{ id: 1, conversation_id: 'c', session_id: 'aaa' }, { id: 3, conversation_id: 'c', session_id: 'bbb' }, { id: 2, conversation_id: 'c', session_id: 'aaa' }, { id: 9, conversation_id: 'x', session_id: 'zzz' }, { id: 10, conversation_id: 'c', session_id: null }];
  assert.deepEqual(sideSessionIds(tasks, 'c'), ['bbb', 'aaa']);
  assert.match(chat, /data-paste-chat=\{String\(id \?\? 'new'\)\}/);
  assert.match(chat, /onTerminalPaste\(\(line, from\) =>/);
});

test('step 7C-b: the row with the project and «Compactar» is outside the box, over it, as under an agent\'s chat; both use the same Composer', () => {
  const composer = chat.slice(chat.indexOf('<Composer draft={box}'));
  assert.match(composer, /\n\s+above=\{<>/);
  assert.doesNotMatch(composer.slice(0, composer.indexOf('bottom={')), /\n\s+top=\{/);
  assert.match(composer, /<CompactButton onCompact=\{compact\}/);
  const session = read('src/ui/views/session.jsx');
  assert.match(session, /<Composer draft=\{draft\}/);
  assert.match(session, /\n\s+above=\{/);
  assert.match(chat, /import \{ useAutoScroll, Composer \} from '@\/components\/conversation\/composer\.jsx'/);
});

test('step 7C-b: the notices sit over the text box and left of an open side panel, from what is on screen', () => {
  const main = read('src/ui/main.jsx');
  assert.match(main, /function useToastInsets\(\)/);
  assert.match(main, /querySelectorAll\('\.composer-dock'\)/);
  assert.match(main, /\[data-testid="chat-panel"\]\[data-state="open"\]/);
  assert.match(main, /offset=\{phone \? 72 : insets\}/);
  assert.match(main, /visibleToasts=\{1\}/);
  assert.doesNotMatch(main, /bottom: 112, right: 24/);
});

test('step 7C-b: scroll bars are invisible at rest and show while the pointer is over the scrolling area', () => {
  const css = read('src/ui/app.css');
  assert.match(css, /::-webkit-scrollbar-thumb \{ background: transparent;/);
  assert.match(css, /:hover::-webkit-scrollbar-thumb \{ background: color-mix/);
  assert.match(read('src/ui/components/page.jsx'), /overflow-y-auto \[scrollbar-gutter:stable\] py-5 pr-\[calc\(1\.5rem-var\(--sb-w\)\)\] pl-6/, 'the page margin is the mock-up\'s 24 px, and the scrollbar takes its room from it');
});
