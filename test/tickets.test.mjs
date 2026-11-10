// F2.6c (P4/P6/P8/P12): the tickets of agent-auth.mjs. A ticket is traded once (then only with the reconnect secret the
// server keeps in memory); Cursor's per-turn tickets may be traded again until taken back; a busy engine is «try
// again», not «not signed»; connections that never say hello are closed; a session id is matched as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AgentAuth } from '../src/domain/security/agent-auth.mjs';
import { redeem } from '../src/mcp/auth-client.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// One raw hello on the pipe → the engine's answer (or null if it closed without one).
const hello = (pipe, msg) => new Promise((resolve) => {
  const s = net.connect(pipe); let buf = '';
  s.setEncoding('utf8');
  s.on('connect', () => s.write(`${JSON.stringify(msg)}\n`));
  s.on('data', (c) => { buf += c; if (buf.includes('\n')) { resolve(JSON.parse(buf.split('\n')[0])); s.destroy(); } });
  s.on('error', () => resolve(null)); s.on('close', () => resolve(null));
});

test('tickets: se canjean una vez; después, solo con el secreto de reconexión', async () => {
  const auth = new AgentAuth();
  const ticket = auth.issue({ session: 'sesion-1', reply: { who: 'claude' } });
  const one = await redeem(auth.address, ticket, { reconnect: false }); // as the launcher would: no reconnecting
  assert.deepEqual(one.reply, { who: 'claude' }, 'el secreto no se mezcla con la concesión');
  assert.equal(await one.check(), true);
  await wait(100); // its ack reaches the engine
  // The server dies: whoever copied the ticket from the agent's environment gets nothing.
  const [secret] = [...auth.grants.values()].map((g) => g.secret);
  auth.grants.get(ticket).holder.destroy();
  await wait(100);
  assert.deepEqual(await hello(auth.address, { hello: ticket }), { ok: false }, 'un ticket ya canjeado no vale suelto');
  assert.equal((await hello(auth.address, { hello: ticket, secret }))?.ok, true, 'con el secreto, sí');
  // Taken back: nothing at all.
  auth.revokeSession('sesion-1');
  assert.deepEqual(await hello(auth.address, { hello: ticket, secret }), { ok: false });
  auth.server.close();
});

test('tickets: una conexión que se cae se recupera sola con el secreto; revocar la cierra', async () => {
  const auth = new AgentAuth();
  const ticket = auth.issue({ session: 7, reply: {} });
  const one = await redeem(auth.address, ticket);
  let closed = false; one.onClose(() => { closed = true; });
  await wait(100);
  auth.grants.get(ticket).holder.destroy(); // the pipe drops, the grant holds
  await wait(400);
  assert.equal(await one.check(), true, 'sigue firmado tras reconectar');
  assert.equal(closed, false);
  auth.revokeSession(7); // P12: a number matches its text
  await wait(400);
  assert.equal(closed, true, 'al revocarse, se entera');
  assert.equal(await one.check(), false);
  auth.server.close();
});

test('tickets de Cursor (reutilizables): se canjean de nuevo en el mismo turno hasta que se revocan', async () => {
  const auth = new AgentAuth();
  const ticket = auth.issue({ session: 'cursor-1', reply: {}, reusable: true });
  const one = await redeem(auth.address, ticket, { reconnect: false });
  await wait(100);
  auth.grants.get(ticket).holder.destroy();
  await wait(400);
  const two = await redeem(auth.address, ticket, { reconnect: false });
  assert.ok(two, 'el servidor que Cursor abre otra vez canjea su ticket');
  auth.revoke(ticket);
  assert.equal(await redeem(auth.address, ticket, { attempts: 1 }), null);
  void one;
  auth.server.close();
});

test('motor ocupado: un hello lento se repite y un check sin respuesta es «ocupado» (null), no «sin firma»', async () => {
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\orb-prueba-${crypto.randomBytes(6).toString('hex')}` : path.join(os.tmpdir(), `orb-prueba-${process.pid}.sock`);
  let hellos = 0; const open = [];
  const server = net.createServer((s) => {
    open.push(s);
    s.setEncoding('utf8');
    s.on('error', () => {});
    s.on('data', (c) => {
      for (const line of c.split('\n').filter(Boolean)) {
        const m = JSON.parse(line);
        if (m.hello && ++hellos > 1) s.write(`${JSON.stringify({ ok: true, who: 'x', secret: 'abc' })}\n`); // the first hello gets no answer
      }
    });
  });
  await new Promise((r) => server.listen(pipe, r));
  try {
    const one = await redeem(pipe, 'a'.repeat(64), { helloMs: 300, checkMs: 300 });
    assert.ok(one, 'canjeado al segundo intento'); assert.equal(hellos, 2);
    assert.equal(await one.check(), null, 'sin respuesta a tiempo: ocupado');
  } finally { for (const s of open) s.destroy(); server.close(); }
});

test('tickets: las conexiones que no saludan se cierran', async () => {
  const auth = new AgentAuth(); auth.helloWithin = 200;
  auth.listen();
  const closed = await new Promise((resolve) => {
    const s = net.connect(auth.address);
    s.on('error', () => {}); s.on('close', () => resolve(true));
    setTimeout(() => resolve(false), 3000);
  });
  assert.equal(closed, true);
  auth.server.close();
});
