// 3.1, development only: a control line from the developer's terminal to Orb.dev's engine, so the app can be watched and
// driven (tasks, chat, permissions, approvals) without clicking in its window. It exists only when the app runs unpacked
// AND it was started with ORB_DEV_CONTROL=1 (main.mjs never passes it to an installed Orb). Local only (127.0.0.1), and
// every request needs the random key written, with the port, to a file only this user can read (ORB_DEV_CONTROL_FILE, or
// %TEMP%\orb-dev-control.json). The client is scripts/orb-dev.mjs.
//   POST /call      { method, params } → the same API the window uses (the answer of api.call)
//   GET  /events    the engine's events as they happen (Server-Sent Events)
//   GET  /snapshot  tasks, pending approvals (with the ids to answer them) and the latest chat lines, in one go
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function startDevControl({ api, board, sessions, log = () => {}, home, internalDir }) {
  const token = crypto.randomBytes(24).toString('hex');
  // The key lives in Orb's own data folder (agents can never read it: guard.touchesInternal, Cursor's deny rules); the
  // file in the temp folder only says where it is, so an agent that reads it learns nothing it can use.
  const file = process.env.ORB_DEV_CONTROL_FILE || path.join(os.tmpdir(), 'orb-dev-control.json');
  const keyFile = path.join(internalDir, 'datos', 'control-desarrollo.json');
  const clients = new Set();
  const authorised = (req) => {
    const given = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(token);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  };
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  const snapshot = () => ({
    tasks: board.panelTasks(60).map((t) => ({ id: t.id, project: t.project, title: t.title, agent: t.agent, assigned_to: t.assigned_to, model: t.model, status: t.status, branch: t.branch, depends_on: t.depends_on, readonly: t.readonly, created_by: t.created_by, sensitivity: t.sensitivity, result: t.result ? String(t.result).slice(0, 400) : null })),
    approvals: sessions.allPendingApprovals().map((a) => ({ session: a.session?.id, task: a.session?.task_id ?? null, request: a.body?.id, title: a.body?.title, reason: a.body?.reason, at: a.at })),
    chat: board.all('SELECT id, role, body, meta, at FROM chat ORDER BY id DESC LIMIT 25').reverse().map((r) => ({ ...r, body: String(r.body).slice(0, 1500), meta: r.meta ? JSON.parse(r.meta) : null }))
  });
  const server = http.createServer(async (req, res) => {
    if (req.socket.remoteAddress && !/^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress)) return send(res, 403, { ok: false, error: 'solo local' });
    if (!authorised(req)) return send(res, 401, { ok: false, error: 'clave incorrecta' });
    try {
      if (req.method === 'GET' && req.url === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': orb-dev\n\n');
        clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      if (req.method === 'GET' && req.url === '/snapshot') return send(res, 200, { ok: true, result: { ...snapshot(), live: await api.call('tasks.live', {}).catch(() => []) } });
      if (req.method === 'POST' && req.url === '/call') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) throw new Error('petición demasiado grande'); }
        const { method, params } = JSON.parse(raw || '{}');
        log(`control de desarrollo: ${method}`);
        return send(res, 200, { ok: true, result: (await api.call(String(method), params ?? {})) ?? null });
      }
      send(res, 404, { ok: false, error: 'no existe' });
    } catch (error) { send(res, 200, { ok: false, error: error.message }); }
  });
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, JSON.stringify({ url: `http://127.0.0.1:${port}`, token, home, pid: process.pid, startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    fs.writeFileSync(file, JSON.stringify({ keyFile, home, pid: process.pid }, null, 2));
    log(`control de desarrollo en 127.0.0.1:${port} (${file})`);
  });
  const beat = setInterval(() => { for (const c of clients) c.write(': latido\n\n'); }, 15_000); beat.unref?.();
  return {
    broadcast(event, payload) {
      if (!clients.size) return;
      const line = `event: ${event}\ndata: ${JSON.stringify(payload ?? null)}\n\n`;
      for (const c of clients) { try { c.write(line); } catch { clients.delete(c); } }
    },
    stop() { clearInterval(beat); for (const c of clients) { try { c.end(); } catch { /* gone */ } } server.close(); for (const f of [file, keyFile]) { try { fs.rmSync(f, { force: true }); } catch { /* gone */ } } }
  };
}
