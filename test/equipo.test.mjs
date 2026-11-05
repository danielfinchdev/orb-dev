// 3.7: «Monitoreo del equipo» y Opti Bot ya no existen como pantalla aparte: lo que hacían es la herramienta «Equipo» de
// los bots (pc_* en src/mcp/bot.mjs; los cambios, tarjetas «pc» que ejecuta core/pc-actions.mjs) y la plantilla opcional
// «Mantenimiento del PC». Lo que quedaba de antes (ajustes y la conversación de Opti Bot) se recoge sin perder nada.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, until } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { loadConfig, writeJson } from '../src/core/home.mjs';
import { ctx, saveConfig } from '../src/core/context.mjs';
import * as B from '../src/core/bots.mjs';
import { POLICY, SENSITIVE_CARDS } from '../src/core/policy.mjs';
import { checkPcAction, PC_ACTION_IDS, PC_ACTIONS } from '../src/core/pc-actions.mjs';
import { getTemplate, applyTemplate } from '../src/core/templates.mjs';
import { Bots, botPersona, isSensitiveCard } from '../src/engine/bots.mjs';
import { migrateRetiredConfig, retireOpti } from '../src/engine/retired.mjs';

const WIN = process.platform === 'win32';
const t = tempHome();
after(() => t.cleanup());
const board = new Board();
const bots = new Bots(board, { emit: () => {}, push: () => {} }).start();
after(() => bots.shutdown());
const lines = (bot) => board.chat(B.botConversation(board, B.getBot(board, bot)), 200);
const replies = (bot) => lines(bot).filter((l) => l.role === 'bot' && l.meta?.name === bot && l.meta?.kind !== 'relay');
const cards = (bot) => lines(bot).filter((l) => l.meta?.kind === 'bot_card' && l.meta.card === 'pc');

test('Monitoreo y Opti Bot ya no existen: ni métodos, ni ajuste «monitor»; «Equipo» es un grupo de herramientas del dueño', () => {
  assert.ok(!Object.keys(POLICY).some((m) => m.startsWith('opti.')), 'sin opti.* en la API');
  assert.throws(() => saveConfig({ monitor: { enabled: true } }), /monitor/);
  assert.ok(B.TOOL_GROUPS.includes('equipo'));
  assert.equal(B.INTEGRATION_TOOLS.equipo, 'pc', 'como la casa y el servidor: es del dueño salvo que lo comparta');
  assert.ok(SENSITIVE_CARDS.has('pc') && isSensitiveCard({ card: 'pc' }), 'aprobar un cambio en el PC pide el PIN si lo hay');
  for (const f of ['src/engine/opti.mjs', 'src/mcp/opti.mjs', 'src/ui/views/monitor.jsx']) assert.ok(!fs.existsSync(path.join(import.meta.dirname, '..', f)), f);
});

test('pc_propose solo deja la lista fija de antes, con motivo y con su objetivo', () => {
  assert.deepEqual(PC_ACTION_IDS, ['defender_quick_scan', 'defender_update', 'clean_temp', 'end_process', 'disable_startup']);
  assert.ok(PC_ACTIONS.defender_quick_scan.admin && !PC_ACTIONS.clean_temp.admin);
  assert.throws(() => checkPcAction({ action: 'format_disk', reason: 'x' }), /lista/);
  assert.throws(() => checkPcAction({ action: 'clean_temp' }), /por qué/);
  assert.throws(() => checkPcAction({ action: 'end_process', pid: 4, reason: 'x' }), /Id del proceso/);
  assert.throws(() => checkPcAction({ action: 'disable_startup', reason: 'x' }), /nombre exacto/);
  assert.deepEqual(checkPcAction({ action: 'defender_update', reason: ' firmas viejas ', pid: 77 }), { action: 'defender_update', reason: 'firmas viejas', admin: true }, 'lo que no toca a esa acción se quita');
});

test('un bot con «Equipo» mira el PC y Orb con sus herramientas; sin ella no las tiene', async () => {
  B.createBot(board, { name: 'Doc', role_text: 'Cuida del PC', tools: ['equipo'] });
  B.createBot(board, { name: 'Sin', role_text: 'Otra cosa', tools: ['internet'] });
  const doc = B.getBot(board, 'Doc');
  assert.deepEqual(B.effectiveTools(board, doc), ['equipo']);
  assert.match(botPersona(board, doc), /pc_health/);
  assert.doesNotMatch(botPersona(board, B.getBot(board, 'Sin')), /pc_health/);
  bots.send('Doc', 'Revisa el PC\nBOT_CALL pc_health {}\nBOT_CALL pc_orb_check {}');
  const reply = await until(() => replies('Doc')[0], 'Doc contesta', 90000);
  assert.match(reply.body, /pc_health: \{/);
  assert.match(reply.body, /"usedPct"/, 'la memoria y el disco, con números');
  assert.match(reply.body, /"database": "ok"/, 'la base de datos de Orb está sana');
  bots.send('Sin', 'Mira el PC\nBOT_CALL pc_health {}');
  assert.match((await until(() => replies('Sin')[0], 'Sin contesta', 30000)).body, /desconocida/);
});

test('un cambio en el PC es una tarjeta: no se hace nada hasta aprobarla, y lo que pasó vuelve al bot', { skip: !WIN && 'pc_propose solo existe en Windows' }, async () => {
  // A process that does not exist: approving it runs the real action, which finds nothing to close (no UAC, nothing closed).
  bots.send('Doc', 'Ciérralo\nBOT_CALL pc_propose {"action":"end_process","pid":999999,"name":"nada.exe","reason":"No responde"}');
  const card = await until(() => cards('Doc')[0], 'la tarjeta', 30000);
  assert.equal(card.meta.status, 'pending');
  assert.match(card.body, /Doc quiere cerrar un programa en este PC: nada \(999999\)\. Motivo: No responde\./);
  const out = await bots.decide(card.id, 'allow');
  assert.equal(out.status, 'failed');
  assert.match(out.result, /999999 ya no existe/);
  await until(() => lines('Doc').some((l) => l.role === 'bot' && /AVISO DEL SISTEMA.*no ha salido bien/.test(l.body)), 'Doc se entera de que no salió', 30000);
  // One that needs administrator rights says so; refused, nothing runs.
  bots.send('Doc', 'Analiza\nBOT_CALL pc_propose {"action":"defender_quick_scan","reason":"Hace semanas del último"}');
  const scan = await until(() => cards('Doc').find((c) => c.meta.payload?.action === 'defender_quick_scan'), 'la tarjeta del análisis', 30000);
  assert.match(scan.body, /administrador/);
  assert.equal((await bots.decide(scan.id, 'deny')).status, 'denied');
  await assert.rejects(() => bots.decide(scan.id, 'allow'), /ya está respondida/);
});

test('fuera de Windows no se ofrece pc_propose', { skip: WIN && 'en Windows sí existe' }, async () => {
  bots.send('Doc', 'Limpia\nBOT_CALL pc_propose {"action":"clean_temp","reason":"x"}');
  await until(() => replies('Doc').some((r) => /pc_propose: .*desconocida/.test(r.body)), 'herramienta desconocida', 30000);
  assert.equal(cards('Doc').length, 0);
});

test('la plantilla opcional «Mantenimiento del PC» crea un bot con «Equipo» y su revisión semanal', () => {
  for (const lang of ['es', 'en']) {
    const tpl = getTemplate('mantenimiento', lang);
    assert.equal(tpl.bots.length, 1); assert.ok(tpl.bots[0].tools.includes('equipo'));
    assert.equal(tpl.reminders[0].every, 'weekly');
  }
  const made = applyTemplate(board, { id: 'mantenimiento', lang: 'es', tz: 'Europe/Madrid' });
  const bot = B.getBot(board, made.bots[0]);
  assert.equal(bot.name, 'Mantenimiento');
  assert.deepEqual(bot.tools, ['equipo', 'recordatorios']);
  const rem = B.getReminder(board, made.reminders[0]);
  assert.equal(rem.every, 'weekly'); assert.deepEqual(rem.weekdays, [1]);
  assert.equal(made.rules, 0, 'no añade reglas de oro');
});

test('lo de antes se recoge una vez: «monitor» sale de orb.json (compartir con OCE se queda) y Opti Bot queda archivado', () => {
  const file = ctx.paths.config;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  writeJson(file, { ...raw, monitor: { enabled: true, agent: 'codex', model: 'x', shareWithOce: false } });
  const loaded = loadConfig(t.home);
  assert.equal(loaded.monitor, undefined);
  assert.equal(loaded.oce?.share, false, 'apagado sigue apagado');
  assert.equal(migrateRetiredConfig(file), true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.monitor, undefined); assert.equal(saved.oce.share, false);
  assert.equal(saved.userName, raw.userName, 'lo demás no cambia');
  assert.equal(migrateRetiredConfig(file), false, 'una vez');
  // Opti Bot's conversation: archived, not deleted; its waiting proposals say they expired.
  const now = new Date().toISOString();
  board.run("INSERT INTO sessions (id, kind, agent, permission, cwd, title, created_at, updated_at) VALUES ('opti-1', 'chat', 'claude', 'leer', ?, 'Opti Bot', ?, ?)", t.home, now, now);
  const item = (status) => Number(board.run("INSERT INTO session_items (session_id, role, kind, body, at) VALUES ('opti-1', 'system', 'opti_action', ?, ?)", JSON.stringify({ action: 'clean_temp', reason: 'x', status }), now).lastInsertRowid);
  const pending = item('pending'); const done = item('done');
  board.setting('opti_session', 'opti-1'); board.settingJson('opti_pending', [{ action: 'clean_temp', reason: 'y' }]);
  assert.deepEqual(retireOpti(board), { session: 'opti-1', expired: 1 });
  assert.equal(board.one("SELECT archived FROM sessions WHERE id = 'opti-1'").archived, 1);
  assert.equal(JSON.parse(board.one('SELECT body FROM session_items WHERE id = ?', pending).body).status, 'expired');
  assert.equal(JSON.parse(board.one('SELECT body FROM session_items WHERE id = ?', done).body).status, 'done');
  assert.equal(board.setting('opti_session'), undefined); assert.equal(board.setting('opti_pending'), undefined);
  assert.equal(board.one("SELECT COUNT(*) AS n FROM session_items WHERE session_id = 'opti-1'").n, 2, 'nada se borra');
  assert.equal(retireOpti(board), null, 'una vez');
});
