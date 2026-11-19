// The short line of what an agent does right now («Editando styles.css»), for the list rows. It leaves the PC for the
// phone, so only a file's name is ever shown (never its folder), a command shows only its program's name, and the
// result goes through the secrets scan.
import { tr } from '../../platform/context.mjs';
import { redactSecrets } from '../../shared/secrets-scan.mjs';

const KINDS = [
  [/^(read|read_file|view|cat|open_file)$/i, 'read'],
  [/^(grep|glob|search|find|ls|list_dir|codebase_search|file_search)/i, 'search'],
  [/^(bash|shell|exec|command|run|terminal|powershell)/i, 'run'],
  [/^(edit|write|multiedit|notebookedit|apply_patch|create_file|str_replace)/i, 'edit'],
  [/^(webfetch|websearch|fetch|web_search|browse)/i, 'web'],
  [/^orb_create_task$/, 'task'], [/^orb_(board|list_tasks|get_task|wait_tasks)$/, 'board'],
  [/^orb_read_log$/, 'readLog'], [/^orb_write_log$/, 'writeLog'], [/^orb_ask$/, 'ask'],
  [/^orb_(set_project|create_project|add_project)$/, 'project'], [/^orb_schedule$/, 'schedule'],
  [/^orb_browser_/, 'browser'], [/^orb_(send_message|read_messages)$/, 'messages'],
  [/^(todowrite|todo)/i, 'plan'], [/^(task|agent|delegate)/i, 'delegate'],
  [/^tool_?search$/i, 'tools'], [/^opti_propose$/, 'propose'], [/^opti_/, 'pc'],
];
const WITH_TARGET = new Set(['read', 'search', 'run', 'edit', 'web']);

// What is safe to show of a tool's target: a file name, a command's program, a site's host; 60 characters at most.
const SLASH = /[\\/]/;
function cleanTarget(kind, input) {
  let t = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.startsWith('{')) return '';
  t = t.replace(/^["'`]+|["'`]+$/g, '');
  if (kind === 'run') {
    const first = t.split(' ')[0].replace(/^["'`]+|["'`]+$/g, '');
    if (!first || first.includes('=') || /^(export|set|setx|env)$/i.test(first)) return '';
    t = first.split(SLASH).filter(Boolean).pop() ?? '';
  } else if (kind === 'web') {
    t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#\\\s]/)[0];
  } else if (SLASH.test(t)) {
    // everything up to the last slash goes, spaces in the folders included
    t = t.replace(/[\\/]+$/, '').split(SLASH).pop() ?? '';
  }
  return redactSecrets(t.replace(/^["'`]+|["'`]+$/g, '')).slice(0, 60);
}
const kindOf = (name) => KINDS.find(([re]) => re.test(String(name ?? '')))?.[1];

// what a tool's call works on, short and without paths
export function liveStep(name, input) {
  const bare = String(name ?? '').replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '').replace(/^(orb|opti)[:-](?=(orb|opti)_)/, '').replace(/^orb:/, '');
  return { name: bare, target: cleanTarget(kindOf(bare), input) };
}

// «Editando styles.css», «Leyendo archivos»…: the same words as the chat's own live line (chat.act.*)
export function activityLine(name, target) {
  const bare = String(name ?? '');
  const kind = kindOf(bare);
  // the target is cleaned again here: rows also come from sources that never went through liveStep
  if (kind && WITH_TARGET.has(kind)) return (target = cleanTarget(kind, target)) ? tr(`chat.act.${kind}`, { target }) : tr(`chat.act.${kind}Any`);
  if (kind) return tr(`chat.act.${kind}`);
  return /^[A-Za-z][A-Za-z ]{1,30}$/.test(bare) ? tr('chat.act.other', { name: bare }) : tr('chat.act.otherAny');
}
