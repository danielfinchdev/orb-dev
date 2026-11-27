// A phone resuming from an id sees holes in the numbering: those are chat:state ids superseded by a newer state of the
// same chat. Nothing else may ever be missing from a replay, or the phone would silently lose an event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { createJournal } from '../src/engine/transport/remote-events.mjs';

test('los huecos de una reanudación son solo estados de chat sustituidos por uno más nuevo', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const j = createJournal({ boot: 'aaaaaaaaaaaa' });
  const meta = new Map(); // n -> { type, key }
  for (let i = 0; i < 400; i++) {
    const chat = Math.floor(rnd() * 3);
    const isState = rnd() < 0.6;
    const key = isState ? `chat:${chat}` : null;
    const id = j.add({ e: isState ? 'chat:state' : 'inbox:changed', p: { conversation: chat } }, key);
    meta.set(Number(id.split('.')[1]), { type: isState ? 'chat:state' : 'inbox:changed', key });
  }
  const start = j.idOf(10);
  const got = j.since(start).items.map((x) => Number(x.id.split('.')[1]));
  const have = new Set(got);
  for (let n = 11; n <= 400; n++) {
    if (have.has(n)) continue;
    const m = meta.get(n);
    assert.equal(m.type, 'chat:state', `id ${n} missing from the replay but it was not a chat:state`);
    assert.ok(got.some((k) => k > n && meta.get(k).key === m.key), `id ${n} missing and no newer state of ${m.key} was replayed`);
  }
});

test('la prueba de aguante da por explicado un hueco cuando llega un estado de chat más nuevo, aunque sea uno solo', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/aguante.mjs'), 'utf8');
  assert.match(src, /cur\.n >= g\.to && at - g\.at < 3000 && g\.left > 0\) \{ s\.gapsExplained \+= g\.left; g\.left = 0;/);
});
