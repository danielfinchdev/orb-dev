// What a tool call does (by its name) and the one-line summary of a run of them: «Leyó 3 archivos, ejecutó 2 comandos».
// Pure: components/chat-live.jsx and views/session.jsx draw it.

// What a tool does, by its name (Claude, Codex, Cursor and the ACP agents name them differently).
const KIND = [
  [/^(read|read_file|view|cat|open_file)$/i, 'read'], [/^(grep|glob|search|find|ls|list_dir|codebase_search|file_search)/i, 'search'],
  [/^(bash|shell|exec|command|run|terminal|powershell)/i, 'run'], [/^(edit|write|multiedit|notebookedit|apply_patch|create_file|str_replace)/i, 'edit'],
  [/^(webfetch|websearch|fetch|web_search|browse)/i, 'web'], [/^orb_create_task$/, 'task'], [/^orb_(board|list_tasks|get_task|wait_tasks)$/, 'board'],
  [/^orb_read_log$/, 'readLog'], [/^orb_write_log$/, 'writeLog'], [/^orb_ask$/, 'ask'], [/^orb_(set_project|create_project|add_project)$/, 'project'],
  [/^orb_schedule$/, 'schedule'], [/^orb_browser_/, 'browser'], [/^orb_(send_message|read_messages)$/, 'messages'], [/^(todowrite|todo)/i, 'plan'], [/^(task|agent|delegate)/i, 'delegate'],
  // the agent looking up its own tools; opti_* in Opti Bot's old conversation
  [/^tool_?search$/i, 'tools'], [/^opti_propose$/, 'propose'], [/^opti_/, 'pc']
];
// «mcp__orb__orb_ask», «orb:orb_ask», «orb-orb_ask» → «orb_ask» (how each agent names the tools of a server).
export const bareTool = (name) => String(name ?? '').replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '').replace(/^(orb|opti)[:-](?=(orb|opti)_)/, '');
export const kindOf = (name) => KIND.find(([re]) => re.test(name))?.[1] ?? 'other';

// The kinds the summary counts, in the order it says them; every other tool counts as «other».
const SUMMARY_KINDS = ['read', 'search', 'edit', 'run', 'web', 'other'];
const summaryKind = (name) => { const k = kindOf(bareTool(name)); return SUMMARY_KINDS.includes(k) ? k : 'other'; };

// names of tool calls → [{ kind, n }] in SUMMARY_KINDS order, only the kinds that appear.
export function summaryParts(names) {
  const count = new Map();
  for (const name of names) { const k = summaryKind(name); count.set(k, (count.get(k) ?? 0) + 1); }
  return SUMMARY_KINDS.filter((k) => count.has(k)).map((kind) => ({ kind, n: count.get(kind) }));
}

// The sentence: «Leyó 3 archivos, ejecutó 2 comandos». t: (key, vars) → text; keys tools.sum.<kind>.one / .other.
export function summaryText(names, t) {
  const parts = summaryParts(names).map(({ kind, n }) => t(`tools.sum.${kind}.${n === 1 ? 'one' : 'other'}`, { n }));
  if (!parts.length) return '';
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A run of two or more finished tool calls in a row becomes one folded block (the tail that is still running stays apart,
// so the live step is never hidden). blocks as session-blocks.js › toBlocks makes them → blocks with { type: 'toolgroup', steps }.
export function groupTools(blocks, min = 2) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= min) out.push({ type: 'toolgroup', key: `group-${run[0].key}`, steps: run });
    else out.push(...run);
    run = [];
  };
  for (const b of blocks) {
    if (b.type === 'tool' && b.result) { run.push(b); continue; }
    flush();
    out.push(b);
  }
  flush();
  return out;
}
