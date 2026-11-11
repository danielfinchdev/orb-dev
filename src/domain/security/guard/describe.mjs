// Plain-language descriptions of actions for the approval prompts, and the language guess they use.
import { translate } from '../../../shared/i18n.mjs';
import { statements, words } from './shell-text.mjs';

// what a command does, in words anyone understands, for the permission notice in the chat (the command itself is
// one click away, never in the sentence). The agent's own description wins (Claude's Bash tool gives one).
const PLAIN = [
  [/^(taskkill|stop-process|kill|pkill|killall)\b/i, 'msg.guard.plain.stop'],
  [/^(rm|remove-item|ri|rd|rmdir|del|erase)\b/i, 'msg.guard.plain.delete'],
  [/^git\s+(?:-\S+\s+)*push\b/i, 'msg.guard.plain.push'],
  [/^git\b/i, 'msg.guard.plain.git'],
  [/^gh\b/i, 'msg.guard.plain.github'],
  [/^(npm|pnpm|yarn)\s+(i|install|add|ci)\b/i, 'msg.guard.plain.install'],
  [/^(npm|pnpm|yarn)\s+publish\b/i, 'msg.guard.plain.publish'],
  [/^(npm|pnpm|yarn|npx)\b/i, 'msg.guard.plain.npm'],
  [/^(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\b/i, 'msg.guard.plain.web'],
  [/^(node|python|py|deno|bun)\b/i, 'msg.guard.plain.script'],
  [/^(ssh|scp|sftp|rsync)\b/i, 'msg.guard.plain.remote'],
  [/^(schtasks|reg|setx|netsh|sc|shutdown|restart-computer|stop-computer|set-executionpolicy)\b/i, 'msg.guard.plain.system'],
  [/^(docker|podman)\b/i, 'msg.guard.plain.docker']
];
export function plainAction(command, { description = '', lang = 'es' } = {}) {
  if (String(description ?? '').trim()) return String(description).trim().replace(/\.$/, '').slice(0, 160);
  // The command inside a "powershell -Command '…'" or "cmd /c …" wrapper is the one that counts.
  // (Also a quoted path with spaces: "C:\Program Files\PowerShell\7\pwsh.exe" -Command "…".)
  let c = String(command ?? '').trim().replace(/^(?:"[^"]*[\\/]|[^\s"]*[\\/])?(?:powershell|pwsh|cmd)(?:\.exe)?"?\s+(?:[-/]\w+\s+)*?(?:-command|-c|\/c)\s+["']?/i, '');
  // a compound command (`$p = 11188; Stop-Process -Id $p`, `cd x && npm run dev`) is read clause by clause: the
  // first clause that names a known action wins, so the sentence is not built from a stray `11188;` or a `cd`.
  const clauses = statements(c).map((s) => s.replace(/^\s*(?:cd\s+[^;&|]+(?:&&|;)\s*)+/i, '').replace(/^\$\w+\s*=\s*\d+\s*$/,'').replace(/^\$\w+\s*=\s*/, '').trim()).filter(Boolean);
  for (const [re, key] of PLAIN) {
    const s = clauses.find((cl) => re.test(cl));
    if (!s) continue;
    // a deletion names what it deletes («borrar /tmp/tierra-build-check»), so the user can tell a temporary folder
    // of the agent's from their work.
    if (key === 'msg.guard.plain.delete') { const target = deleteTarget(s); if (target) return translate(lang, 'msg.guard.plain.deleteWhat', { target }); }
    return translate(lang, key, { program: progOf(s) });
  }
  const first = clauses.find((cl) => !/^\$\w+\s*=/.test(cl)) ?? c.replace(/^\$\w+\s*=\s*/, '');
  return translate(lang, 'msg.guard.plain.other', { program: progOf(first) });
}
const progOf = (s) => (String(s ?? '').trim().split(/\s+/)[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').replace(/[;,]+$/, '').slice(0, 30);
// The first thing a delete command names (rm -rf X, Remove-Item -Recurse -Path "X", rd /s /q X), shortened from the left
// when it is long; null when it names nothing readable (a variable, a pattern of several files).
export function deleteTarget(command) {
  const words = [...String(command ?? '').split(/[;&|]/)[0].matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]).slice(1);
  const target = words.find((w) => !/^-|^\/[a-z]{1,2}$/i.test(w));
  if (!target || /^\$|[*?]/.test(target)) return null;
  const clean = target.replace(/^["']+|["']+$/g, '').replace(/[\\/]+$/, '');
  if (!clean) return null;
  return clean.length > 60 ? `…${clean.slice(-57)}` : clean;
}
// whether an agent's own words are in English (Claude describes its commands in English even when the user
// writes in Spanish): then they are not quoted in a Spanish notice.
const EN_WORDS = /\b(the|and|for|with|from|into|start|run|check|install|build|create|remove|delete|kill|stop|test|verify|list|open|read|write|update|server|dev|file|files|folder|directory|temp|temporary|clean|cleanup|port|process|launch)\b/i;
const ES_WORDS = /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|para|que|con|un|una|y|en|por|archivo|archivos|carpeta|servidor)\b/i;
export const looksEnglish = (text) => EN_WORDS.test(String(text ?? '')) && !ES_WORDS.test(String(text ?? ''));
// One line for the approval card: what the agent wants to do, in plain words.
export function describeAction({ tool, command, paths = [], title, lang = 'es' }) {
  if (command) return String(command).slice(0, 400);
  if (paths.length) return `${tool ?? translate(lang, 'msg.guard.tool')}: ${paths.slice(0, 3).join(', ')}`;
  return String(title ?? tool ?? translate(lang, 'msg.guard.action')).slice(0, 400);
}
