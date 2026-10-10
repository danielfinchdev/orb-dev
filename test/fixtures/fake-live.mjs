// Fake agents for the tests (2.3): ORB_FAKE_AGENTS=<this file> replaces every adapter of src/agents/index.mjs with one
// that lives inside the engine's process. No program is launched (on Windows a .mjs cannot be started as a program), no
// account is needed. Each turn answers according to keywords in the message, the same ones the old fake CLIs used:
//
//   ESCRIBE            writes hecho-por-<agente>.txt in its folder
//   CREA_TAREA <p>     creates a task in project <p> through Orb's real MCP server (orb_create_task)
//   NAVEGA <url>       uses the agents' browser through the MCP (orb_browser_*) and writes navegador.txt
//   PROGRESO           reports progress 40 % (orb_update_task) and works 2.5 s more
//   TERMINA <id>       closes task <id> as done (orb_update_task)
//   DELEGA <n> [agente] [ESPERA]   delegates n read-only subtasks (orb_delegate) and, with ESPERA, waits for them (orb_wait_tasks)
//   PIDE_PERMISO       wants to run "git push origin main": the real guard decides (allow, ask with a card, deny)
//   LIMITE [ms]        the account hits its usage limit (rate + limit events; resets in ms, 1 h by default)
//   LIMITE_TEXTO       an agent that only says "usage limit" in its answer (no limit event)
//   RATE <pct>         reports the real usage of its account (pct % of the window)
//   PLAN_GRATIS        Claude fails like a free plan that cannot be used from other apps
//   FALLA              the process dies with an error
//   REVIENTA           send() itself rejects (an adapter bug)
//   LENTO              takes 1.5 s (to queue or steer while it works)
//   ESPERA_CORRECCION  waits (up to 10 s) for a steer and answers with it
//   DUERME             works for 30 s (until it is stopped)
//   PARA_LENTO         once stopped, the turn takes 0.8 s to end (as the real Claude does)
//   Task Review        a review prompt: answers "VEREDICTO: CORRECTO" (or "CON FALLOS" when the reviewed work says FALLOS)
//
// Every turn also emits streamed text (delta), a tool call (Bash ls) and the context meter, and logs what it received to
// the conversation's registro.jsonl (o.log) and, if set, to ORB_FAKE_LOG.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { Turn, Approvals } from '../../src/agents/live.mjs';
import { decide } from '../../src/core/guard.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One call to a tool of the "orb" MCP server, started exactly as the real agents start it (command, args, env).
async function mcpCall(server, name, args, whole = false) {
  if (!server) throw new Error('sin servidor MCP de Orb');
  const child = spawn(server.command, server.args ?? [], { env: { ...process.env, ...(server.env ?? {}) }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const replies = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; } replies.get(m.id)?.(m); });
  const rpc = (id, method, params) => new Promise((r) => { replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  try {
    await rpc(1, 'initialize', { protocolVersion: '2025-06-18' });
    const out = await rpc(2, 'tools/call', { name, arguments: args });
    if (whole) return out.result;
    return out.result?.content?.[0]?.text ?? JSON.stringify(out);
  } finally { child.stdin.end(); }
}

export function fakeAdapter(id, real) {
  const caps = { ...(real?.caps ?? { images: false, steer: false, fork: false, approvals: true, models: true, context: true }) };
  return {
    id, label: real?.label ?? id, kind: 'fake', caps, install: null, spec: real?.spec,
    // The "program" is Node itself, so «Agentes» can ask its version.
    detect: () => ({ cmd: process.execPath, pre: [] }),
    loginState: () => 'si',
    loginCommand: (exe) => ({ cmd: exe.cmd, args: ['--version'] }),
    createLive: (o) => createFakeLive(id, real?.label ?? id, caps, o),
    // 2.6: the models it offers. Fixed test models (clearly marked as such) unless ORB_FAKE_REAL_MODELS=1: then the real
    // agent of this PC is asked (a demo with fake agents shows the real names), if it is installed.
    discoverModels: async (exe, cfg = {}, env = {}) => {
      if (process.env.ORB_FAKE_REAL_MODELS === '1') {
        const realExe = real?.discoverModels ? real.detect(cfg) : null;
        return realExe ? real.discoverModels(realExe, cfg, env) : null;
      }
      if (process.env.ORB_FAKE_MODELS_LOG) { try { fs.appendFileSync(process.env.ORB_FAKE_MODELS_LOG, `${id}\n`); } catch { /* log unavailable */ } }
      return [1, 2, 3].map((n) => ({ id: `fake-${id}-${n}`, label: `Modelo de prueba ${n}`, ...(n === 1 ? { default: true } : {}) }));
    }
  };
}

function createFakeLive(agent, label, caps, o) {
  const onEvent = o.onEvent ?? (() => {});
  const approvals = new Approvals(onEvent);
  let permission = o.permission ?? 'editar';
  let model = o.model ?? null;
  let turn = null; let closed = false; let turns = 0; let steers = []; let wake = null; let seq = 0; let slowStop = false;
  // A fork or a new conversation gets its own id; a resumed one keeps the agent's id.
  const sessionId = o.forkSession ? `fork-${crypto.randomUUID()}` : o.resumeId || o.newSessionId || `${agent}-${crypto.randomUUID()}`;
  const live = { sessionId, caps: { ...caps, interrupt: true }, pid: process.pid, get busy() { return Boolean(turn && !turn.done); } };
  const record = (what) => {
    const line = JSON.stringify({ fake: agent, at: new Date().toISOString(), sessionId, resumeId: o.resumeId ?? null, forkSession: Boolean(o.forkSession), newSessionId: o.newSessionId ?? null,
      model, permission, cwd: o.cwd, codexHome: o.env?.CODEX_HOME ?? null, claudeDir: o.env?.CLAUDE_CONFIG_DIR ?? null, orbTask: o.env?.ORB_TASK_ID ?? null, budgetUsd: o.budgetUsd ?? null, ...what });
    try { o.log?.(line); } catch { /* log unavailable */ }
    if (process.env.ORB_FAKE_LOG) { try { fs.appendFileSync(process.env.ORB_FAKE_LOG, `${line}\n`); } catch { /* log unavailable */ } }
  };
  const sleep = (ms, { untilSteer = false } = {}) => new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); wake = null; resolve(); }
    wake = { done, untilSteer };
  });
  const item = (role, kind, body) => onEvent({ type: 'item', role, kind, body });
  const orb = o.mcpServers?.orb;

  async function work(text, current) {
    // Only the message itself counts: the project's notes and earlier results quoted in the prompt are data.
    const scan = text.replace(/## Últimas notas del proyecto[\s\S]*?(?=\n## |$)/, '').replace(/## Hecho antes[\s\S]*?(?=\n## |$)/, '');
    const first = text.split('\n')[0].slice(0, 80);
    const continued = turns > 1 || Boolean(o.resumeId);
    if (o.resumeId && String(o.resumeId).startsWith('roto-')) return current.finish({ isError: true, final: `No conversation found with session ID: ${o.resumeId}` });
    if (/Eres el revisor \(Task Review\)/.test(text)) {
      // Only the reviewed work counts (the reviewer's own instructions mention «CON FALLOS» too).
      const work = (text.match(/Encargo original:([\s\S]*?)\n(?:Comprueba|Audita)/) ?? [])[1] ?? '';
      const verdict = /FALLOS/.test(work) ? 'CON FALLOS\n- a.txt: falta un caso' : 'CORRECTO';
      current.addText(`VEREDICTO: ${verdict}\nRevisado por ${label}.`); item('assistant', 'text', `VEREDICTO: ${verdict}`);
      return current.finish({});
    }
    if (/FALLA/.test(scan)) { onEvent({ type: 'exit', code: 2, stderr: 'algo salió mal' }); return current.finish({ isError: true, final: `${label} se cerró (código 2). algo salió mal` }); }
    // Only Claude's account is on the free plan here: the task must end up done by another agent.
    if (/PLAN_GRATIS/.test(scan) && agent === 'claude') { const msg = 'Free plan users cannot run the agent from the CLI. Upgrade to Pro to continue.'; item('error', 'text', msg); return current.finish({ isError: true, final: msg }); }
    item('tool', 'tool', { id: `t${++seq}`, name: 'Bash', input: 'ls' });
    item('tool', 'tool_result', { id: `t${seq}`, output: 'a.txt', error: false });
    if (agent === 'codex') item('tool', 'file', { path: 'a.txt', change: 'update' });
    if (/ESCRIBE/.test(scan) && !/Task Review/.test(scan)) fs.writeFileSync(path.join(o.cwd, `hecho-por-${agent}.txt`), 'hola\n');
    const notes = [];
    const proj = scan.match(/CREA_TAREA (\S+)/);
    if (proj) {
      const out = await mcpCall(orb, 'orb_create_task', { project: proj[1], title: 'Tarea del asistente', description: 'ESCRIBE un archivo de prueba', agent: 'claude' });
      item('tool', 'tool', { id: `t${++seq}`, name: 'orb:orb_create_task', input: proj[1] });
      item('tool', 'tool_result', { id: `t${seq}`, output: out.slice(0, 300), error: false });
    }
    const nav = scan.match(/NAVEGA (\S+)/);
    if (nav) {
      const log = [];
      const firstPage = await mcpCall(orb, 'orb_browser_open', { url: nav[1] }); log.push(firstPage);
      const refOf = (t, re) => Number(t.split('\n').find((l) => re.test(l))?.match(/^\[(\d+)\]/)?.[1]);
      log.push(await mcpCall(orb, 'orb_browser_type', { ref: refOf(firstPage, /input:text/), text: 'Hola, navegador' }));
      log.push(await mcpCall(orb, 'orb_browser_click', { ref: refOf(firstPage, /input:file/) }));
      log.push(await mcpCall(orb, 'orb_browser_click', { ref: refOf(firstPage, /button "Enviar"/) }));
      const shot = await mcpCall(orb, 'orb_browser_screenshot', {}, true);
      log.push(`captura: ${shot?.content?.find((c) => c.type === 'image')?.data?.length ?? 0}`);
      log.push(await mcpCall(orb, 'orb_browser_press', { key: 'F5' }));
      fs.writeFileSync(path.join(o.cwd, 'navegador.txt'), log.join('\n----\n'));
      item('tool', 'tool', { id: `t${++seq}`, name: 'orb:orb_browser_open', input: nav[1] });
    }
    const progress = /PROGRESO/.test(scan) && text.match(/Tarea #(\d+)/);
    if (progress) { await mcpCall(orb, 'orb_update_task', { id: Number(progress[1]), progress: 40, note: 'probando el formulario' }); await sleep(2500); }
    const delegate = scan.match(/DELEGA (\d+)(?: (claude|codex|cursor|gemini|opencode|qwen|copilot|any))?/);
    if (delegate) {
      const ids = [];
      for (let i = 1; i <= Number(delegate[1]); i++) {
        const out = await mcpCall(orb, 'orb_delegate', { title: `Subtarea ${i}`, description: `Revisa la parte ${i} y resume lo que veas`, agent: delegate[2] ?? 'any', readonly: true });
        try { const r = JSON.parse(out); ids.push(r.id); notes.push(`subtarea #${r.id}: ${r.status}`); } catch { notes.push(`delegar: ${out}`); }
      }
      if (/ESPERA\b/.test(scan.slice(scan.indexOf('DELEGA'))) && ids.length) {
        const out = await mcpCall(orb, 'orb_wait_tasks', { ids, timeout_s: 60 });
        try { for (const r of JSON.parse(out)) notes.push(`resultado #${r.id}: ${r.status}`); } catch { notes.push(`esperar: ${out}`); }
      }
    }
    const done = scan.match(/TERMINA (\d+)/);
    if (done) await mcpCall(orb, 'orb_update_task', { id: Number(done[1]), status: 'done', result: 'hecho por el agente falso' });
    if (/PIDE_PERMISO/.test(scan)) {
      const command = 'git push origin main';
      const verdict = decide({ permission, tool: 'Bash', command, internalDir: o.internalDir });
      let decision = verdict.decision;
      if (decision === 'ask') decision = await approvals.ask({ id: `permiso-${++seq}`, tool: 'Bash', title: command, reason: verdict.reason, input: command });
      notes.push(decision === 'deny' ? (verdict.decision === 'deny' ? 'denegado por el guardia' : 'permiso denegado') : `permiso concedido (${verdict.decision === 'allow' ? 'sin preguntar' : decision})`);
      if (current.done) return; // stopped or closed while it waited
    }
    const rate = scan.match(/RATE (\d+)/);
    if (rate) onEvent({ type: 'rate', status: 'allowed', resetAt: Date.now() + 3_600_000, utilization: Number(rate[1]) / 100, window: '5h' });
    const limit = scan.match(/LIMITE(?:_TEXTO)?(?: (\d+))?/);
    if (limit) {
      const msg = "You've hit your usage limit · resets 5pm";
      item('error', 'text', msg);
      if (/LIMITE_TEXTO/.test(scan)) return current.finish({ isError: true, final: msg });
      const resetAt = Date.now() + (limit[1] ? Number(limit[1]) : 3_600_000);
      onEvent({ type: 'rate', status: 'rejected', resetAt, utilization: 1, window: '5h' });
      onEvent({ type: 'limit', resetAt, message: `límite de uso de ${label} alcanzado` });
      return current.finish({ isError: true, final: msg, limit: { resetAt } });
    }
    if (/LENTO/.test(scan)) await sleep(1500);
    if (/ESPERA_CORRECCION/.test(scan) && !steers.length) await sleep(10_000, { untilSteer: true });
    if (/DUERME/.test(scan)) await sleep(30_000);
    if (current.done) return;
    const reply = [`${agent === 'codex' ? `Codex ${continued ? 'sigue' : 'empieza'}` : 'Recibido'}: ${first}`, ...steers.map((s) => `corrección: ${s}`), ...notes].join(' | ');
    for (const piece of reply.match(/.{1,20}/gs) ?? []) onEvent({ type: 'delta', text: piece });
    item('assistant', 'text', reply);
    current.addText(reply);
    onEvent({ type: 'context', used: 1000 * turns, size: 200_000 });
    current.finish({ usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn' });
  }

  live.send = async ({ text }) => {
    if (closed) throw new Error(`la sesión de ${label} se ha cerrado`);
    if (turn && !turn.done) throw new Error('el agente sigue trabajando');
    turn = new Turn(); const current = turn; turns++; steers = []; slowStop = /PARA_LENTO/.test(text);
    record({ turn: turns, text });
    if (/REVIENTA/.test(text)) { turn = null; throw new Error('el adaptador falso revienta'); }
    if (turns === 1) { onEvent({ type: 'session', id: sessionId }); item('system', 'status', `${label} (falso)${model ? ` · ${model}` : ''}`); }
    work(text, current).catch((error) => { if (!current.done) { item('error', 'text', error.message); current.finish({ isError: true, final: `${label}: ${error.message}` }); } });
    return current.promise;
  };
  live.steer = ({ text }) => {
    if (!caps.steer || closed || !turn || turn.done) return false;
    steers.push(text); record({ steer: text });
    if (wake?.untilSteer) wake.done();
    return true;
  };
  live.interrupt = async () => {
    approvals.clear();
    if (!turn || turn.done) return;
    const current = turn;
    const end = () => { wake?.done(); current.finish({ stopReason: 'interrupted', final: current.text || 'Detenido.' }); };
    // PARA_LENTO: like the real Claude, the turn ends a moment after the interrupt, not at once.
    if (slowStop) setTimeout(end, 800); else end();
  };
  live.respond = (requestId, decision) => approvals.respond(requestId, decision);
  live.setModel = (m) => { model = m || null; record({ setModel: model }); };
  live.setPermission = (p) => { permission = p; record({ setPermission: p }); };
  live.close = () => {
    if (closed) return; closed = true;
    approvals.clear(); wake?.done();
    if (turn && !turn.done) turn.finish({ isError: true, final: turn.text || `${label} se cerró.` });
    onEvent({ type: 'exit', code: 0, stderr: '' });
  };
  live.isClosed = () => closed;
  return live;
}
