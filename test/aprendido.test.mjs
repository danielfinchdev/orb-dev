// 3.5: lo aprendido de otros proyectos (docs/LEARNINGS-3.5.md). Un bot enseña lo que está haciendo en una línea tranquila
// (sus pasos, como el chat del asistente), sabe que le escriben desde el móvil (lo dice el dispositivo
// enlazado, nunca el mensaje) y no pide secretos por el chat.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, until } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import * as B from '../src/core/bots.mjs';
import { Bots, botPersona, viaNote } from '../src/engine/bots.mjs';

const t = tempHome();
after(() => t.cleanup());
const board = new Board();
const events = [];
const bots = new Bots(board, { emit: (e, p) => events.push([e, p]) }).start();
after(() => bots.shutdown());
const answers = (name) => board.chat(B.botConversation(board, B.getBot(board, name)), 200).filter((l) => l.role === 'bot');

test('el bot enseña sus pasos mientras trabaja y los quita al terminar', async () => {
  const bot = B.getBot(board, 'Asistente');
  bots.send(bot.id, 'Hola');
  await until(() => answers('Asistente').length >= 1, 'contesta', 20000);
  const states = events.filter(([e, p]) => e === 'bot.state' && p.bot === bot.id).map(([, p]) => p);
  const working = states.find((s) => s.busy && s.tools.length);
  assert.ok(working, 'un estado con los pasos del turno');
  assert.equal(working.tools[0].name, 'Bash');
  assert.equal(working.tools[0].target, 'ls');
  assert.ok(typeof working.since === 'number' && working.since <= Date.now());
  await until(() => !bots.state(bot.id).busy, 'termina', 20000);
  const last = states.at(-1) ?? bots.state(bot.id);
  assert.deepEqual(bots.state(bot.id).tools ?? [], [], 'sin pasos al terminar');
  assert.equal(last.since ?? null, null);
});

test('desde el móvil, el bot recibe una línea para contestar a la medida; desde el PC, nada', async () => {
  const fakeLog = path.join(t.base, 'fake.jsonl'); process.env.ORB_FAKE_LOG = fakeLog;
  try {
    const bot = B.getBot(board, 'Asistente');
    const n = answers('Asistente').length;
    bots.send(bot.id, 'Mensaje del móvil', { via: 'phone' });
    await until(() => answers('Asistente').length >= n + 1, 'contesta', 20000);
    bots.send(bot.id, 'Mensaje del PC');
    await until(() => answers('Asistente').length >= n + 2, 'contesta otra vez', 20000);
    const log = fs.readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const phone = log.find((l) => /Mensaje del móvil/.test(l.text ?? ''));
    const pc = log.find((l) => /Mensaje del PC/.test(l.text ?? ''));
    assert.match(phone.text, /te escribe desde el móvil/);
    assert.doesNotMatch(pc.text, /te escribe desde/);
    // Lo que se guarda en el chat es solo lo que escribió el usuario.
    const mine = board.chat(B.botConversation(board, bot), 200).filter((l) => l.role === 'usuario').map((l) => l.body);
    assert.ok(mine.includes('Mensaje del móvil') && !mine.some((b) => /AVISO DEL SISTEMA/.test(b)));
  } finally { delete process.env.ORB_FAKE_LOG; }
  assert.equal(viaNote('browser'), '');
  assert.equal(viaNote('nada'), '');
});

test('el bot nunca pide contraseñas ni códigos por el chat', () => {
  const persona = botPersona(board, B.getBot(board, 'Asistente'));
  assert.match(persona, /SECRETOS: nunca pidas por el chat contraseñas, códigos de un solo uso ni números de tarjeta/);
});

