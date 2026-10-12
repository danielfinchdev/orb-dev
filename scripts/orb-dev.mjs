#!/usr/bin/env node
// 3.1, development only: the terminal side of Orb.dev's control line (src/engine/dev-control.mjs). It reads the port and
// key from ORB_DEV_CONTROL_FILE (or %TEMP%\orb-dev-control.json), written by an Orb.dev started with ORB_DEV_CONTROL=1.
//   node scripts/orb-dev.mjs vigilar               one line per thing that happens (for a monitor): tasks, chat, permissions
//   node scripts/orb-dev.mjs estado                tasks, pending permissions and the latest chat lines
//   node scripts/orb-dev.mjs enviar "<texto>"      a message to the assistant
//   node scripts/orb-dev.mjs responder <id> <opción>  answers a question card of the chat (its option's label)
//   node scripts/orb-dev.mjs aprobar <tarea> | rechazar <tarea>     a task waiting for approval
//   node scripts/orb-dev.mjs permitir <tarea> | denegar <tarea>     the permission a running task is waiting for
//   node scripts/orb-dev.mjs llamar <método> ['<json>']             any method of the app's API
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = process.env.ORB_DEV_CONTROL_FILE || path.join(os.tmpdir(), 'orb-dev-control.json');
let info;
try {
  info = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The file in the temp folder only says where the key is (inside Orb's own data, which agents cannot read).
  if (info.keyFile) info = JSON.parse(fs.readFileSync(info.keyFile, 'utf8'));
} catch { console.error(`No hay ningún Orb.dev con control de desarrollo abierto (${file}). Arráncalo con ORB_DEV_CONTROL=1.`); process.exit(2); }
const headers = { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' };
async function call(method, params = {}) {
  const r = await fetch(`${info.url}/call`, { method: 'POST', headers, body: JSON.stringify({ method, params }) });
  const out = await r.json(); if (!out.ok) throw new Error(out.error); return out.result;
}
const snapshot = async () => { const r = await (await fetch(`${info.url}/snapshot`, { headers })).json(); if (!r.ok) throw new Error(r.error); return r.result; };
const hhmm = () => new Date().toTimeString().slice(0, 8);
const one = (s, n = 220) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const taskLine = (t) => `#${t.id} ${t.status} ${t.assigned_to ?? t.agent}${t.model ? `/${t.model}` : ''} «${one(t.title, 70)}»`;

const [cmd = 'estado', ...args] = process.argv.slice(2);
try {
  if (cmd === 'estado') {
    const s = await snapshot();
    console.log('TAREAS'); for (const t of s.tasks) console.log(`  ${taskLine(t)}${t.sensitivity?.length ? ` [${t.sensitivity.join(',')}]` : ''}`);
    console.log('EN MARCHA'); for (const l of s.live ?? []) console.log(`  #${l.id} ${l.agent} · ${Math.round((Date.now() - l.startedAt) / 60000)} min · ${l.steps} pasos · ${one(l.last, 120)}${l.waiting ? ' · ESPERA PERMISO' : ''}`);
    console.log('PERMISOS PENDIENTES'); for (const a of s.approvals) console.log(`  tarea #${a.task} · ${one(a.title, 200)} (${one(a.reason, 80)})`);
    console.log('CHAT'); for (const m of s.chat.slice(-10)) console.log(`  [${m.id}${m.conversation_id ? ` c${m.conversation_id}` : ''}] ${m.role}${m.meta?.kind ? `/${m.meta.kind}` : ''}: ${one(m.body, 300)}`);
  } else if (cmd === 'vigilar') {
    // Changes of the tasks are reported as status lines (compared with the last snapshot), the rest as they come.
    let last = new Map((await snapshot()).tasks.map((t) => [t.id, taskLine(t)]));
    const seenApprovals = new Set();
    console.log(`${hhmm()} conectado a ${info.home}`);
    const check = async () => {
      const s = await snapshot();
      for (const t of s.tasks) { const l = taskLine(t); if (last.get(t.id) !== l) console.log(`${hhmm()} TAREA ${l}`); }
      last = new Map(s.tasks.map((t) => [t.id, taskLine(t)]));
      for (const a of s.approvals) { const k = `${a.session}:${a.request}`; if (!seenApprovals.has(k)) { seenApprovals.add(k); console.log(`${hhmm()} PERMISO tarea #${a.task}: ${one(a.title, 240)} (${one(a.reason, 80)})`); } }
    };
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => check().catch((e) => console.log(`${hhmm()} ERROR ${e.message}`)), 400); };
    const res = await fetch(`${info.url}/events`, { headers });
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const event = block.match(/^event: (.+)$/m)?.[1]; const data = block.match(/^data: (.*)$/m)?.[1];
        if (!event) continue;
        let p = null; try { p = JSON.parse(data); } catch { /* none */ }
        if (event === 'chat:new') console.log(`${hhmm()} CHAT${p?.conversation ? ` c${p.conversation}` : ''} ${p?.role}${p?.meta?.kind ? `/${p.meta.kind}` : ''}: ${one(p?.body, 400)}`);
        else if (event === 'notice') console.log(`${hhmm()} AVISO ${p?.tone}: ${one(p?.body, 300)}`);
        else if (['board:changed', 'approval:changed', 'session:update'].includes(event)) soon();
      }
    }
    console.log(`${hhmm()} desconectado (Orb.dev se cerró)`);
  } else if (cmd === 'enviar') {
    // 3.2: «enviar c3 texto» writes in conversation 3; without it, a new conversation starts.
    const conv = /^c(\d+)$/.exec(args[0] ?? '');
    const r = await call('chat.send', { text: (conv ? args.slice(1) : args).join(' '), ...(conv ? { conversation: Number(conv[1]) } : {}) });
    console.log(`enviado (conversación c${r.conversation})`);
  } else if (cmd === 'responder') {
    await call('chat.answer', { id: Number(args[0]), choices: [args.slice(1).join(' ')] }); console.log('respondido');
  } else if (cmd === 'aprobar' || cmd === 'rechazar') {
    const t = await call('tasks.get', { id: Number(args[0]) }); // with the hash of what is approved, as the window does
    await call('tasks.approve', { id: t.id, decision: cmd === 'aprobar' ? 'approved' : 'rejected', hash: t.previewHash });
    console.log(`${cmd === 'aprobar' ? 'aprobada' : 'rechazada'} #${t.id} «${one(t.title, 80)}»`);
  } else if (cmd === 'permitir' || cmd === 'denegar') {
    const a = (await snapshot()).approvals.find((x) => String(x.task) === String(args[0]) || x.session === args[0]);
    if (!a) throw new Error(`la tarea ${args[0]} no espera ningún permiso`);
    await call('sessions.approve', { id: a.session, request: a.request, decision: cmd === 'permitir' ? 'allow' : 'deny' });
    console.log(`${cmd === 'permitir' ? 'permitido' : 'denegado'}: ${one(a.title, 160)}`);
  } else if (cmd === 'llamar') {
    console.log(JSON.stringify(await call(args[0], args[1] ? JSON.parse(args[1]) : {}), null, 2));
  } else { console.error(`orden desconocida: ${cmd}`); process.exit(2); }
} catch (error) { console.error(`error: ${error.message}`); process.exit(1); }
