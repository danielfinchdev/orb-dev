// 3.8.10: a phone just linked never gets the events from before its link, even asking from an old id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { createJournal } from '../src/engine/transport/remote-events.mjs';

test('el diario no da a un móvil eventos anteriores a su enlace', () => {
  let clock = 1_000;
  const j = createJournal({ now: () => clock, boot: 'aaaaaaaaaaaa' });
  const old = j.add({ e: 'x', p: 'antes' });
  clock = 2_000; const first = j.add({ e: 'x', p: 'antes-2' });
  clock = 5_000; j.add({ e: 'x', p: 'despues-1' });
  clock = 6_000; j.add({ e: 'x', p: 'despues-2' });
  assert.deepEqual(j.since(old, { notBefore: 5_000 }).items.map((x) => x.value.p), ['despues-1', 'despues-2']);
  assert.deepEqual(j.since(first, { notBefore: 5_500 }).items.map((x) => x.value.p), ['despues-2']);
  assert.deepEqual(j.since(old).items.map((x) => x.value.p), ['antes-2', 'despues-1', 'despues-2'], 'sin límite, como siempre');
  assert.deepEqual(j.since(old, { notBefore: 9_000 }).items, [], 'ni uno anterior al enlace');
});

test('el PC reanuda con el momento del enlace de ese dispositivo', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/engine/transport/remote.mjs'), 'utf8');
  assert.match(src, /journal\.since\(lastId, \{ notBefore: Date\.parse\(device\.created_at\)/);
});

test('el PC devuelve la respuesta guardada de un nonce ya visto antes de mirar la hora', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/engine/transport/remote.mjs'), 'utf8');
  const open = src.slice(src.indexOf('function openRequest'));
  assert.ok(open.indexOf("answers.get(device.id)?.get(box.n)") < open.indexOf('freshness(device.id, box.n'), 'la respuesta guardada va antes de la hora');
  assert.match(open, /seen\.get\(device\.id\)\?\.has\(box\.n\)/);
});
