// 3.8.2 (T3 3.2): a command from the chat into the user's terminal under it (components/terminal-panel.jsx). It is only
// pasted in its input line: the user reads it and presses Enter (Orb never runs it on its own).
const targets = new Set();

// The chat on screen listens (views/session.jsx). → whether one took it.
export function pasteToTerminal(text) {
  const line = String(text ?? '').replace(/\r?\n+$/, '');
  if (!line || !targets.size) return false;
  for (const fn of targets) fn(line);
  return true;
}
export function onTerminalPaste(fn) { targets.add(fn); return () => targets.delete(fn); }

// The languages of a code block that are commands for a terminal.
export const SHELL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'powershell', 'ps1', 'pwsh', 'ps', 'cmd', 'bat']);
// A block of several lines becomes one line for the shell (PowerShell and sh both read «;»); comment lines go.
export function oneCommand(text) {
  return String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(#|REM\b|::)/i.test(l)).map((l) => l.replace(/^(\$|PS [^>]*>|>)\s+/, '')).join('; ').slice(0, 4000);
}
// What a terminal prints, without its colour and cursor codes.
export const stripAnsi = (s) => String(s ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g, '').replace(/\r(?!\n)/g, '');
