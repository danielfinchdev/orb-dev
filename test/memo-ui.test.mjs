// 3.8.1 (H4a): the pure logic behind the interface's speed-ups: the memo keys (a key that is too coarse means «it does
// not update»), the batching of the conversations' states, the screens that load later and recover from a failed load,
// and the clock that moves memoised dates on at midnight or with a new time zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepSame, sameBlock, sameItem, sameJson, keepIfSame } from '../src/ui/lib/memo.js';
import { frameBatch } from '../src/ui/lib/batch.js';
import { isLoadError, failedUrl, loadAgain, lazyScreen, retryLoads } from '../src/ui/lib/lazy.js';
import { checkClock, onClock, clockKey, timeZone } from '../src/ui/lib/clock.js';

const line = (id, body, meta = null) => ({ id, body, at: `2026-11-08T10:0${id}:00Z`, role: 'orb', meta });

test('keepSame: misma lista → la misma referencia; lo que cambia se renueva y lo demás se conserva', () => {
  const prev = [line(1, 'a'), line(2, 'b', { kind: 'report', tasks: [3] })];
  const again = prev.map((m) => ({ ...m, meta: m.meta ? { ...m.meta, tasks: [...m.meta.tasks] } : null }));
  assert.equal(keepSame(prev, again), prev, 'nada cambió: la lista de antes');
  assert.equal(keepSame([], again), again, 'sin lista previa: la nueva');

  const body = keepSame(prev, [again[0], { ...again[1], body: 'b2' }]);
  assert.notEqual(body, prev);
  assert.equal(body[0], prev[0], 'la línea igual se conserva');
  assert.equal(body[1].body, 'b2', 'la que cambió de texto es la nueva');

  const accepted = keepSame(prev, [again[0], { ...again[1], meta: { ...again[1].meta, accepted: true } }]);
  assert.equal(accepted[0], prev[0]);
  assert.equal(accepted[1].meta.accepted, true, 'un cambio en meta (informe aceptado) redibuja');

  const status = keepSame([line(1, 'q', { kind: 'question', status: 'pending' })], [line(1, 'q', { kind: 'question', status: 'answered' })]);
  assert.equal(status[0].meta.status, 'answered', 'cambio de meta.status');

  const at = keepSame(prev, [{ ...again[0], at: 'otra' }, again[1]]);
  assert.equal(at[0].at, 'otra'); assert.equal(at[1], prev[1]);
  const role = keepSame(prev, [{ ...again[0], role: 'usuario' }, again[1]]);
  assert.equal(role[0].role, 'usuario');

  const removed = keepSame(prev, [again[1]]);
  assert.notEqual(removed, prev, 'una línea borrada: lista nueva');
  assert.deepEqual(removed, [prev[1]]); assert.equal(removed[0], prev[1]);

  const reordered = keepSame(prev, [again[1], again[0]]);
  assert.notEqual(reordered, prev, 'reordenada: lista nueva');
  assert.equal(reordered[0], prev[1]); assert.equal(reordered[1], prev[0]);

  const added = keepSame(prev, [...again, line(3, 'c')]);
  assert.equal(added.length, 3); assert.equal(added[0], prev[0]); assert.equal(added[1], prev[1]);
});

test('sameBlock: el resultado de una herramienta que llega y un archivo añadido redibujan', () => {
  const call = { id: 't1', name: 'Bash', input: 'ls' };
  const tool = { type: 'tool', key: 5, call, result: null };
  assert.equal(sameBlock(tool, { ...tool }), true, 'el mismo bloque rehecho');
  assert.equal(sameBlock(tool, { ...tool, result: { id: 't1', output: 'x' } }), false, 'llega el resultado');
  assert.equal(sameBlock(tool, { ...tool, call: { ...call } }), false, 'otra llamada (otro objeto)');
  const f1 = { path: 'a.js', change: 'edit' }; const f2 = { path: 'b.js', change: 'add' };
  const files = { type: 'files', key: 7, files: [f1] };
  assert.equal(sameBlock(files, { type: 'files', key: 7, files: [f1] }), true, 'los mismos archivos en otra lista');
  assert.equal(sameBlock(files, { type: 'files', key: 7, files: [f1, f2] }), false, 'un archivo añadido');
  const item = { id: 9, kind: 'text', body: 'hola' };
  assert.equal(sameBlock({ type: 'item', key: 9, item }, { type: 'item', key: 9, item }), true);
  assert.equal(sameBlock({ type: 'item', key: 9, item }, { type: 'item', key: 9, item: { ...item, body: 'hola!' } }), false, 'el elemento cambió (llegó de nuevo por session:item)');
  assert.equal(sameBlock({ type: 'item', key: 9, item }, { type: 'item', key: 10, item }), false);
});

test('sameItem / sameJson / keepIfSame: filas de la lista y catálogo', () => {
  const row = { key: 'conversation:1', title: 'A', unread: 0, tasks: [{ id: 1, status: 'running' }], lastMessage: { body: 'x', at: '1' } };
  assert.equal(sameItem(row, { ...row, tasks: [{ id: 1, status: 'running' }], lastMessage: { body: 'x', at: '1' } }), true, 'mismo contenido en objetos nuevos');
  assert.equal(sameItem(row, { ...row, unread: 1 }), false);
  assert.equal(sameItem(row, { ...row, tasks: [{ id: 1, status: 'done' }] }), false, 'una tarea cambió de estado');
  assert.equal(sameItem(row, { ...row, lastMessage: { body: 'y', at: '2' } }), false, 'última línea nueva');
  assert.equal(sameItem(row, { ...row, extra: 1 }), false, 'un campo de más');
  assert.equal(sameJson(null, null), true); assert.equal(sameJson(null, {}), false); assert.equal(sameJson(NaN, NaN), true);
  const cat = [{ id: 'claude', models: [{ id: 'opus' }] }];
  assert.equal(keepIfSame(cat, JSON.parse(JSON.stringify(cat))), cat, 'el mismo catálogo sigue siendo el mismo objeto');
  const next = [{ id: 'claude', models: [{ id: 'opus' }, { id: 'sonnet' }] }];
  assert.equal(keepIfSame(cat, next), next);
  assert.equal(keepIfSame(null, cat), cat);
});

// A fake clock for the batch: frames and timers run when the test says.
function fakeTime() {
  const frames = new Map(); const timers = new Map(); let n = 0;
  return {
    frame: (fn) => { frames.set(++n, fn); return n; }, cancelFrame: (id) => frames.delete(id),
    later: (fn, ms) => { timers.set(++n, { fn, ms }); return n; }, cancelLater: (id) => timers.delete(id),
    runFrames: () => { const f = [...frames.values()]; frames.clear(); f.forEach((fn) => fn(0)); },
    runTimers: () => { const t = [...timers.values()]; timers.clear(); t.forEach((x) => x.fn()); },
    frames, timers
  };
}

test('frameBatch: el último estado de cada clave, en el siguiente fotograma, sin esperar a un fotograma que no llega', () => {
  const time = fakeTime(); const got = [];
  let hidden = false;
  const b = frameBatch((m) => got.push([...m.entries()]), { ...time, hidden: () => hidden });
  b.add(1, 'a'); b.add(2, 'b'); b.add(1, 'a2');
  assert.equal(b.pending, 2); assert.equal(time.frames.size, 1); assert.equal(time.timers.size, 1);
  time.runFrames();
  assert.deepEqual(got, [[[1, 'a2'], [2, 'b']]], 'una sola entrega con lo último de cada conversación');
  assert.equal(time.timers.size, 0, 'el fotograma cancela el plazo');

  // queued while visible, then the window hides before the frame: the timeout hands it over
  b.add(3, 'c'); hidden = true; b.add(3, 'c2');
  time.runTimers();
  assert.deepEqual(got.at(-1), [[3, 'c2']]);
  assert.equal(time.frames.size, 0, 'el plazo cancela el fotograma');

  // hidden from the start: no frame asked, only the timeout
  b.add(4, 'd');
  assert.equal(time.frames.size, 0); assert.equal(time.timers.size, 1); assert.equal(time.timers.values().next().value.ms, 100);
  b.flush(); // visibilitychange
  assert.deepEqual(got.at(-1), [[4, 'd']]);
  assert.equal(time.timers.size, 0);
  b.flush(); assert.equal(got.length, 3, 'nada pendiente: nada que entregar');
  time.runFrames(); time.runTimers(); assert.equal(got.length, 3, 'nunca dos veces');
});

test('pantallas perezosas: un fallo de carga se reconoce, se reintenta sin bucles y la siguiente vez se pide de nuevo', async () => {
  const chrome = new TypeError('Failed to fetch dynamically imported module: http://192.168.1.5:7000/assets/tasks-AbC1.js');
  assert.equal(isLoadError(chrome), true);
  assert.equal(isLoadError(new TypeError('error loading dynamically imported module: tauri://localhost/assets/x.js')), true);
  assert.equal(isLoadError(new TypeError('Importing a module script failed.')), true);
  assert.equal(isLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' })), true);
  assert.equal(isLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")), false, 'un fallo al dibujar no es «sin conexión»');
  assert.equal(failedUrl(chrome), 'http://192.168.1.5:7000/assets/tasks-AbC1.js');
  assert.equal(failedUrl(new Error('Failed to fetch dynamically imported module: file:///C:/Orb/resources/app.asar/src/renderer/assets/a-1.js?x=1')), 'file:///C:/Orb/resources/app.asar/src/renderer/assets/a-1.js');
  assert.equal(failedUrl(new Error('nada')), null);

  // loadAgain: the import again; if it fails the same way, the same file with a query (a new request)
  const asked = [];
  assert.deepEqual(await loadAgain(async () => ({ ok: 1 }), 1, (u) => asked.push(u)), { ok: 1 });
  assert.deepEqual(await loadAgain(async () => { throw chrome; }, 2, async (u) => { asked.push(u); return { again: true }; }), { again: true });
  assert.deepEqual(asked, ['http://192.168.1.5:7000/assets/tasks-AbC1.js?retry=2']);
  await assert.rejects(loadAgain(async () => { throw new Error('roto'); }, 1, async () => ({})), /roto/, 'otro error no se disfraza');

  // lazyScreen: a failed load stays failed (no new fetch from the failed render) until retryLoads()
  let loads = 0; let fail = true;
  const Screen = lazyScreen(async () => { loads++; if (fail) throw new TypeError('Failed to fetch dynamically imported module: http://pc/assets/v.js'); return { V: () => null }; }, 'V');
  const settle = async (type) => { try { type._init(type._payload); } catch (p) { if (p?.then) await p.then(() => {}, () => {}); } };
  const first = Screen({}).type;
  await settle(first);
  assert.equal(loads, 1);
  let caught = null; try { first._init(first._payload); } catch (e) { caught = e; }
  assert.equal(caught?.orbLoad, true, 'el error va marcado como fallo de carga');
  assert.equal(Screen({}).type, first, 'sin reintento: la misma pantalla fallida (ningún bucle de peticiones)');
  assert.equal(loads, 1);
  fail = false;
  assert.equal(retryLoads(), 1);
  const second = Screen({}).type;
  assert.notEqual(second, first, 'Reintentar hace la pantalla de nuevo');
  await settle(second);
  assert.equal(loads, 2);
  assert.equal(second._init(second._payload) !== undefined, true, 'cargada');
  assert.equal(retryLoads(), 0, 'nada pendiente');
  await Screen.preload(); assert.equal(loads, 3);
});

test('reloj: cambia la clave al cambiar el día o la zona y avisa a quien muestra fechas', () => {
  assert.equal(checkClock(), false, 'nada cambió');
  assert.match(clockKey(), /\|/); assert.equal(typeof timeZone(), 'string');
  const before = clockKey(); let told = 0;
  const off = onClock(() => told++);
  const realTZ = process.env.TZ; const zone = timeZone();
  try {
    process.env.TZ = timeZone() === 'Pacific/Kiritimati' ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati';
    assert.equal(checkClock(), true, 'otra zona horaria');
    assert.equal(told, 1);
    assert.notEqual(clockKey(), before);
    assert.equal(timeZone(), process.env.TZ);
  } finally {
    process.env.TZ = realTZ ?? zone;
    checkClock(); off();
    if (realTZ === undefined) delete process.env.TZ;
  }
  assert.equal(told, 2, 'y al volver');
  assert.equal(timeZone(), zone);
});
