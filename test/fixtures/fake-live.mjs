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
//   TABLA_MARKDOWN     answers in GFM: a table, a task list and strikethrough
//   CIERRA_Y_CUELGA    closes its task (orb_update_task done) and then never ends its turn
//   MANDA_MENSAJE <agente> <texto>   sends a message to another agent through Orb (orb_send_message)
//   CREA_PAREJA <p>    (3.8, the coordinator) creates two read-only tasks in <p>: «Escucha» (claude, ESPERA_CORRECCION)
//                      and «Avisa» (codex, AVISA_HERMANA)
//   AVISA_HERMANA <texto>   (3.8) writes to the first task its brief lists among the others of its conversation, as the
//                      brief says (to: its agent, task_id: its number)
//   LEE <ruta>         (3.6, one per line) reads a file: the real guard decides
//   ORB_FAKE_SCRIPT=<file.json>     (3.6, screenshots) [{ "when": "text", "reply": "…", "calls": [["tool", {args}]] }]: a
//                      message containing «when» gets that natural reply (and makes those Orb tool calls, silently),
//                      so the screenshots show real-looking conversations instead of the test keywords.
//   Task Review        a review prompt: answers "VEREDICTO: CORRECTO" (or "CON FALLOS" when the reviewed work says FALLOS)
//
// Every turn also emits streamed text (delta), a tool call (Bash ls) and the context meter, and logs what it received to
// the conversation's registro.jsonl (o.log) and, if set, to ORB_FAKE_LOG.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Turn, Approvals } from '../../src/agents/live.mjs';
import { decide } from '../../src/core/guard.mjs';

const SCRIPT = (() => { try { return process.env.ORB_FAKE_SCRIPT ? JSON.parse(fs.readFileSync(process.env.ORB_FAKE_SCRIPT, 'utf8')) : []; } catch { return []; } })();


// One call to a tool of the "orb" MCP server, started exactly as the real agents start it (command, args, env) and, as
// they do, once per agent process: its ticket is traded once (F2.6c), so the same server answers every call.
const PROCS = new WeakMap();
function mcpProc(server) {
  let p = PROCS.get(server);
  if (p && !p.dead) return p;
  const child = spawn(server.command, server.args ?? [], { env: { ...process.env, ...(server.env ?? {}) }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const replies = new Map(); let seq = 0;
  p = { child, dead: false, rpc: (method, params) => new Promise((r) => { const id = ++seq; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); }) };
  child.on('exit', () => { p.dead = true; for (const r of replies.values()) r({ error: { message: 'el servidor MCP se cerró' } }); });
  readline.createInterface({ input: child.stdout }).on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; } const r = replies.get(m.id); replies.delete(m.id); r?.(m); });
  p.ready = p.rpc('initialize', { protocolVersion: '2025-06-18' });
  PROCS.set(server, p);
  return p;
}
const closeMcp = (server) => { const p = server && PROCS.get(server); if (p) { p.dead = true; try { p.child.stdin.end(); } catch { /* gone */ } } };
async function mcpCall(server, name, args, whole = false) {
  if (!server) throw new Error('sin servidor MCP de Orb');
  const p = mcpProc(server);
  await p.ready;
  const out = await p.rpc('tools/call', { name, arguments: args });
  if (whole) return out.result;
  return out.result?.content?.[0]?.text ?? JSON.stringify(out);
}

export function fakeAdapter(id, real) {
  const caps = { ...(real?.caps ?? { images: false, steer: false, fork: false, approvals: true, models: true, context: true }) };
  return {
    id, label: real?.label ?? id, kind: 'fake', caps, install: null, spec: real?.spec,
    // The "program" is Node itself, so «Agentes» can ask its version.
    detect: () => ({ cmd: process.execPath, pre: [] }),
    loginState: () => 'si',
    loginCommand: (exe) => ({ cmd: exe.cmd, args: ['--version'] }),
    // 3.5: the windowless sign-in of Claude and Codex runs test/fixtures/fake-login.mjs (link, code and outcome).
    windowlessLogin: real?.windowlessLogin, loginExe: () => ({ cmd: process.execPath, pre: [fileURLToPath(new URL('./fake-login.mjs', import.meta.url))] }),
    createLive: (o) => createFakeLive(id, real?.label ?? id, caps, o),
    // 2.6: the models it offers. Fixed test models (clearly marked as such) unless ORB_FAKE_REAL_MODELS=1: then the real
    // agent of this PC is asked (a demo with fake agents shows the real names), if it is installed.
    discoverModels: async (exe, cfg = {}, env = {}) => {
      if (process.env.ORB_FAKE_REAL_MODELS === '1') {
        const realExe = real?.discoverModels ? real.detect(cfg) : null;
        return realExe ? real.discoverModels(realExe, cfg, env) : null;
      }
      // 2.7: models of every kind (light, balanced, most capable), to test how Orb chooses for each task.
      if (process.env.ORB_FAKE_TIERED === '1' && id === 'claude') return [{ id: 'claude-haiku-4-5', label: 'Haiku 4.5' }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', default: true }, { id: 'claude-sonnet-5', label: 'Sonnet 5' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-opus-4-8', label: 'Opus 4.8' }, { id: 'claude-fable-5-1', label: 'Fable 5.1' }];
      if (process.env.ORB_FAKE_MODELS_LOG) { try { fs.appendFileSync(process.env.ORB_FAKE_MODELS_LOG, `${id}\n`); } catch { /* log unavailable */ } }
      // 3.6: the first model of each takes the «Extra» reasoning too (xhigh); the others the usual three.
      return [1, 2, 3].map((n) => ({ id: `fake-${id}-${n}`, label: `Modelo de prueba ${n}`, ...(n === 1 ? { default: true, efforts: ['low', 'medium', 'high', 'xhigh'] } : {}) }));
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
    const pair = scan.match(/CREA_PAREJA (\S+)/);
    if (pair) {
      for (const [title, description, who] of [['Escucha', 'ESPERA_CORRECCION', 'claude'], ['Avisa', 'AVISA_HERMANA la API está en /api/v2', 'codex']]) {
        notes.push(`creada: ${(await mcpCall(orb, 'orb_create_task', { project: pair[1], title, description, agent: who, readonly: true })).slice(0, 200)}`);
      }
    }
    // 2.7: a picture the agent made (as Codex's image_gen leaves it: a PNG file and an image item).
    if (/CREA_IMAGEN/.test(scan) && o.internalDir) {
      const dir = path.join(o.internalDir, 'imagenes'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `prueba-${Date.now()}.png`);
      fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
      item('assistant', 'image', { path: file, prompt: 'Un logotipo de prueba', transparent: false });
    }
    // 2.7: the advice to define a big request on the Pizarra (orb_pizarra).
    if (/PIDE_PIZARRA/.test(scan)) await mcpCall(orb, 'orb_pizarra', { message: 'Dibuja las tres pantallas y cómo se pasa de una a otra.' });
    // 2.7: a question with options (orb_ask): the card comes below this turn's answer.
    if (/PREGUNTA_OPCIONES/.test(scan)) {
      const out = await mcpCall(orb, 'orb_ask', { question: '¿Qué enfoque prefieres?', header: 'Enfoque', options: [{ label: 'Rápido (Recomendado)', description: 'Lo mínimo que funciona' }, { label: 'Completo', description: 'Con pruebas y documentación' }] });
      item('tool', 'tool', { id: `t${++seq}`, name: 'orb:orb_ask', input: 'Enfoque' });
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
    // 3.1: closes its own task through the MCP and then never ends its turn (a CLI that stays open after answering).
    const hang = /CIERRA_Y_CUELGA/.test(scan) && text.match(/Tarea #(\d+)/);
    if (hang) { await mcpCall(orb, 'orb_update_task', { id: Number(hang[1]), status: 'done', result: 'hecho, y el programa se queda abierto' }); await sleep(60_000); if (current.done) return; }
    // 3.1: a message to another agent through Orb (orb_send_message), as a worker would send it.
    const say = scan.match(/MANDA_MENSAJE (\w+) (.+)/);
    if (say) notes.push(`mensaje: ${await mcpCall(orb, 'orb_send_message', { to: say[1], body: say[2].trim() })}`);
    const sister = scan.match(/AVISA_HERMANA (.+)/);
    if (sister) {
      await sleep(1500); // the sibling is running by then
      const other = text.match(/## Otras tareas de este proyecto ahora mismo[^\n]*\n- #(\d+) .*?\((\w+), /);
      notes.push(`aviso: ${other ? await mcpCall(orb, 'orb_send_message', { to: other[2], task_id: Number(other[1]), body: sister[1].trim() }) : 'sin otras tareas'}`);
    }
    // 3.6: a scripted, natural answer for the screenshots (ORB_FAKE_SCRIPT); its tool calls leave no notes in the reply.
    const scripted = SCRIPT.find((x) => x.when && text.includes(x.when)) ?? null;
    for (const [tool, args] of scripted?.calls ?? []) {
      await mcpCall(orb, tool, args ?? {});
      item('tool', 'tool', { id: `t${++seq}`, name: tool, input: JSON.stringify(args ?? {}) });
    }
    // 3.6: LEE <ruta> (one per line): reading a file, as the real guard decides it.
    for (const m of scan.matchAll(/^LEE (.+)$/gm)) {
      const file = m[1].trim();
      const verdict = decide({ permission, tool: 'Read', paths: [file], internalDir: o.internalDir });
      record({ read: file, decision: verdict.decision, addDirs: o.addDirs ?? [] });
      notes.push(`LEE ${verdict.decision}`);
    }
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
    // 3.2.1: the usage limit of one model only (an API model of Cursor's plan), with the date the monthly cycle ends.
    if (/LIMITE_MODELO/.test(scan) && model) {
      const end = new Date(Date.now() + 6 * 86_400_000);
      const msg = `You've hit your usage limit. Switch to a different model or set a Spend Limit to continue with this model. Your usage limits will reset when your monthly cycle ends on ${end.getMonth() + 1}/${end.getDate()}/${end.getFullYear()}.`;
      item('error', 'text', msg);
      onEvent({ type: 'rate', status: 'rejected', model, resetAt: null, text: msg });
      return current.finish({ isError: true, final: msg, limit: { resetAt: null, model, text: msg } });
    }
    // 3.2.1: a conversation resumed after a close that ends at once without a word (as Claude did with a pending notice).
    if (process.env.ORB_FAKE_EMPTY_RESUME === '1' && o.resumeId && /Continúa donde lo dejaste/.test(text)) return current.finish({});
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
    // 3.1: an answer in GFM (a plan as a table, strikethrough, task list), as the real agents write them.
    if (/TABLA_MARKDOWN/.test(scan)) {
      const reply = 'Te propongo este plan:\n\n| # | Tarea | Agente | Depende de |\n|---|---|---|---|\n| 1 | Base: servidor localhost, escena 3D (Three.js), espacio, Sol y Tierra con rotación | codex | — |\n| 2 | Texto «Hello World» con textura de globos y letras destruibles | cursor | 1 |\n| 3 | Barra de inventario y armas: rayo láser, bombas, meteoritos | claude | 1 |\n| 4 | Revisión y pruebas con un modelo distinto | gemini | 2, 3 |\n\n- [x] Proyecto creado\n- [ ] Lanzar las tareas\n\n~~Una sola tarea~~ Cuatro tareas.';
      item('assistant', 'text', reply); current.addText(reply);
      return current.finish({ usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn' });
    }
    const reply = scripted?.reply ?? [`${agent === 'codex' ? `Codex ${continued ? 'sigue' : 'empieza'}` : 'Recibido'}: ${first}`, ...steers.map((s) => `corrección: ${s}`), ...notes].join(' | ');
    for (const piece of reply.match(/.{1,20}/gs) ?? []) onEvent({ type: 'delta', text: piece });
    item('assistant', 'text', reply);
    current.addText(reply);
    // 3.6: CONTEXTO_LLENO leaves the conversation at 80 % of its context (the «Compactar» suggestion).
    onEvent({ type: 'context', used: /CONTEXTO_LLENO/.test(scan) ? 160_000 : 1000 * turns, size: 200_000 });
    current.finish({ usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn' });
  }

  live.send = async ({ text }) => {
    if (closed) throw new Error(`la sesión de ${label} se ha cerrado`);
    if (turn && !turn.done) throw new Error('el agente sigue trabajando');
    turn = new Turn(); const current = turn; turns++; steers = []; slowStop = /PARA_LENTO/.test(text);
    record({ turn: turns, text, ...(turns === 1 && o.systemPrompt ? { systemPrompt: o.systemPrompt } : {}), ...(turns === 1 && o.tools ? { tools: o.tools } : {}), ...(turns === 1 ? { mcp: Object.keys(o.mcpServers ?? {}) } : {}) });
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
  // 3.6: the agent's own compaction (Claude's /compact, Codex's thread/compact/start): the context drops, same session.
  if (caps.compact) live.compact = async ({ instructions = '' } = {}) => {
    if (closed) throw new Error(`la sesión de ${label} se ha cerrado`);
    if (turn && !turn.done) throw new Error('el agente sigue trabajando');
    record({ compact: true, instructions });
    if (process.env.ORB_FAKE_COMPACT_FAILS === '1') return { ok: false, error: 'no se pudo compactar' };
    onEvent({ type: 'compacted', before: 160_000, after: 12_000 });
    onEvent({ type: 'context', used: 12_000, size: 200_000 });
    return { ok: true, error: null };
  };
  live.setModel = (m) => { model = m || null; record({ setModel: model }); };
  live.setPermission = (p) => { permission = p; record({ setPermission: p }); };
  live.close = () => {
    if (closed) return; closed = true;
    approvals.clear(); wake?.done();
    for (const server of Object.values(o.mcpServers ?? {})) closeMcp(server);
    if (turn && !turn.done) turn.finish({ isError: true, final: turn.text || `${label} se cerró.` });
    onEvent({ type: 'exit', code: 0, stderr: '' });
  };
  live.isClosed = () => closed;
  return live;
}
