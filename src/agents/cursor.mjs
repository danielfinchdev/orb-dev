// Cursor adapter. Cursor's SDK needs a separate API-key login, so Orb keeps using the official Cursor CLI the user already
// signed in to ("cursor-agent -p --output-format stream-json --stream-partial-output"), wrapped in the same live interface
// as the other agents: answers stream as they are written, a turn can be stopped, and the next turn resumes the same chat
// (--resume <chat id>). Each turn is one CLI process (the CLI has no long-lived protocol), so steer becomes "queue".
// On Windows the CLI is installed as %LOCALAPPDATA%\cursor-agent\versions\<v>\ with its own node.exe and index.js.
import fs from 'node:fs';
import path from 'node:path';
import { IS_WIN, firstFile, inPath, appDataDirs, userHome, clip, describeInput, readOutput } from './common.mjs';
import { Turn, spawnAgent, killTree } from './live.mjs';
import { tr } from '../core/context.mjs';
import { isModelLimitText, parseReset, untilText } from '../core/budget.mjs';

export const id = 'cursor';
export const label = 'Cursor';
export const kind = 'cli-stream';
export const caps = { images: false, steer: false, fork: false, approvals: false, models: true, context: false };

// In this user's Local AppData or in one moved to another drive (appDataDirs).
function windowsEntry() {
  const dirs = appDataDirs().flatMap(({ local }) => { const base = path.join(local, 'cursor-agent', 'versions'); try { return fs.readdirSync(base).map((name) => path.join(base, name)); } catch { return []; } });
  const latest = dirs.filter((dir) => firstFile([path.join(dir, 'index.js')]) && firstFile([path.join(dir, 'node.exe')]))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return latest ? { cmd: path.join(latest, 'node.exe'), pre: [path.join(latest, 'index.js')] } : null;
}

export function detect(cfg = {}) {
  if (cfg.path && firstFile([cfg.path])) return { cmd: cfg.path, pre: [] };
  if (IS_WIN) {
    // The node.exe + index.js of the newest version (the most reliable way to start it); otherwise the executables some
    // installs place in the folder root.
    const entry = windowsEntry(); if (entry) return entry;
    const exe = firstFile(appDataDirs().flatMap(({ local }) => [path.join(local, 'cursor-agent', 'cursor-agent.exe'), path.join(local, 'cursor-agent', 'agent.exe')]));
    if (exe) return { cmd: exe, pre: [] };
  }
  const found = firstFile([...inPath('cursor-agent'), ...inPath('agent'), path.join(userHome(), '.local', 'bin', IS_WIN ? 'cursor-agent.exe' : 'cursor-agent')]);
  return found ? { cmd: found, pre: [] } : null;
}

// The CLI keeps its login in ~/.cursor (cli-config.json); the file is a good sign, not a proof.
export function loginState() {
  const dir = path.join(userHome(), '.cursor');
  if (firstFile([path.join(dir, 'cli-config.json')])) return 'si';
  return fs.existsSync(dir) ? 'desconocido' : 'no';
}
export const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre, 'login'] });

// 2.6: the models of the account, as `cursor-agent --list-models` prints them ("<id> - <name>", the one in use marked
// "(current)", Cursor's own choice "(default)"). Cursor offers every model in many variants (effort, thinking, fast): only
// one per model is kept, in Cursor's order — the plain one Cursor names without a variant, else the medium one — under its
// name without the variant words. "default" marks the one Cursor uses when Orb passes no --model.
const VARIANT_ID = /-(?:fast|thinking|none|minimal|low|medium|high|xhigh|extra-high|max)$/;
const VARIANT_WORDS = /\s+(?:no thinking|thinking|extra high|high|medium|low|max|none|minimal|fast)$/i;
const baseOf = (s, re) => { let prev; do { prev = s; s = s.replace(re, ''); } while (s !== prev); return s; };
// 3.2.1: the name of the model Cursor says it opened, without the effort words («Claude Opus 5 300K High No Thinking» →
// «Claude Opus 5 300K»).
export const cursorShownName = (name) => baseOf(String(name ?? '').replace(/\s+/g, ' ').trim(), VARIANT_WORDS);
export function cursorModels(text) {
  const rows = [];
  for (const raw of String(text ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/)) {
    const m = raw.replace(/[​-‍⁠﻿]/g, '').trim().match(/^([\w.:\-/[\]=,@]{1,80})\s+-\s+(.+)$/);
    if (!m) continue;
    const tags = [];
    const name = m[2].replace(/\s*\(([^()]*)\)/g, (_, tag) => { tags.push(tag.trim()); return ' '; }).replace(/\s+/g, ' ').trim();
    const flag = (word) => tags.some((t) => t.toLowerCase() === word);
    const extra = tags.filter((t) => !/^(default|current)$/i.test(t));
    rows.push({ id: m[1], name, extra, current: flag('current'), cursorDefault: flag('default'), family: baseOf(m[1], VARIANT_ID) });
  }
  const inUse = rows.find((r) => r.current) ?? rows.find((r) => r.cursorDefault);
  const families = new Map();
  for (const r of rows) { if (!families.has(r.family)) families.set(r.family, []); families.get(r.family).push(r); }
  return [...families.values()].map((group) => {
    const pick = group.find((r) => r === inUse) ?? group.find((r) => r.id === r.family) ?? group.find((r) => baseOf(r.name, VARIANT_WORDS) === r.name)
      ?? group.find((r) => /-medium$/.test(r.id)) ?? group[0];
    const label = [baseOf(pick.name, VARIANT_WORDS), ...pick.extra.map((t) => `(${t})`)].join(' ');
    return { id: pick.id, label, ...(pick === inUse ? { default: true } : {}) };
  });
}
export async function discoverModels(exe, cfg = {}, env = {}) {
  const out = await readOutput(exe.cmd, [...exe.pre, '--list-models'], { env, timeoutMs: 45000 });
  return out == null ? null : cursorModels(out);
}

// Windows refuses command lines near 32 767 characters and Cursor only takes the prompt as an argument:
// long prompts go as a pointer to a file next to the conversation's log.
export const ARGV_PROMPT_MAX = 20000;
const IDLE_AFTER_ANSWER_MS = Number(process.env.ORB_CURSOR_IDLE_MS) || 180_000;

// Cursor's tool calls arrive as { tool_call: { <name>ToolCall: { args, result } } }.
// 3.2.1: Cursor looks up an MCP tool before calling it (getMcpToolsToolCall): an inner step, not shown. A call to an MCP
// tool (mcpToolCall) shows the tool by a readable name (Orb's own tools) and what it does, never its raw arguments.
function toolOf(call) {
  const [key, value] = Object.entries(call ?? {})[0] ?? [];
  if (key === 'getMcpToolsToolCall') return { hidden: true, result: value?.result };
  if (key === 'mcpToolCall') {
    const a = value?.args ?? {};
    const server = a.serverIdentifier ?? a.providerIdentifier ?? '';
    const tool = a.toolName ?? String(a.name ?? '').replace(new RegExp(`^${server}-`), '');
    const shown = mcpToolLabel(server, tool, a.args ?? {});
    return { name: shown.name, input: shown.input || value?.description || describeInput(a.args), args: a.args, result: value?.result };
  }
  return { name: key ? String(key).replace(/ToolCall$/, '') : tr('sys.agents.tool.other'), args: value?.args, result: value?.result };
}

// Orb's tools by what they do («Progreso de la tarea · 20 % · Creando saludo.html»); another server's tools by «server: tool».
export function mcpToolLabel(server, tool, args = {}) {
  const t = String(tool ?? '');
  if (server && server !== 'orb' && !/^orb_/.test(t)) return { name: `${server}: ${t}`, input: '' };
  const parts = (...xs) => xs.filter((x) => x != null && x !== '').map((x) => clip(String(x), 200)).join(' · ');
  if (t === 'orb_update_task') return { name: tr('sys.agents.orbTool.progress'), input: parts(args.progress != null ? `${args.progress} %` : null, args.status ? tr(`sys.agents.orbTool.status.${args.status}`) : null, args.note, args.result) };
  if (t === 'orb_send_message') return { name: tr('sys.agents.orbTool.message', { to: args.to ?? '' }), input: parts(args.body) };
  if (t === 'orb_read_messages') return { name: tr('sys.agents.orbTool.readMessages'), input: '' };
  if (/^orb_browser_/.test(t)) return { name: tr('sys.agents.orbTool.browser'), input: parts(t.replace(/^orb_browser_/, ''), args.url ?? args.text ?? args.key ?? (args.ref != null ? `#${args.ref}` : null)) };
  if (t === 'orb_get_task' || t === 'orb_list_tasks' || t === 'orb_board') return { name: tr('sys.agents.orbTool.board'), input: parts(args.id != null ? `#${args.id}` : null, args.project) };
  return { name: `Orb: ${t.replace(/^orb_/, '').replace(/_/g, ' ')}`, input: '' };
}

// 3.1: Cursor cannot ask Orb before acting (its CLI has no callback), so Orb's guard reaches it as Cursor's own deny rules,
// which win even over --force. The risky commands of guard.mjs (what would ask first for the other agents) are refused
// outright here, and so are the assistant's private folders. Cursor matches a rule on the whole command, its first word
// or its start ("git push" also covers "git push -f"), case-sensitive: common spellings of PowerShell names are listed.
const RISKY_SHELL = [
  'git push', 'git remote add', 'git remote set-url', 'git remote remove', 'git reset --hard*', 'git reset --merge*', 'git clean -f*', 'git clean -df*', 'git clean -fd*',
  'git checkout -- *', 'git checkout .', 'git restore *', 'git stash drop*', 'git stash clear*', 'git branch -D*', 'git rebase*', 'git filter-branch*',
  'gh repo', 'gh pr', 'gh release', 'gh api', 'gh gist', 'gh secret', 'npm publish', 'pnpm publish', 'yarn publish', 'cargo publish', 'twine upload',
  'rm -r*', 'rm -fr*', 'rm -rf*', 'rm -Rf*', '*Remove-Item*-Recurse*', '*remove-item*-recurse*', '*Remove-Item*-r *', 'rmdir /s*', 'rd /s*', 'del /s*', 'del /q*',
  'taskkill', 'Stop-Process', 'stop-process', 'kill -9*', 'pkill', 'killall', 'shutdown', 'Restart-Computer', 'Stop-Computer', 'schtasks', 'reg add', 'reg delete',
  'Set-ExecutionPolicy', 'set-executionpolicy', 'diskpart', 'bcdedit', 'netsh', 'sc create', 'sc delete', 'sc config', 'setx', 'sudo', 'runas', 'net user', 'net localgroup',
  'New-Service', 'Set-Service', 'ssh', 'scp', 'sftp', 'rsync', 'iex', 'Invoke-Expression', 'invoke-expression', 'powershell -e*', 'powershell -E*', 'pwsh -e*', 'pwsh -E*',
  'docker rm*', 'docker rmi*', 'docker system prune*', 'docker volume rm*', 'podman rm*', 'podman rmi*'
];
// Also anywhere in the line, so a wrapper does not slip them through (cmd /c "git push", powershell -Command "…",
// bash -c '…', git -C . push). Only phrases specific enough not to catch normal commands.
const RISKY_ANYWHERE = ['git push', 'git -C * push', 'git remote add', 'git remote set-url', 'git reset --hard', 'git clean -f', 'git branch -D', 'git filter-branch',
  'gh pr ', 'gh release', 'gh repo', 'gh api', 'gh secret', 'npm publish', 'pnpm publish', 'yarn publish', 'cargo publish', 'twine upload',
  'rm -rf', 'rm -fr', 'taskkill', 'Stop-Process', 'stop-process', 'Invoke-Expression', 'invoke-expression', 'Set-ExecutionPolicy',
  'schtasks', 'Restart-Computer', 'Stop-Computer', 'reg add', 'reg delete', 'diskpart', 'bcdedit', '-EncodedCommand', '-encodedcommand'];
export function cursorRules(permission, internalDir) {
  if (permission === 'total') return [];
  const deny = [...RISKY_SHELL.map((c) => `Shell(${c})`), ...RISKY_ANYWHERE.map((c) => `Shell(*${c}*)`)];
  // «Preguntar antes»: every command would ask; Cursor cannot ask, so it runs none.
  if (permission === 'preguntar') deny.push('Shell(*)');
  // «Revisar y probar»: commands yes, changing files no.
  if (permission === 'probar') deny.push('Write(**)');
  if (internalDir) {
    for (const sub of ['datos', 'ejecuciones', path.join('copias', 'fotos')]) {
      const dir = path.join(internalDir, sub);
      for (const p of [dir, dir.replace(/\\/g, '/')]) deny.push(`Read(${p}/**)`, `Write(${p}/**)`);
    }
  }
  return [...new Set(deny)];
}

// The project file of Cursor (.cursor/mcp.json for Orb's tools, .cursor/cli.json for the rules) only lives during a turn:
// the user's own files there are kept (Orb's entries are added to them) and put back as they were when the turn ends.
// Patterns for the repository's info/exclude: in any subfolder (a project can live in a subfolder of its repository).
export const CURSOR_FILES = ['**/.cursor/mcp.json', '**/.cursor/cli.json'];
// - Secrets never go into the project: mcp.json names each value of a server's environment (Orb's signature of the agent,
//   the user's connector keys) as ${env:ORB_MCP_…}, and the values travel only in the environment of Cursor's own process
//   (the returned function's .env). Checked against the real CLI: it fills ${env:…} in, but ignores envFile and does not
//   pass its own environment on to the servers.
// - During the turn only Orb's servers are in mcp.json: servers a cloned repository declares would otherwise start
//   unasked (--approve-mcps).
// - One turn at a time per folder: a second Cursor turn in the same folder while one is running leaves the files alone
//   (it would save the first one's files as "the user's" and put them back for good).
const PREPARED = new Set();
export function prepareCursorFolder(cwd, { mcpServers = {}, deny = [] } = {}) {
  const key = path.resolve(cwd).toLowerCase();
  if (PREPARED.has(key)) return Object.assign(() => {}, { env: {} });
  PREPARED.add(key);
  const dir = path.join(cwd, '.cursor');
  const hadDir = fs.existsSync(dir);
  const saved = []; const env = {};
  const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const put = (name, merge) => {
    const file = path.join(dir, name);
    const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
    saved.push({ file, before });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merge(before ? read(file) ?? {} : {}), null, 2));
  };
  try {
    const servers = {};
    for (const [name, s] of Object.entries(mcpServers)) {
      const { env: own, ...rest } = s;
      const refs = {};
      for (const [k, v] of Object.entries(own ?? {})) {
        const ref = `ORB_MCP_${name}_${k}`.replace(/[^A-Za-z0-9_]/g, '_');
        env[ref] = String(v); refs[k] = `\${env:${ref}}`;
      }
      servers[name] = Object.keys(refs).length ? { ...rest, env: refs } : rest;
    }
    if (Object.keys(servers).length) put('mcp.json', (cur) => ({ ...cur, mcpServers: servers }));
    // Cursor validates the file strictly: permissions needs both lists, allow too (found in a real run: «Required»).
    if (deny.length) put('cli.json', (cur) => ({ ...cur, permissions: { ...(cur.permissions ?? {}), allow: Array.isArray(cur.permissions?.allow) ? cur.permissions.allow : [], deny: [...new Set([...(cur.permissions?.deny ?? []), ...deny])] } }));
  } catch (error) { PREPARED.delete(key); throw error; }
  let done = false;
  const restore = () => {
    if (done) return; done = true;
    for (const { file, before } of saved) { try { if (before) fs.writeFileSync(file, before); else fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
    if (!hadDir) { try { fs.rmdirSync(dir); } catch { /* not empty: Cursor left something of its own */ } }
    PREPARED.delete(key);
  };
  return Object.assign(restore, { env });
}

// options: exe, cwd, model, permission, resumeId, promptDir, env, log, onEvent, mcpServers, internalDir
export function createLive(o) {
  const onEvent = o.onEvent ?? (() => {});
  const log = o.log ?? (() => {});
  let model = o.model || null; let permission = o.permission ?? 'editar';
  let child = null; let turn = null; let closed = false;
  const live = { sessionId: o.resumeId ?? null, caps, pid: null, get busy() { return Boolean(turn && !turn.done); } };

  live.send = async ({ text }) => {
    if (closed) throw new Error(tr('sys.agents.sessionClosed', { name: 'Cursor' }));
    if (turn && !turn.done) throw new Error(tr('sys.agents.busy'));
    turn = new Turn(); const current = turn;
    let prompt = text;
    if (text.length > ARGV_PROMPT_MAX) {
      // In the folder Orb keeps out of git (promptDir), and gone when the turn ends: never part of the agent's work.
      const file = path.join(o.promptDir ?? o.cwd, `orb-encargo-${Date.now()}.md`);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
        prompt = `Tus instrucciones completas están en el archivo ${file}. Léelo entero y síguelo como si fuera este mensaje.`;
        current.promise.finally(() => fs.rmSync(file, { force: true }));
      } catch { /* sent as is */ }
    }
    // 3.1: Orb's tools (orb_update_task, messages, the browser) through the project's .cursor/mcp.json, approved for this
    // run (--approve-mcps), and the guard as deny rules; both only for this turn. A command left running in the background
    // (a dev server) no longer keeps the CLI waiting for ever after its answer (--background-shell-timeout).
    let restore = Object.assign(() => {}, { env: {} });
    try { restore = prepareCursorFolder(o.cwd, { mcpServers: o.mcpServers ?? {}, deny: cursorRules(permission, o.internalDir) }); }
    catch (error) { log(`preparar .cursor: ${error.message}`); }
    current.promise.finally(() => restore());
    const args = [...o.exe.pre, '-p', '--output-format', 'stream-json', '--stream-partial-output', '--trust', '--workspace', o.cwd, '--approve-mcps', '--background-shell-timeout', '60'];
    if (permission === 'leer') args.push('--mode', 'ask'); else args.push('--force');
    // 2.6: «Auto» is Cursor's own choice per request (--model auto), not the model in use in Cursor.
    if (model) args.push('--model', model);
    if (live.sessionId) args.push('--resume', live.sessionId);
    args.push(prompt);
    // The values mcp.json names as ${env:ORB_MCP_…} travel only here (never in a file of the project).
    child = spawnAgent(o.exe.cmd, args, { cwd: o.cwd, env: { ...o.env, ...restore.env }, log });
    live.pid = child.pid;
    let buffer = ''; let streamed = '';
    // 3.2.1: a usage limit in what Cursor said (its result, or its error output when the CLI exits with it). Cursor's API
    // models (Gemini, GPT, Claude… inside Cursor) have their own monthly usage: that limit is only the model's, reported as
    // such (a «rate» of that model, so only it waits), and the error is shown in the user's language.
    const usedModel = model && model !== 'auto' ? model : null;
    const limitOf = (text) => {
      if (!/usage limit|rate limit|quota/i.test(String(text ?? ''))) return null;
      const onlyModel = Boolean(usedModel && isModelLimitText(text));
      const when = untilText(parseReset(text));
      onEvent({ type: 'item', role: 'error', kind: 'text', body: onlyModel ? tr('sys.agents.cursorModelLimit', { model: modelLabel ?? usedModel, when }) : tr('sys.agents.cursorLimit', { when }) });
      if (onlyModel) onEvent({ type: 'rate', status: 'rejected', model: usedModel, resetAt: null, text: clip(text, 1000) });
      return { resetAt: null, ...(onlyModel ? { model: usedModel } : {}), text: clip(text, 1000) };
    };
    let modelLabel = null;
    // 3.1: the CLI can stay open after its last answer without ever sending "result" (it waited on a background shell or
    // its own shutdown). Once it has said something and has no tool running, a long silence is that: the turn is over.
    const open = new Set();
    let idle = null;
    const quiet = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (current.done || open.size || !(streamed.trim() || current.text)) return;
        log('sin salida tras la respuesta: el turno se da por terminado');
        if (streamed.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: streamed }); current.addText(streamed); streamed = ''; }
        current.finish({ final: current.text });
        killTree(child);
      }, IDLE_AFTER_ANSWER_MS);
      idle.unref?.();
    };
    current.promise.finally(() => clearTimeout(idle));
    const handle = (line) => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      log(line);
      quiet();
      if (ev.type === 'tool_call' && ev.call_id) { if (ev.subtype === 'started') open.add(ev.call_id); else if (ev.subtype === 'completed') open.delete(ev.call_id); }
      if (ev.session_id && ev.session_id !== live.sessionId) { live.sessionId = ev.session_id; onEvent({ type: 'session', id: ev.session_id }); }
      if (ev.type === 'system' && ev.subtype === 'init') { if (ev.model) modelLabel = String(ev.model); onEvent({ type: 'item', role: 'system', kind: 'status', body: `${label} · ${ev.model ?? ''}`.trim() }); }
      if (ev.type === 'assistant') {
        const t = (ev.message?.content ?? []).map((c) => c.text ?? '').join('');
        // With --stream-partial-output the text arrives in pieces (they carry timestamp_ms), then once complete. 3.2.1: the
        // complete one carries timestamp_ms too, with the model call's id (model_call_id): taken as a piece, every text came
        // out twice («Voy a leer…Voy a leer…»).
        const complete = !ev.timestamp_ms || Boolean(ev.model_call_id) || (streamed && t === streamed);
        if (t && !complete) { streamed += t; onEvent({ type: 'delta', text: t }); }
        else if (t.trim()) { streamed = ''; onEvent({ type: 'item', role: 'assistant', kind: 'text', body: t }); current.addText(t); }
      }
      if (ev.type === 'tool_call') {
        if (streamed.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: streamed }); current.addText(streamed); streamed = ''; }
        const tool = toolOf(ev.tool_call);
        if (tool.hidden) return;
        if (ev.subtype === 'started') onEvent({ type: 'item', role: 'tool', kind: 'tool', body: { id: ev.call_id, name: tool.name, input: tool.input ?? describeInput(tool.args) } });
        if (ev.subtype === 'completed') {
          const r = tool.result ?? {};
          onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: ev.call_id, output: clip(r.success ?? r.error ?? r, 3000), error: Boolean(r.error) } });
        }
      }
      if (ev.type === 'result') {
        if (streamed.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: streamed }); current.addText(streamed); streamed = ''; }
        const isError = Boolean(ev.is_error) || Boolean(ev.subtype && ev.subtype !== 'success');
        const final = typeof ev.result === 'string' && ev.result ? ev.result : current.text;
        const limit = isError ? limitOf(final) : null;
        if (isError && !limit) onEvent({ type: 'item', role: 'error', kind: 'text', body: clip(final || 'error', 3000) });
        // 3.2.1: the tokens Cursor reports with its result (newer CLIs), so its tasks count their usage like the others.
        const u = ev.usage ?? {};
        const usage = { durationMs: ev.duration_ms ?? null, inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null, cacheReadTokens: u.cacheReadTokens ?? null, cacheWriteTokens: u.cacheWriteTokens ?? null };
        if (ev.duration_ms || u.inputTokens != null) onEvent({ type: 'item', role: 'system', kind: 'usage', body: usage });
        current.finish({ final, isError, limit, ...(u.inputTokens != null ? { usage } : {}) });
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk; let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1); if (line) handle(line); }
      if (buffer.length > 8 * 1024 * 1024) buffer = '';
    });
    child.on('exit', (code) => {
      if (buffer.trim()) handle(buffer.trim());
      if (streamed.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: streamed }); current.addText(streamed); }
      const stderr = child.stderrText();
      if (!current.done) {
        const msg = current.text || tr('sys.agents.exitedCode', { name: 'Cursor', code, detail: stderr.trim().split('\n').slice(-3).join(' ') }).trim();
        // 3.2.1: the CLI ends with the usage limit on its error output (ActionRequiredError), not as a result.
        const limit = code !== 0 ? limitOf(stderr) : null;
        if (code !== 0 && !current.text && !limit) onEvent({ type: 'item', role: 'error', kind: 'text', body: clip(msg, 3000) });
        current.finish({ isError: code !== 0, final: limit && current.text ? `${current.text}\n${limit.text}` : msg, limit });
      }
    });
    child.on('error', (error) => { if (!current.done) current.finish({ isError: true, final: tr('sys.agents.startFailed', { name: 'Cursor', error: error.message }) }); });
    return current.promise;
  };
  live.steer = () => false;
  live.interrupt = async () => { killTree(child); };
  live.respond = () => false;
  live.setModel = (m) => { model = m || null; };
  live.setPermission = (p) => { permission = p; };
  live.close = () => { closed = true; killTree(child); };
  live.isClosed = () => closed;
  return live;
}
