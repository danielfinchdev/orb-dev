// 3.6: the wizard's templates (src/core/templates.mjs): generic, the same in Spanish and English, editable before applying;
// «Mi casa» with edits makes its bots, group, reminders (at the wall time in the person's zone) and golden rules.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine, ROOT } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import * as B from '../src/core/bots.mjs';
import { ctx } from '../src/core/context.mjs';
import { listTemplates, applyTemplate, getTemplate } from '../src/core/templates.mjs';
import { utcToZoned } from '../src/core/tz.mjs';

test('the four templates exist in es and en with the same shape, and say nothing personal', () => {
  const es = listTemplates('es'); const en = listTemplates('en');
  assert.deepEqual(es.map((t) => t.id), ['negocio', 'casa', 'desarrollo', 'vacio']);
  assert.deepEqual(en.map((t) => t.id), es.map((t) => t.id));
  assert.deepEqual(es.map((t) => t.name), ['Mi negocio', 'Mi casa', 'Desarrollo', 'Empezar vacío']);
  assert.deepEqual(en.map((t) => t.name), ['My business', 'My home', 'Development', 'Start empty']);
  for (let i = 0; i < es.length; i++) {
    const [a, b] = [es[i], en[i]];
    assert.deepEqual(a.bots.map((x) => [x.key, x.tools]), b.bots.map((x) => [x.key, x.tools]));
    assert.deepEqual(a.reminders.map((x) => [x.bot, x.every, x.time]), b.reminders.map((x) => [x.bot, x.every, x.time]));
    assert.equal(a.groups.length, b.groups.length); assert.equal(a.rules.length, b.rules.length);
    for (const bot of a.bots) for (const tool of bot.tools) assert.ok(B.TOOL_GROUPS.includes(tool), tool);
  }
  const all = fs.readdirSync(path.join(ROOT, 'src', 'core', 'templates'), { recursive: true }).filter((f) => f.endsWith('.json')).map((f) => fs.readFileSync(path.join(ROOT, 'src', 'core', 'templates', f), 'utf8')).join('\n');
  assert.doesNotMatch(all, /@|https?:\/\/|\+?\d{9,}|\b(Dani|Daniel|María|Madrid|tailscale|vaultwarden)\b/i);
  assert.doesNotMatch(en.map((t) => JSON.stringify(t)).join(''), /[áéíóúñ¿¡]/);
});

test('«Mi casa» applied with edits: bots, group, reminders at 10:00 in the person\'s zone, rules; nothing half made on error', () => {
  const { cleanup } = tempHome();
  const board = new Board();
  try {
    const t = getTemplate('casa', 'es');
    const edits = { bots: t.bots.map((b) => (b.key === 'hogar' ? { ...b, name: 'Leo' } : b)), reminders: t.reminders.slice(0, 1) };
    const now = Date.parse('2026-11-04T12:00:00Z'); // a Wednesday
    const made = applyTemplate(board, { id: 'casa', lang: 'es', edits, tz: 'America/New_York', now });
    assert.equal(made.bots.length, 2); assert.equal(made.groups.length, 1); assert.equal(made.reminders.length, 1); assert.equal(made.rules, 1);
    const leo = B.getBot(board, 'Leo'); assert.ok(leo); assert.deepEqual(leo.tools, ['internet', 'recordatorios']);
    assert.ok(B.getBot(board, 'Casa conectada'));
    assert.deepEqual(B.getGroup(board, made.groups[0]).members.sort(), made.bots.slice().sort());
    const rem = B.getReminder(board, made.reminders[0]);
    assert.equal(rem.every, 'weekly'); assert.deepEqual(rem.weekdays, [6]); assert.equal(rem.bot_id, leo.id);
    const at = utcToZoned(new Date(rem.start_at), 'America/New_York');
    assert.equal(at.iso.slice(11, 16), '10:00'); assert.equal(at.weekday, 6); assert.equal(at.iso.slice(0, 10), '2026-11-07');
    assert.ok(ctx.config.bots.rules.includes('No compres nada sin que te lo confirme.'));
    // Again: names do not clash and the rule is not repeated.
    const again = applyTemplate(board, { id: 'casa', lang: 'es', now });
    assert.ok(B.getBot(board, 'Hogar') && B.getBot(board, 'Casa conectada 2'));
    assert.equal(again.rules, 0); assert.equal(again.reminders.length, 2);
    // A broken edit (a reminder for a bot that is not there) changes nothing.
    const before = B.listBots(board).length;
    assert.throws(() => applyTemplate(board, { id: 'casa', edits: { reminders: [{ bot: 'nadie', text: 'x', every: 'daily', time: '09:00' }] } }), /no cuadra/);
    assert.equal(B.listBots(board).length, before);
    assert.throws(() => applyTemplate(board, { id: 'otra' }), /plantilla/);
    // Starting empty makes nothing.
    assert.deepEqual(applyTemplate(board, { id: 'vacio' }).bots, []);
  } finally { board.db.close(); cleanup(); }
});

test('engine: templates.list in English and templates.apply', async () => {
  const { home, cleanup } = tempHome({ language: 'en' });
  const e = await startEngine(home);
  try {
    const list = await e.call('templates.list', {});
    assert.equal(list[0].name, 'My business');
    const made = await e.call('templates.apply', { id: 'negocio', tz: 'Europe/London' });
    assert.equal(made.bots.length, 2);
    const names = (await e.call('bots.list')).bots.map((b) => b.name);
    assert.ok(names.includes('Customers') && names.includes('Calendar'), names.join(', '));
  } finally { await e.stop(); cleanup(); }
});
