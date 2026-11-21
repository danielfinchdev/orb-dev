// The message box and the conversation as the approved mock-up 01-chat draws them (Orb UI 2.0): «Usar mi móvil» inside
// «Más opciones» of the permissions, the reasoning bars, a «Cambió N archivos» card per turn, the folded «Trabajó…» line,
// and a chat that never scrolls sideways. The files are read as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { placeTurns, groupWorked, formatSpan, createTurnsStore, createDiffQueue } from '../src/ui/lib/turn-cards.js';

const root = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const ui = (...p) => read('src', 'ui', ...p);
const session = ui('views', 'session.jsx');
const autonomy = ui('components', 'autonomy-switch.jsx');
const brain = ui('components', 'brain-picker.jsx');
const card = ui('components', 'conversation', 'turn-card.jsx');
const data = ui('lib', 'turn-data.js');
const edit = ui('components', 'edit-message.jsx');

test('there is no loose «Móvil» button: the phone is a switch inside «Más opciones» of the permissions', () => {
  assert.doesNotMatch(session, /aria-pressed=\{Boolean\(s\.android\)\}/);
  assert.match(session, /extra=\{androidRow\}/);
  assert.match(session, /testid: 'session-android'/);
  assert.match(autonomy, /t\('session\.moreOptions'\)/);
  assert.match(autonomy, /role="switch"|<Switch /);
  assert.match(autonomy, /aria-expanded=\{expanded\}/);
});

test('the phone keeps its calls and the master password', () => {
  assert.match(session, /call\('sessions\.revokeGrant', \{ id: s\.id, grant: 'android' \}\)/);
  assert.match(session, /unlockCore\('android'\)/);
  assert.match(session, /call\('sessions\.grantAndroid', \{ id: s\.id, unlock \}\)/);
  assert.match(session, /bridge\.mobile \|\| \(!s\.project && s\.permission === 'total'\) \? \[\]/);
});

test('the permission levels and their calls are the same as before', () => {
  assert.match(session, /unlockCore\('fullAccess'\)/);
  assert.match(session, /call\('sessions\.grantTotal', \{ id: s\.id, unlock \}\)/);
  assert.match(session, /call\('sessions\.update', \{ id: s\.id, permission \}\)/);
  assert.match(session, /grant: 'total'/);
  for (const level of ['auto', 'editar', 'leer', 'probar', 'preguntar', 'total']) assert.ok(autonomy.includes(`  ${level}: { Icon:`), level);
});

test('the reasoning has its four bars with the accent and a bubble with what it suits and what it spends', () => {
  assert.match(brain, /REASONING_LEVELS = \['low', 'medium', 'high', 'xhigh'\]/);
  assert.match(brain, /\[0, 1, 2, 3\]\.map/);
  assert.match(brain, /bg-primary-text/);
  assert.match(brain, /reasoning\.tasks\.\$\{level\}/);
  assert.match(brain, /reasoning\.use\.\$\{level\}/);
  assert.match(brain, /<UsageMeter level=\{current\} \/>/);
});

test('each finished turn ends with a «Cambió N archivos» card with «Revisar» and «Volver atrás…»', () => {
  assert.match(card, /data-testid="turn-card"/);
  assert.match(data, /call\('sessions\.turnDiff', \{ id: p\.id, scope: 'turn', n: p\.n(, stat: true)? \}\)/);
  assert.match(data, /call\('sessions\.turns', \{ id \}\)/);
  assert.match(card, /t\('turn\.review'\)/);
  assert.match(card, /openChanges\(sessionId, turn\.n\)/);
  assert.match(card, /t\('turn\.rewind'\)/);
  assert.match(card, /rewindFrom\(sessionId, user\)/);
  assert.match(edit, /call\(v\.rewind && info\.canRewind && fullPc\(\) \? 'sessions\.editRewind' : 'sessions\.edit'/);
  assert.match(session, /<TurnFlow /);
  assert.match(session, /onOpenChanges\(/);
});

test('the tool calls fold under a «Trabajó…» line', () => {
  assert.match(card, /<Collapsible open=\{open\}/);
  assert.match(card, /t\('worked\.line', \{ time: span \}\)/);
  assert.match(card, /data-testid="worked-toggle"/);
});

test('the chat never scrolls sideways', () => {
  assert.ok(session.includes('className="chat-fade min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"'));
  assert.match(ui('app.css'), /\.lazy-lines pre \{[^}]*overflow-x: auto/);
});

test('the box takes the big radius, the soft border and the shadow of the design; the bubble too', () => {
  const composer = ui('components', 'conversation', 'composer.jsx');
  assert.match(composer, /rounded-big border border-\[color-mix\(in_oklab,var\(--foreground\)_10%,transparent\)\] shadow-\[var\(--shadow\)\]/);
  assert.match(ui('components', 'conversation', 'message-box.jsx'), /bg-bubble text-bubble-foreground ml-auto max-w-\[80%\] rounded-big/);
  assert.match(ui('themes', 'skins.css'), /data-skin="candy"\] \[data-slot="composer"\] \[data-testid="send"\]/);
});

test('the English and Spanish texts of the new pieces exist', () => {
  for (const lang of ['es', 'en']) {
    const text = read('src', 'shared', 'locales', lang, 'rebobinar.mjs');
    for (const key of ['session.moreOptions', 'session.attachFile', 'session.captureWindow', 'turn.changedOne', 'turn.changedMany', 'turn.review', 'turn.rewind', 'worked.line']) assert.ok(text.includes(`'${key}'`), `${lang} ${key}`);
  }
});

// every test id the files had before this step (the e2e and the phone's checks look for them)
const TESTIDS = {
  'components/conversation/composer.jsx': ['composer-bottom', 'composer-top', 'dictate', 'mention-list', 'pasted-card', 'pasted-cards', 'pasted-remove', 'pasted-text', 'send'],
  'components/conversation/message-box.jsx': ['msg-name', 'msg-pin'],
  'components/conversation/trail.jsx': ['chat-trail'],
  'components/conversation/context-meter.jsx': ['context-meter', 'usage-page', 'usage-panel', 'usage-reload'],
  'components/conversation/chat-notes.jsx': ['chat-notes', 'chat-notes-input', 'chat-pinned', 'pinned-go', 'pinned-unpin'],
  'components/brain-picker.jsx': ['brain-favorite', 'brain-favorite-toggle', 'brain-picker', 'model-guide-open', 'reasoning-level', 'reasoning-menu', 'reasoning-meter', 'reasoning-picker', 'session-model', 'usage-bubble'],
  'views/orb/info.jsx': ['session-folder'],
  'components/chat-modes.jsx': ['chat-modes', 'debug-badge', 'goal-capsule'],
  'components/workspace-pills.jsx': ['workspace-base', 'workspace-local', 'workspace-pills', 'workspace-worktree'],
  'components/context-slot.jsx': ['context-slot'],
  'components/conversation/attach-menu.jsx': ['attach', 'capture-window'],
  'components/rich-blocks.jsx': ['mermaid'],
  'views/session.jsx': ['approval-card', 'approve-allow', 'approve-deny', 'archive', 'attach-open', 'bar-games', 'delete', 'details', 'fork', 'handoff', 'handoff-line', 'handoff-pick', 'open-folder', 'opti-old', 'partial', 'pending-comments', 'queue', 'session-fullpc', 'session-more', 'session-terminal', 'subagent', 'switch-agent', 'switch-agent-pick', 'tool-group', 'turn-changes-toggle']
};
test('every test id these files had is still there', () => {
  for (const [file, ids] of Object.entries(TESTIDS)) {
    const text = ui(...file.split('/'));
    for (const id of ids) assert.ok(text.includes(`data-testid="${id}"`) || text.includes(`'${id}'`), `${file}: ${id}`);
  }
  // the ones built from a prop or a template
  assert.match(autonomy, /data-testid=\{testid\} data-mode=\{value\}/);
  assert.match(autonomy, /data-testid=\{`\$\{testid\}-more`\}/);
  assert.match(autonomy, /data-testid=\{`\$\{testid\}-\$\{o\.value\}`\}/);
  assert.match(session, /testid="session-permission"/);
  assert.match(session, /testid: 'session-android'/);
});

test('turn cards go after the last line of their turn and «Volver atrás…» goes back to its message', () => {
  const item = (id, role, at, kind = 'text') => ({ type: 'item', key: id, item: { id, role, kind, at, body: 'x' } });
  const blocks = [item(1, 'user', 1000), { type: 'toolgroup', key: 'g1', steps: [] }, item(2, 'assistant', 5000), item(3, 'user', 9000), item(4, 'assistant', 12000)];
  const placed = placeTurns(blocks, [{ n: 1, at: 5100 }, { n: 2, at: 12100 }]);
  assert.deepEqual([...placed].map(([k, v]) => [k, v.n, v.user.id]), [[2, 1, 1], [4, 2, 3]]);
  assert.equal(placeTurns(blocks, []).size, 0);
});

test('runs of tool calls fold into one entry with the time they took', () => {
  const item = (id, role, at, kind = 'text') => ({ type: 'item', key: id, item: { id, role, kind, at, body: 'x' } });
  const out = groupWorked([item(1, 'user', 1000), { type: 'tool', key: 't1', call: {} }, { type: 'toolgroup', key: 'g1', steps: [] }, item(2, 'assistant', 261000)]);
  assert.equal(out.length, 3);
  assert.equal(out[1].worked, true);
  assert.equal(out[1].blocks.length, 2);
  assert.equal(out[1].ms, 260000);
  assert.equal(formatSpan(260000), '4 min 20 s');
  assert.equal(formatSpan(35000), '35 s');
  assert.equal(formatSpan(3900000), '1 h 5 min');
  assert.equal(groupWorked([item(1, 'user', 1), item(2, 'assistant', 2)]).some((e) => e.worked), false);
});

test('«Volver atrás…» never ends in a plain edit: no dialog without a photo, and its only call is editRewind', () => {
  // the dialog does not open when the files cannot be put back
  assert.match(edit, /if \(rewind && !info\.canRewind\) \{ notifyError\(new Error\(t\('edit\.rewindOff', \{ why: info\.rewindWhy[^\n]*return; \}/);
  assert.ok(edit.indexOf('if (rewind && !info.canRewind)') < edit.indexOf('await form('));
  // its own title and button; the box is ticked and locked; accepting calls sessions.editRewind and returns before the edit call
  assert.match(edit, /rewind \? t\('edit\.rewindTitle'\) : t\('edit\.title'\)/);
  assert.match(edit, /disabled=\{rewind \|\| !info\.canRewind\}/);
  const onOk = edit.slice(edit.indexOf('onOk:'));
  const early = onOk.indexOf("if (rewind) return call('sessions.editRewind'");
  assert.ok(early > -1 && early < onOk.indexOf("'sessions.edit'"));
  assert.equal((edit.match(/'sessions\.edit'/g) ?? []).length, 1);
  assert.match(edit, /export const rewindFrom = \(sessionId, item\) => edit\(sessionId, item, \{ rewind: true \}\)/);
});

test('«Volver atrás…» is not offered while the chat works, and says what it does', async () => {
  assert.match(card, /user && !running && fullPc\(\)/);
  assert.match(card, /running=\{running \|\| session\.status === 'running'\}/);
  const { createT } = await import('../src/shared/i18n.mjs');
  for (const lang of ['es', 'en']) {
    const tt = createT(lang);
    const tip = tt('turn.rewindTip', { message: 'hola' });
    assert.ok(tip.includes('hola'));
    assert.ok(/reenvía|sent again/.test(tip) && /trabaja|works/.test(tip) && /deshacer|undone/.test(tip), lang);
    assert.ok(/reenvía|sent again/.test(tt('edit.rewindDesc')), lang);
  }
});

test('the «Móvil» chip is a button that opens the permissions on the phone switch, and the off text says what turning it on does', () => {
  assert.match(session, /<button type="button" onClick=\{\(\) => setPermAsk\(\{ at: Date\.now\(\), focus: 'android' \}\)\}[^>]*data-testid="session-android-chip"/);
  assert.match(session, /tip: s\.android \? t\('session\.androidOn'\) : t\('session\.androidOff'\)/);
  assert.equal((session.match(/request=\{permAsk\}/g) ?? []).length, 2);
  // opening the menu grants nothing: the effect only unfolds, opens and aims the focus
  const effect = autonomy.slice(autonomy.indexOf('// opened from outside'), autonomy.indexOf('const pick'));
  assert.doesNotMatch(effect, /onChange|onToggle/);
  assert.match(autonomy, /request = null/);
});

test('turns are read once per finished turn and shared; the numbers of the cards go one at a time', () => {
  assert.doesNotMatch(card, /updated_at/);
  assert.doesNotMatch(ui('components', 'turn-changes.jsx'), /call\('sessions\.turns'|updated_at/);
  assert.match(ui('components', 'turn-changes.jsx'), /useTurns\(session\)/);
  assert.match(card, /useTurns\(session, enabled\)/);
  assert.match(data, /\[id, running, enabled\]/);
  assert.match(card, /new IntersectionObserver/);
});

test('the turns store: one request for repeated asks, a new one only after a run', async () => {
  const calls = [];
  const store = createTurnsStore(async (id) => { calls.push(id); return { available: true, turns: [{ n: calls.length, at: 1 }] }; });
  const [a, b] = await Promise.all([store.load('s'), store.load('s')]);
  assert.equal(a, b); assert.equal(calls.length, 1);
  await store.load('s'); assert.equal(calls.length, 1);
  // while the chat works the list already read is kept; when the run ends it is read once more
  store.setRunning('s', true);
  await store.load('s'); assert.equal(calls.length, 1);
  store.setRunning('s', true);
  store.setRunning('s', false);
  await Promise.all([store.load('s'), store.load('s')]); assert.equal(calls.length, 2);
  await store.load('s'); assert.equal(calls.length, 2);
  assert.equal(store.get('s').turns[0].n, 2);
});

test('the turns store: a failure gives «no photos» and is read again the next time', async () => {
  let fail = true; let n = 0;
  const store = createTurnsStore(async () => { n++; if (fail) throw new Error('x'); return { available: true, turns: [{ n: 1, at: 1 }] }; });
  assert.equal((await store.load('s')).available, false);
  fail = false;
  assert.equal((await store.load('s')).available, true); assert.equal(n, 2);
});

test('the diff queue asks one at a time, keeps results, skips what left the screen and lets a failure be asked again', async () => {
  let active = 0; let peak = 0; const asked = []; let fail = false;
  const tick = () => new Promise((r) => setImmediate(r));
  const queue = createDiffQueue(async (p) => { active++; peak = Math.max(peak, active); await tick(); active--; asked.push(p.n); if (fail) throw new Error('x'); return { files: [p.n] }; }, { delay: 0, wait: tick });
  const all = await Promise.all([1, 2, 3].map((n) => queue.request(`s:${n}`, { n })));
  assert.equal(peak, 1); assert.deepEqual(all.map((x) => x.files[0]), [1, 2, 3]);
  await queue.request('s:2', { n: 2 }); assert.deepEqual(asked, [1, 2, 3], 'a finished turn is not asked twice');
  assert.deepEqual(queue.peek('s:3'), { files: [3] });
  const dup1 = queue.request('s:4', { n: 4 }); const dup2 = queue.request('s:4', { n: 4 });
  assert.equal(dup1, dup2);
  await dup1; assert.deepEqual(asked, [1, 2, 3, 4]);
  let visible = true;
  const first = queue.request('s:5', { n: 5 }); const gone = queue.request('s:6', { n: 6 }, () => visible); visible = false;
  await first; await assert.rejects(gone, (e) => e.skipped === true); assert.ok(!asked.includes(6));
  fail = true; await assert.rejects(queue.request('s:7', { n: 7 })); fail = false;
  assert.deepEqual(await queue.request('s:7', { n: 7 }), { files: [7] });
});

test('turn cards: a normal chat, a rewound one and a turn without its photo', () => {
  const item = (id, role, at) => ({ type: 'item', key: id, item: { id, role, kind: 'text', at, body: 'x' } });
  const line = (key, at) => ({ type: 'item', key, item: { role: 'system', kind: 'rewind', at, body: {} } });
  // after a rewind the old references stay and the new turn goes after its own message, never between the line and the message
  const rewound = [item(1, 'user', 1000), item(2, 'assistant', 5000), item(3, 'user', 9000), item(4, 'assistant', 12000), line('r', 20000), item(5, 'user', 21000), item(6, 'assistant', 30000)];
  const placed = placeTurns(rewound, [{ n: 1, at: 5100 }, { n: 2, at: 12100 }, { n: 3, at: 30100 }]);
  assert.deepEqual([...placed].map(([k, v]) => [k, v.n, v.user?.id]), [[2, 1, 1], [4, 2, 3], [6, 3, 5]]);
  // a turn with no photo before it (numbers 1 and 3): its card covers both messages and offers none to go back to
  const gap = [item(1, 'user', 1000), item(2, 'assistant', 5000), item(3, 'user', 9000), item(4, 'assistant', 12000), item(5, 'user', 20000), item(6, 'assistant', 25000)];
  const g = placeTurns(gap, [{ n: 1, at: 5100 }, { n: 3, at: 25100 }]);
  assert.deepEqual([...g].map(([k, v]) => [k, v.n, v.user?.id ?? null, v.gap]), [[2, 1, 1, false], [6, 3, null, true]]);
  // a stale reference older than the first message places nothing
  assert.equal(placeTurns([item(1, 'user', 9000), item(2, 'assistant', 9500)], [{ n: 1, at: 100 }]).size, 0);
});

test('step 6C1: one chip for agent, model and reasoning with one menu; the folder chip and «Compactar» left the box', () => {
  const composer = ui('components', 'conversation', 'composer.jsx');
  // order in the box: «+», permissions, then the context meter and the one chip
  const bottom = session.slice(session.indexOf('bottom={<>'));
  const at = (frag) => bottom.indexOf(frag);
  assert.ok(at('<AttachMenu') < at('<AutonomySwitch') && at('<AutonomySwitch') < at('<ContextMeter') && at('<ContextMeter') < at('<AgentChip'));
  assert.doesNotMatch(session, /<ReasoningMenu|<Select size="sm" value=\{s\.model/);
  assert.doesNotMatch(bottom, /session-folder/);
  assert.match(session, /<AgentChip catalog=\{catalog\} agent=\{s\.agent\}/);
  assert.match(session, /call\('sessions\.update', \{ id: s\.id, model \}\)/);
  assert.match(session, /call\('sessions\.update', \{ id: s\.id, reasoning \}\)/);
  // the chip is the model picker, the level inside it the reasoning picker; the menu has the three parts
  const chip = brain.slice(brain.indexOf('export function AgentChip'), brain.indexOf('// four small bars'));
  assert.match(chip, /data-testid="session-model"/);
  assert.match(chip, /data-testid="reasoning-picker"/);
  assert.match(chip, /data-testid="reasoning-level"/);
  assert.match(chip, /data-testid="reasoning-menu"/);
  assert.match(chip, /w-\[240px\]/);
  assert.match(chip, /t\('session\.model'\)[\s\S]*t\('brain\.reasoning'\)[\s\S]*t\('guide\.open'\)/);
  assert.match(chip, /const list = levelsFor\(catalog, \{ agent, account, model \}\)/); // «Extra» only where the model takes it
  assert.match(brain, /<ModelGuide /);
  // the row over the box: where the chat works and «Compactar» on the right; both outside the box
  assert.match(composer, /data-testid="composer-above"/);
  assert.ok(composer.indexOf('data-testid="composer-above"') < composer.indexOf('data-slot="composer"'));
  assert.match(session, /above=\{s\.kind === 'chat'/);
  assert.match(session, /<WorkspacePills project=\{s\.project\} chat=\{s\.id\}/);
  assert.match(session, /<ContextSlot className="ml-auto" items=\{\[compactable \? \{ key: 'compact'/);
  const top = session.slice(session.indexOf('        top={'), session.indexOf('        bottom={'));
  assert.doesNotMatch(top, /CompactButton/);
  // a chat that started shows where it works but cannot change it
  const pills = ui('components', 'workspace-pills.jsx');
  assert.match(pills, /call\('worktrees\.status', \{ id: String\(chat\) \}\)/);
  // the chosen segment is marked like any other (never dimmed by `disabled`) and the base branch always shows when it is known
  const locked = pills.slice(pills.indexOf('data-locked'), pills.indexOf('const git ='));
  assert.doesNotMatch(locked, /disabled/);
  assert.match(locked, /aria-pressed=\{!info\.has\}/);
  assert.match(pills, /const from = info\.has \? info\.base : branch/);
  assert.match(session, /<WorkspacePills project=\{s\.project\} chat=\{s\.id\} branch=\{s\.branch \?\? ''\}/);
  for (const id of ['workspace-pills', 'workspace-local', 'workspace-worktree', 'workspace-base']) assert.ok(pills.includes(`data-testid="${id}"`), id);
  assert.match(session, /t\('session\.phChat'\)/);
});

test('paso 6C2: el mensaje del PC es una píldora gris sin nombre ni avatar, con copiar y la hora debajo; el móvil conserva el suyo', () => {
  const box = ui('components', 'conversation', 'message-box.jsx');
  assert.match(box, /if \(fullPc\(\)\) \{/);
  assert.match(box, /bg-bubble text-bubble-foreground rounded-big px-3\.5 py-\[9px\]/);
  assert.match(box, /className="msg-box-head sr-only" data-testid="msg-name"/);
  assert.match(box, /group-hover\/msg:opacity-100 group-focus-within\/msg:opacity-100 \[@media\(hover:none\)\]:opacity-100/);
  assert.match(box, /data-testid="msg-pin"/);
  assert.match(box, /data-testid="msg-copy"/);
  assert.match(box, /pin\.pinned \? 'text-primary-text' : reveal/);
});

test('paso 6C2: una tarjeta de cambios sin archivos (o aún sin números) no se pinta, y cada archivo lleva «⌄»', () => {
  assert.match(card, /if \(!failed && \(!data \|\| !files\.length\)\) return <div ref=\{box\}/);
  assert.doesNotMatch(card, /<ChevronRight className="text-muted-foreground size-3\.5 shrink-0" aria-hidden="true" \/>\s*<\/button>/);
  assert.match(card, /<ChevronDown className="text-muted-foreground size-3\.5 shrink-0" aria-hidden="true" \/>\s*<\/button>/);
  assert.match(card, /turn\.moreFiles/);
  assert.doesNotMatch(card, /border-b pb-2 text-\[13px\]/, 'sin línea bajo «Trabajó…»');
});

test('paso 7C1: «Compactar» está siempre en la fila de un chat con proyecto (desactivado con su motivo) y la línea de acciones cierra el turno una vez', () => {
  assert.match(session, /<CompactButton onCompact=\{compact\} busy=\{compacting\} reason=\{compactable \? null :/);
  assert.match(session, /t\('compact\.noRoom'\)/);
  const bar = ui('components', 'conversation', 'bar.jsx');
  assert.match(bar, /disabled=\{busy \|\| Boolean\(reason\)\}/);
  // an answer has no copy or time of its own on the PC: TurnActions closes the turn, after the changes card
  const box = ui('components', 'conversation', 'message-box.jsx');
  const answerRow = box.slice(box.indexOf('{user || pinButton || actions ?'), box.indexOf('</article>'));
  assert.doesNotMatch(answerRow, /msg-copy/);
  assert.match(box, /export function TurnActions/);
  assert.ok(card.indexOf('<TurnCard sessionId') < card.indexOf('<TurnActions at='), 'the row goes after the card');
  assert.match(session, /<TurnFlow [^>]*onFork=\{s\.kind === 'chat' \? fork : null\}/);
});

test('paso 7C1: turnTails da una sola fila por turno (con el texto de sus respuestas) y ninguna al turno en curso', async () => {
  const { turnTails } = await import('../src/ui/lib/turn-cards.js');
  const u = (key, id) => ({ type: 'item', key, item: { id, role: 'user', kind: 'text', body: 'hola', at: 1 } });
  const a = (key, body, at) => ({ type: 'item', key, item: { role: 'assistant', kind: 'text', body, at } });
  const blocks = [u('u1', 1), a('a1', 'uno', 10), { type: 'tool', key: 't1' }, a('a2', 'dos', 20), u('u2', 2), a('a3', 'tres', 30)];
  const done = turnTails(blocks, false);
  assert.deepEqual([...done.keys()], ['t1'.replace('t1', 'a2'), 'a3']);
  assert.equal(done.get('a2').text, 'uno\n\ndos');
  assert.equal(done.get('a2').at, 20);
  assert.deepEqual([...turnTails(blocks, true).keys()], ['a2']);
});

test('the text box has the mock-up\'s measures in both chats: 720 px wide at most and 14 px from the bottom', () => {
  const composer = ui('components', 'conversation', 'composer.jsx');
  assert.match(composer, /className="composer-dock shrink-0 px-5 pb-3\.5"/);
  assert.match(composer, /max-w-\[var\(--chat-max-width\)\] rounded-big border/);
  assert.match(ui('tokens.css'), /--chat-max-width: 45rem;/);
});
