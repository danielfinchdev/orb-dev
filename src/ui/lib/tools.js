// 3.2.1: the agents' tool calls as people read them: no internal names («mcp__opti__opti_propose», «ToolSearch»), no raw
// JSON, and commands without the escaping they come with («C:\\WINDOWS\\…», '"'"').

// The command inside «"…\powershell.exe" -Command '…'» (Codex shows the whole call), with its quoting undone, and Windows
// paths written with doubled backslashes (JSON or shell escaping) shown with one.
export function readableCommand(text) {
  let c = String(text ?? '').trim();
  const m = /^"?[^"\s]*?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:-\w+\s+)*?-Command\s+'([\s\S]*)'$/i.exec(c);
  if (m) c = m[1].replace(/'"'"'/g, "'").replace(/'\\''/g, "'");
  if (/[A-Za-z]:\\\\/.test(c)) c = c.replace(/\\\\/g, '\\');
  return c;
}

// What a tool call works on, in one line: the command, the file, the search… from the JSON the agent sent, when it is JSON.
const FIELDS = ['command', 'cmd', 'file_path', 'path', 'filePath', 'pattern', 'query', 'url', 'description', 'prompt', 'title', 'name', 'action'];
export function readableInput(input, name = '') {
  if (/^tool_?search$/i.test(String(name).replace(/^.*__/, ''))) return ''; // the agent looking up its own tools: nothing to read
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (!/^[[{]/.test(raw)) return readableCommand(raw);
  let value; try { value = JSON.parse(raw); } catch { return ''; } // cut JSON: nothing readable in it
  if (Array.isArray(value)) value = value.join(' ');
  if (typeof value !== 'object' || value == null) return readableCommand(String(value));
  const field = FIELDS.find((k) => typeof value[k] === 'string' && value[k].trim());
  if (field) return readableCommand(value[field]);
  if (Array.isArray(value.command)) return readableCommand(value.command.join(' '));
  return '';
}

// A model's id as a name when the catalog does not have it: «claude-sonnet-5-5» → «Sonnet 5.5», «gpt-6-luna» → «GPT-6-Luna».
export function prettyModel(id) {
  const parts = String(id ?? '').replace(/^claude-/, '').split('-').filter(Boolean);
  if (!parts.length) return '';
  const cap = (w) => (/^gpt$/i.test(w) ? 'GPT' : w[0].toUpperCase() + w.slice(1));
  if (/^gpt$/i.test(parts[0])) return parts.map(cap).join('-');
  const out = [];
  for (const p of parts) {
    if (/^\d+$/.test(p) && /\d$/.test(out.at(-1) ?? '')) out[out.length - 1] += `.${p}`;
    else out.push(/^\d/.test(p) ? p : cap(p));
  }
  return out.join(' ');
}
