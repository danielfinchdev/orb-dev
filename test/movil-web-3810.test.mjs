// 3.8.10: the phone's web page resumes its live events after a cut and resends a call once with the same nonce
// (the link contract). The logic is pure (src/ui/lib/link-resume.js, net.js); web-bridge.js is checked in its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { parseBlock, resumeRequest, reconnectWait, sendOnce, RESYNC_EVENTS } from '../src/ui/lib/link-resume.js';
import { retryDelay, TIMEOUTS } from '../src/ui/lib/net.js';

const bridge = fs.readFileSync(path.join(ROOT, 'src/ui/lib/web-bridge.js'), 'utf8');

test('un evento numerado se lee con su id; un ping o un comentario no llevan datos', () => {
  assert.deepEqual(parseBlock('id: ab12.7\ndata: xyz'), { id: 'ab12.7', data: 'xyz' });
  assert.deepEqual(parseBlock('data: solo'), { id: null, data: 'solo' });
  assert.deepEqual(parseBlock(': ping'), { id: null, data: '' });
});

test('reanudar: Last-Event-ID (o ?since= desde la app) con el ultimo id visto; sin id, nada', () => {
  assert.deepEqual(resumeRequest(null), { headers: {}, query: '' });
  assert.deepEqual(resumeRequest('ab.3'), { headers: { 'Last-Event-ID': 'ab.3' }, query: '' });
  assert.deepEqual(resumeRequest('ab.3', { crossOrigin: true }), { headers: {}, query: '?since=ab.3' });
});

test('esperas 1/2/5/10/30 s y luego cada 30 s; latido de 40 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 20].map(reconnectWait), [1000, 2000, 5000, 10000, 30000, 30000, 30000]);
  assert.equal(retryDelay(0), 1000);
  assert.equal(TIMEOUTS.eventsIdle, 40_000);
});

test('una llamada sin respuesta se reenvia una sola vez; un error del PC nunca', async () => {
  let n = 0;
  const offline = () => Object.assign(new Error('offline'), { offline: true });
  assert.equal(await sendOnce(async () => { n += 1; if (n === 1) throw offline(); return 'ok'; }), 'ok');
  assert.equal(n, 2);
  n = 0;
  await assert.rejects(sendOnce(async () => { n += 1; throw offline(); }), /offline/);
  assert.equal(n, 2, 'solo un reenvio');
  n = 0;
  await assert.rejects(sendOnce(async () => { n += 1; throw new Error('el PC dijo no'); }), /el PC dijo no/);
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(sendOnce(async () => { n += 1; throw offline(); }, { again: false }));
  assert.equal(n, 1, 'lo que no es una llamada no se reenvia');
});

test('web-bridge: el reenvio usa la misma peticion sellada (mismo nonce) y solo las llamadas', () => {
  assert.match(bridge, /const init = \{ method: 'POST'[^\n]*body: JSON\.stringify\(box\) \}/);
  assert.match(bridge, /sendOnce\(\(\) => reach\(url, init, ms[^\n]*\{ again: kind === 'call' \}\)/);
  assert.equal((bridge.match(/C\.seal\(s\.key/g) ?? []).length, 1, 'un solo sellado por llamada: sin nonce nuevo al reenviar');
});

test('web-bridge: guarda el ultimo id, reanuda con el y recarga todo ante resync', () => {
  assert.match(bridge, /if \(id\) lastId = id/);
  assert.match(bridge, /resumeRequest\(lastId, \{ crossOrigin: Boolean\(host\) \}\)/);
  assert.match(bridge, /e === 'resync'\) \{ for \(const x of RESYNC_EVENTS\) fire\(x, \{\}\)/);
  assert.ok(RESYNC_EVENTS.includes('inbox:changed') && RESYNC_EVENTS.includes('board:changed'));
  assert.match(bridge, /res\.status === 410/);
  assert.match(bridge, /connect\(failures \+ 1\)/);
});
