// 3.8.9, visual fixes (II) of the PC interface and Android's texts. Read as text where the code is JSX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const src = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');
const locale = (lang) => fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, 'chat.mjs'), 'utf8');

test('42: the composer shows the orchestrator icon, lit when on and dim when off', () => {
  const chat = src('views', 'chat.jsx');
  const sw = chat.slice(chat.indexOf('function OrchestratorSwitch'), chat.indexOf('function LiveAnswer'));
  assert.match(chat, /import \{ OrchestratorIcon \}/);
  assert.match(sw, /<OrchestratorIcon className=\{cn\('size-4', on \? 'text-primary' : 'text-muted-foreground'\)\}/);
  assert.doesNotMatch(sw, /\{t\('chat\.orchestrator'\)\}<\/span>/, 'no «Orquestador» word next to the switch');
  assert.match(sw, /aria-label=\{t\('chat\.orchestrator'\)\}/);
  assert.match(sw, /title=\{t\('chat\.orchestratorTip'/);
});

test('43: the new chat has the full permissions menu and applies it to the chat it creates', () => {
  const chat = src('views', 'chat.jsx');
  assert.match(chat, /<AutonomySwitch \{\.\.\.newChatAccess\} testid="chat-autonomy"/);
  assert.match(chat, /options\(PERMISSION\)\.filter/);
  assert.match(chat, /key: 'android'/);
  // the chosen level goes to sessions.create; the total level and the phone are granted with the master password
  assert.match(chat, /\{ permission: level \}/);
  assert.match(chat, /sessions\.grantTotal/);
  assert.match(chat, /sessions\.grantAndroid/);
  // a chat without a project groups «Solo lectura» as the main level and the rest under «Más opciones»
  assert.match(src('views', 'session.jsx'), /<AutonomySwitch main=\{\['leer'\]\}/);
});

test('49: a project with no open chat has no group; the completed ones live in one place, by project; a fresh one lingers', async () => {
  const M = await import('../src/ui/lib/inbox.js');
  const at = (m) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString();
  const row = (id, project, min, extra = {}) => ({ key: `conversation:${id}`, kind: 'conversation', id, title: `c${id}`, project, at: at(min), tasks: [], unread: 0, ...extra });
  const items = [row(1, null, 5, { done: true }), row(2, 'web', 4, { done: true }), row(3, 'web', 3, { done: true }), row(4, 'shop', 9)];
  const g = M.groupOrb(items);
  assert.deepEqual(g.groups.map((x) => x.project), ['shop'], 'no group (nor «Ver completados») for a project with only completed chats');
  assert.equal(g.hidden, 3);
  assert.deepEqual(g.completed.map((x) => [x.project, x.items.map((y) => y.id)]), [['web', [2, 3]], [null, [1]]]);
  // just completed: it stays in its group, and no longer counts as completed
  const l = M.groupOrb(items, { linger: new Set(['conversation:1']) });
  assert.deepEqual(l.groups.map((x) => x.project), ['shop', null]);
  assert.equal(l.hidden, 2);
  const inbox = src('views', 'orb', 'inbox.jsx');
  assert.match(inbox, /function useLinger/);
  assert.match(inbox, /data-testid="orb-undo-done"/);
  assert.match(inbox, /parts\.completed\.map/);
});

test('51: the agent and model line shows only where they change', async () => {
  const { dropRepeatedAgent } = await import('../src/ui/lib/session-blocks.js');
  const st = (id, body) => ({ type: 'item', key: `i${id}`, item: { id, kind: 'status', role: 'system', body } });
  const text = (id) => ({ type: 'item', key: `i${id}`, item: { id, kind: 'text', role: 'assistant', body: 'hi' } });
  const out = dropRepeatedAgent([st(1, 'Claude Code · claude-sonnet-5-5'), text(2), st(3, 'Claude Code · claude-sonnet-5-5'), text(4), st(5, 'Claude Code · claude-opus-5-5'), text(6), st(7, 'Settings skipped: hooks'), st(8, 'Claude Code · claude-opus-5-5')]);
  assert.deepEqual(out.map((b) => b.item.id), [2, 4, 5, 6, 7], 'the first and the repeats go; the change and other notices stay');
  assert.match(src('views', 'session.jsx'), /dropRepeatedAgent\(toBlocks\(items, tb\)\)/);
});

test('52: «cerebro» / «brain» is nowhere in the texts the user reads, on the PC or on Android', async () => {
  const bad = /cerebro|\bbrains?\b/i;
  for (const lang of ['es', 'en']) {
    const dir = path.join(ROOT, 'src', 'shared', 'locales', lang);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
      const table = (await import(`../src/shared/locales/${lang}/${f}`)).default;
      for (const [key, value] of Object.entries(table ?? {})) assert.doesNotMatch(String(value), bad, `${lang}/${f} › ${key}`);
    }
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.kt') ? [path.join(d, e.name)] : []));
  for (const file of walk(path.join(ROOT, 'android', 'app', 'src', 'main'))) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      for (const lit of line.match(/"(?:[^"\\]|\\.)*"/g) ?? []) assert.doesNotMatch(lit, /cerebro/i, `${path.basename(file)}: ${lit}`);
    }
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', 'es', 'chat.mjs'), 'utf8'), /'brain\.title': 'Agente y modelo'/);
});

test('35/40: the pause button is hidden until two agents work at once, and says it pauses them all', () => {
  const bar = src('components', 'conversation', 'bar.jsx');
  const fn = bar.slice(bar.indexOf('export function BarPause'), bar.indexOf('export function BarHeading'));
  assert.match(bar, /export const WORKING_MIN = 2;/);
  assert.match(fn, /if \(!paused && working < WORKING_MIN\) return null;/);
  assert.match(fn, /s\.sessions\.filter\(\(x\) => x\.status === 'running'\)/);
  assert.match(locale('es'), /'bar\.pauseText': 'Pausa a todos los agentes a la vez\./);
});

test('43: a refused grant stops the first message and keeps the draft', () => {
  const chat = src('views', 'chat.jsx');
  assert.match(chat, /chat\.accessNotGiven/);
  assert.match(chat, /grants\.push\(\['android', 'sessions\.grantAndroid'\]\)/);
  assert.match(chat, /access\.android && !\(!project && level === 'total'\)/, 'the phone is kept next to «Total» when there is a project');
  assert.match(chat, /else setAccess\(\{ permission: null, android: false \}\)/);
});
