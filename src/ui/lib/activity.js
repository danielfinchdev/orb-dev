// The engine's log as a line anyone can read: «Uso de la tarea · 1 min», «Tarea lanzada · Cursor», instead of
// «task.usage {"minutes":1,"tokens":0,"costUsd":null}». The raw event stays for copying and on hover.
// Every view that draws an event goes through activityDetail: JSON and the engine's own names never reach the screen.

const json = (s) => { if (!/^\s*[{[]/.test(String(s ?? ''))) return null; try { return JSON.parse(s); } catch { return null; } };

// The name of an event: its own text when there is one, else the internal name.
export function activityLabel(t, kind) {
  const key = `activity.kind.${String(kind ?? '').replace(/\./g, '_')}`;
  const label = t(key);
  return label === key ? kind : label;
}

// The tools of Orb in plain words; the families collapse (every orb_browser_* is «usar el navegador»).
function toolLabel(t, name) {
  const short = name.replace(/^orb_/, '').replace(/^browser_.*/, 'browser').replace(/^android_.*/, 'android');
  const key = `activity.tool.${short}`;
  const label = t(key);
  return label === key ? t('activity.tool') : label;
}

// Task states travel as internal words («done», «blocked»); they are told with the labels the Tareas view uses.
function stateLabel(t, v) {
  if (typeof v !== 'string' || !/^[a-z_]+$/.test(v)) return v;
  const key = `status.${v}`;
  const label = t(key);
  return label === key ? v : label;
}

const oneLine = (s, max) => {
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return max && flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};

// A text the engine or an agent wrote: Orb's tool names and the quoted states inside it are told in words.
// max: cut to that many characters with «…» on one line (the Actividad list keeps one line per event).
export function activityText(t, raw, max = 0, agents = {}) {
  // a line of a list starts without Markdown marks («## Contexto», «- nota»)
  const lead = max ? /^(?:(?:#{1,6}|>|[-*+])\s+)+/ : /^$^/;
  const text = String(raw ?? '').trim().replace(lead, '')
    .replace(/\s*\(refs\/[^)]+\)/g, '') // git references mean nothing to a person
    .replace(/\brefs\/orb\/\S+/g, '')
    .replace(/\b(orb_[a-z_]+)\b(?:\s+(?:con\s+)?status:?\s*"?([a-z_]+)"?)?/g, (_, name, st) => `${toolLabel(t, name)}${st ? ` · ${String(stateLabel(t, st)).toLowerCase()}` : ''}`)
    .replace(/"([a-z_]+)"/g, (m, w) => { const label = stateLabel(t, w); return label === w ? m : String(label).toLowerCase(); })
    .replace(/\bnull\b/g, '')
    // an exit code never reaches the screen: «código 0» says nothing when all went well, any other one is «con un error»
    .replace(/\((?:c[oó]digo|(?:exit )?code) \d+, /gi, '(').replace(/, (?:c[oó]digo|(?:exit )?code) \d+\)/gi, ')')
    .replace(/ ?\((?:c[oó]digo|(?:exit )?code) (\d+)\)/gi, (_, n) => (Number(n) === 0 ? '' : ` ${t('activity.codeError')}`))
    .replace(/(?:\bcon c[oó]digo|\bwith (?:exit )?code) (\d+)/gi, (_, n) => (Number(n) === 0 ? '' : t('activity.codeError')))
    // «estado done» is a task state
    .replace(/\bestado ([a-z_]+)\b/g, (m, w) => { const label = stateLabel(t, w); return label === w ? m : `estado: ${String(label).toLowerCase()}`; })
    // a piece that is exactly an agent's id is told with its name
    .split(' · ').map((part) => agents[part.trim()] ?? part).join(' · ')
    // a sentence the agent wrote in lower case after a full stop
    .replace(/([a-záéíóúñ0-9)»]{2}[.!?]\s+)([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase())
    .trim();
  return oneLine(stateLabel(t, text), max);
}

const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
// A closed sentence: capital first, no dangling marks.
const close = (s) => {
  const x = upperFirst(String(s).replace(/«\s*»/g, '').replace(/\s+/g, ' ').replace(/\s+([:,.;])/g, '$1').replace(/\(\s*\)/g, '').replace(/[\s:,;·-]+$/, '').trim());
  // the mock-up's rows have no final stop; only a text of several sentences closes with one
  const single = x.replace(/\.$/, '');
  if (!/[.!?]\s/.test(single)) return single;
  return /[.!?…]$/.test(x) ? x : `${x}.`;
};

// A text a person reads as a sentence (the result of a run, a line of the engine): the words of activityText, closed.
export function activityPlain(t, raw, max = 0, agents = {}) {
  const text = activityText(t, raw, max, agents);
  return text.endsWith('…') ? upperFirst(text) : close(text);
}

const fillIn = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const phrase = (t, name) => { const key = `activity.say.${name}`; const v = t(key); return v === key ? null : v; };

// The engine's own lines («tarea #15 terminó (código 0, estado done)») as a sentence; any other line is only tidied.
function engineLine(t, text, max, agents) {
  const raw = String(text ?? '').trim();
  const done = /^tarea #(\d+) termin[oó] \((?:c[oó]digo|code) \d+, estado:? ([a-z_]+)(, detenida)?\)$/i.exec(raw);
  if (done) return t(done[3] ? 'activity.line.finishedStopped' : 'activity.line.finished', { n: done[1], state: String(stateLabel(t, done[2])).toLowerCase() });
  const launched = /^tarea #(\d+) lanzada con (.+?)(?: \(([^)]+)\))? en (?:[A-Za-z]:[\\/]|[\\/~]).*$/.exec(raw);
  if (launched) return t('activity.line.launched', { n: launched[1], who: `${agents[launched[2]] ?? launched[2]}${launched[3] ? ` (${launched[3]})` : ''}` });
  const mcp = /^mcp-externo: (.+?) \([^)]*\) cre[oó] la tarea #(\d+) en «(.*)»$/.exec(raw);
  if (mcp) return t('activity.line.mcpCreated', { who: mcp[1], n: mcp[2], project: mcp[3] });
  return activityPlain(t, raw, max, agents);
}

// What the user did, as the engine writes it in the user's log (English words; «[movil] » when it came from the phone).
function userParts(t, kind, text) {
  const via = /^\[movil\]\s*/.test(text);
  const body = text.replace(/^\[movil\]\s*/, '');
  const m = (re) => re.exec(body);
  let name = kind.replace(/\./g, '_'); const vars = {};
  if (kind === 'file.create') vars.detail = (m(/^created (.*)$/)?.[1] ?? '').split(/[\\/]/).pop();
  else if (kind === 'git.switch') vars.detail = m(/-> (.*)$/)?.[1] ?? '';
  else if (kind === 'git.branch') vars.detail = m(/^created branch (.*?)(?: and switched to it)?$/)?.[1] ?? '';
  else if (kind === 'git.undo') vars.detail = m(/^undid save [^:]*:\s*(.*)$/)?.[1] ?? '';
  else if (kind === 'chat.message') vars.detail = body;
  else if (kind === 'approval.decision') {
    const task = m(/^task #(\d+) (approved|rejected)$/);
    if (task) { name = `approval_task_${task[2]}`; vars.task = `#${task[1]}`; } else name = 'approval_session';
  } else if (kind === 'undo.task') vars.task = m(/#(\d+)/) ? `#${m(/#(\d+)/)[1]}` : '';
  else if (kind === 'trash.restore') name = `trash_restore_${m(/^(\w+)/)?.[1] ?? ''}`;
  else if (kind === 'settings.change') {
    const keys = (m(/^settings:\s*(.*)$/)?.[1] ?? '').split(/,\s*/).filter((k) => k && k !== '-');
    // the longest known prefix of each key says what it is about (ui.music.volume → ui.music)
    const found = new Set(keys.map((k) => {
      const parts = k.split('.');
      for (let n = parts.length; n > 0; n -= 1) { const key = `activity.setting.${parts.slice(0, n).join('_')}`; const v = t(key); if (v !== key) return v; }
      return null;
    }));
    vars.detail = found.size === 1 && !found.has(null) ? [...found][0] : t(`activity.setting.${keys.length > 1 ? 'many' : 'one'}`);
  } else if (/^rules\./.test(kind)) { const title = m(/^rules\.\w+(?: \S+)?(?::\s*(.*))?$/)?.[1]; vars.detail = title ? `«${title}»` : ''; }
  return { name, vars, via };
}

// The row of the list as one sentence: «Claude Code empezó la tarea #42 «Guardar el carrito»».
// row: { kind, actor?, title?, detail?, task?, text, source }; agents: the names of the agents (as in activityDetail).
export function activitySentence(t, row, locale, agents = {}, max = 0) {
  const kind = String(row?.kind ?? '');
  if (row?.actor === undefined) {
    // a line without an event behind it: what the user did, or a line of the engine or the app
    if (row?.source === 'usuario') {
      const { name, vars, via } = userParts(t, kind, String(row.text ?? ''));
      const tpl = phrase(t, name);
      if (tpl) return close(`${fillIn(tpl, { task: '', title: '', detail: '', ...vars })}${via ? ` ${t('activity.viaPhone')}` : ''}`);
    }
    return engineLine(t, row?.text, max, agents) || activityLabel(t, kind);
  }
  const user = row.actor === 'usuario';
  let name = kind.replace(/\./g, '_');
  let raw = String(row.detail ?? '').trim();
  let state = '';
  // a project's name travels with its folder («web -> C:\web»): the folder stays for the hover
  if (/^project\./.test(kind)) {
    raw = raw.replace(/\s*\((?:la carpeta no se borra|papelera|folder is not deleted|bin)\)\s*$/, '');
    raw = kind === 'project.renamed' ? raw.replace(' -> ', ` ${t('activity.renamedTo')} `) : kind === 'project.moved' ? raw.split(':')[0] : raw.split(' -> ')[0];
    if (kind === 'project.active' && /^(ninguno|none)$/i.test(raw)) { name = 'project_active_none'; raw = ''; }
  } else if (kind === 'log.merged') raw = raw.replace(/:\s*BITACORA\.md$/, '');
  else if (kind === 'files.changed') {
    // the engine stores «ningún archivo» (or nothing) when the task left the folder as it was
    if (!raw || /^(ningún archivo|no files)$/i.test(raw)) { name = 'files_changed_none'; raw = ''; }
    else raw = raw.replace(/(^|, )(?:[A-Z]{1,2}|\?\?) (?=\S)/g, '$1');
  }
  else if (kind === 'task.delegated') raw = raw.replace(/ · ([a-z_]+)$/, (m0, w) => { const label = stateLabel(t, w); return label === w ? m0 : ` · ${String(label).toLowerCase()}`; });
  else if (kind === 'agent.reply') {
    const reply = /^(hecha|fallida|bloqueada|cancelada|done|failed|blocked|cancelled)(?::\s*([\s\S]*))?$/i.exec(raw);
    if (reply?.[2]) { state = reply[1].toLowerCase(); raw = reply[2]; name = 'agent_reply_state'; }
  }
  let detail = activityDetail(t, { kind, detail: raw }, locale, agents, max);
  // the object of the usage and launch events reads as a sentence: commas, not the list's dots
  if (/^\s*\{/.test(raw)) detail = detail.replace(/ · /g, ', ');
  else if (/^[a-z_]+$/.test(raw)) detail = lowerFirst(detail);
  const vars = {
    actor: user ? t('agent.user') : agents[row.actor] ?? (row.actor === 'orb' ? 'Orb' : row.actor),
    task: row.task != null ? `#${row.task}` : '',
    title: row.title ? `«${oneLine(row.title, 80)}»` : '',
    detail, state
  };
  const tpl = (user && phrase(t, `${name}.you`)) || phrase(t, name);
  if (!tpl) return close(fillIn(t('activity.say.fallback'), { label: activityLabel(t, kind), title: vars.title, detail }));
  return close(fillIn(tpl, vars));
}

// What happened, in a short line (empty when the raw detail says nothing to a person).
// agents: the names of the agents (labels.js AGENT), passed in so this stays free of the app's store.
export function activityDetail(t, row, locale, agents = {}, max = 0) {
  const raw = String(row?.detail ?? '').trim();
  const data = json(raw);
  // A cut-off object (the engine clips long details) is still JSON: it says nothing to a person.
  if (!data && /^(\{\s*"|\[\s*[{"\d])/.test(raw)) return '';
  const num = (n, opts) => Number(n).toLocaleString(locale, opts);
  if (data) {
    // Only the two events that carry an object have a sentence; any other object or list says nothing to a person.
    if (Array.isArray(data) || typeof data !== 'object') return '';
    if (row?.kind === 'task.usage') {
      const parts = [];
      if (data.minutes != null) parts.push(data.minutes < 1 ? `<1 ${t('activity.min')}` : t('activity.minutes', { n: num(Math.round(data.minutes)) }));
      if (data.tokens) parts.push(t('activity.tokens', { n: num(data.tokens) }));
      if (data.costUsd) parts.push(`$${num(data.costUsd, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      return parts.join(' · ');
    }
    if (row?.kind === 'task.launch_options') {
      const who = agents[data.agent] ?? data.agent;
      const account = data.account && data.account !== data.agent ? t('activity.account', { account: agents[data.account] ?? data.account }) : null;
      const level = data.reasoning ? t('activity.reasoning', { level: String(t(`reasoning.${data.reasoning}`)).toLowerCase() }) : null;
      return [who, account, data.model ? t('activity.model', { model: data.model }) : null, level].filter(Boolean).join(' · ');
    }
    return '';
  }
  return activityText(t, raw, max, agents);
}
