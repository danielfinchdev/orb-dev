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
