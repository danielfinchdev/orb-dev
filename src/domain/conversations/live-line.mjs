// The short line of what an agent does right now («Editando styles.css»), for the list rows. Only a file's name is
// ever shown, never its folder, and a command is cut to its first words, so nothing of the PC's layout leaves it.
import { tr } from '../../platform/context.mjs';

// what a tool's call works on, short and without paths
export function liveStep(name, input) {
  const bare = String(name ?? '').replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '').replace(/^(orb|opti)[:-](?=(orb|opti)_)/, '').replace(/^orb:/, '');
  let target = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (/^([a-z]:)?[\\/]|^\.{0,2}[\\/]|[\\/][^\\/\s]+\.[\w]{1,8}$/i.test(target) && !/\s/.test(target)) target = target.split(/[\\/]/).filter(Boolean).pop() ?? '';
  if (target.startsWith('{')) target = '';
  return { name: bare, target: target.slice(0, 60) };
}

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

// «Editando styles.css», «Leyendo archivos»…: the same words as the chat's own live line (chat.act.*)
export function activityLine(name, target) {
  const bare = String(name ?? '');
  const kind = KINDS.find(([re]) => re.test(bare))?.[1];
  if (kind && WITH_TARGET.has(kind)) return target ? tr(`chat.act.${kind}`, { target }) : tr(`chat.act.${kind}Any`);
  if (kind) return tr(`chat.act.${kind}`);
  return /^[A-Za-z][A-Za-z ]{1,30}$/.test(bare) ? tr('chat.act.other', { name: bare }) : tr('chat.act.otherAny');
}
