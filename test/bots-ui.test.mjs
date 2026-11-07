// 3.5, the interface of the Bots mode (src/ui/lib/bots.js): the two modes, the bot a chat opens with, what the editor
// sends, the workshop's banner and the live chat lines. Magic Link's pieces: test/link-ui.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import * as U from '../src/ui/lib/bots.js';
import { TOOL_GROUPS, EFFORTS } from '../src/core/bots.mjs';

test('cada pantalla está en su modo; las compartidas abiertas desde Bots siguen en Bots', () => {
  for (const view of ['bot-chat', 'bot-group', 'bots', 'bot-reminders', 'bot-memory', 'bot-home', 'bot-server', 'bot-settings', 'bot-groups']) assert.equal(U.modeOf({ view }), 'bots', view);
  for (const view of ['chat', 'session', 'tasks', 'projects', 'more', 'link']) assert.equal(U.modeOf({ view }), 'orb', view);
  assert.equal(U.modeOf({ view: 'more', mode: 'bots' }), 'bots');
  assert.equal(U.modeOf(null), 'orb');
});

test('las herramientas y los niveles del editor son los del motor', () => {
  assert.deepEqual([...U.TOOL_ORDER].sort(), [...TOOL_GROUPS].sort());
  assert.deepEqual(U.EFFORTS, EFFORTS);
});

test('el chat abre el último bot, si no el jefe, si no el primero', () => {
  const bots = [{ id: 1, name: 'Asistente' }, { id: 2, name: 'Jefe', is_chief: true }, { id: 3, name: 'Agenda' }];
  assert.equal(U.chatBot(bots, '3').name, 'Agenda');
  assert.equal(U.chatBot(bots, 99).name, 'Jefe', 'el último ya no existe');
  assert.equal(U.chatBot(bots.filter((b) => !b.is_chief)).name, 'Asistente');
  assert.equal(U.chatBot([]), null);
});

test('el editor manda solo lo que el motor acepta, con las listas limpias', () => {
  const d = { ...U.newBotDraft('codex'), name: '  Compras ', tools: ['casa', 'internet', 'nada'], exclusive: 'Compras, , Amazon ', accounts: { mcp: ['gmail-multi', ''], account: ' ' }, effort: 'raro', model: '' };
  const p = U.botPayload(d);
  assert.equal(p.name, 'Compras');
  assert.equal(p.agent, 'codex');
  assert.equal(p.model, null, 'sin modelo = el del agente');
  assert.equal(p.effort, 'medium');
  assert.deepEqual(p.tools, ['internet', 'casa'], 'en el orden del editor y sin desconocidas');
  assert.deepEqual(p.exclusive, ['compras', 'amazon']);
  assert.deepEqual(p.accounts, { mcp: ['gmail-multi'] });
  assert.equal(U.newBotDraft().icon, '🤖');
});

test('la fecha de un recordatorio', () => {
  assert.match(U.localWhen(new Date(2026, 2, 4, 9, 5)), /^2026-03-04T09:05$/);
});

test('las líneas en directo: una nueva al final, una cambiada en su sitio; quién habla', () => {
  let lines = [{ id: 1, role: 'usuario', body: 'hola' }];
  lines = U.mergeLine(lines, { id: 2, role: 'system', body: 'tarjeta', meta: { kind: 'bot_card', status: 'pending' }, conversation: 5 });
  assert.equal(lines.length, 2);
  lines = U.mergeLine(lines, { id: 2, role: 'system', body: 'x', meta: { kind: 'bot_card', status: 'done' }, updated: true });
  assert.equal(lines[1].meta.status, 'done');
  assert.equal(lines[1].body, 'tarjeta', 'el texto entero se queda (el evento lo trae recortado)');
  assert.equal(U.mergeLine(lines, { id: 9, updated: true }).length, 2, 'un cambio de una línea que no está no la añade');
  assert.deepEqual(U.speakerOf({ role: 'bot', meta: { bot: 3, name: 'Agenda', icon: '📅' } }), { kind: 'bot', id: 3, name: 'Agenda', icon: '📅' });
  assert.equal(U.speakerOf({ role: 'usuario' }).kind, 'user');
  assert.equal(U.speakerOf({ role: 'system' }).kind, 'system');
});

test('la interfaz registra las pantallas de los bots en los dos diseños y el menú según el modo', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'main.jsx'), 'utf8');
  for (const v of U.BOT_VIEWS) assert.ok(main.includes(`'${v}'`) || main.includes(` ${v}:`), `VIEWS sin ${v}`);
  const side = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'components', 'sidebar.jsx'), 'utf8');
  assert.match(side, /ModeSwitch/); assert.match(side, /BotsInbox/);
  const tabs = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'components', 'mobile-tabs.jsx'), 'utf8');
  assert.match(tabs, /nav-bot-chat/);
});
