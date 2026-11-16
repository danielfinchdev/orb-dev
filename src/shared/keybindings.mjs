// Keyboard shortcuts as one table. The defaults live here; the user's changes live in core/keybindings.json as rules
// { key, command, when } (key: «Ctrl+Alt+A»; when: 'always' | 'chat'). No DOM and no files: the engine reads and
// writes the file (src/engine/api/app.mjs), the window matches events (src/ui/lib/keys.js), the tests run this alone.

// id, label key (locales), default combo, when it counts, reserved (cannot be rebound: the window or the OS owns it).
export const COMMANDS = Object.freeze([
  { id: 'palette.open', label: 'keys.cmd.palette', key: 'Ctrl+K', when: 'always', reserved: true },
  { id: 'terminal.open', label: 'keys.cmd.terminal', key: 'Ctrl+J', when: 'always', reserved: true },
  { id: 'app.reload', label: 'keys.cmd.reload', key: 'F5', when: 'always', reserved: true },
  { id: 'inbox.nextNeeds', label: 'keys.cmd.nextNeeds', key: 'Ctrl+Alt+A', when: 'always' },
  { id: 'changes.toggle', label: 'keys.cmd.changes', key: 'Ctrl+D', when: 'chat' },
  { id: 'tabs.new', label: 'keys.cmd.tabNew', key: 'Ctrl+T', when: 'always' },
  { id: 'tabs.close', label: 'keys.cmd.tabClose', key: 'Ctrl+W', when: 'chat' },
  { id: 'tabs.next', label: 'keys.cmd.tabNext', key: 'Ctrl+PageDown', when: 'chat' },
  { id: 'tabs.prev', label: 'keys.cmd.tabPrev', key: 'Ctrl+PageUp', when: 'chat' },
  { id: 'tabs.split', label: 'keys.cmd.tabSplit', key: 'Ctrl+\\', when: 'chat' },
  { id: 'tabs.focusOther', label: 'keys.cmd.tabFocus', key: 'Ctrl+Alt+Right', when: 'chat' },
  { id: 'chat.addSelection', label: 'keys.cmd.addSelection', key: 'Ctrl+Shift+L', when: 'chat' },
  { id: 'brain.next', label: 'keys.cmd.brainNext', key: 'Alt+]', when: 'chat' },
  { id: 'brain.prev', label: 'keys.cmd.brainPrev', key: 'Alt+[', when: 'chat' },
  { id: 'search.files', label: 'keys.cmd.findFile', key: 'Ctrl+P', when: 'always' },
  { id: 'search.text', label: 'keys.cmd.findText', key: 'Ctrl+Shift+F', when: 'always' }
]);
const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));
export const commandOf = (id) => BY_ID.get(id) ?? null;
export const WHENS = Object.freeze(['always', 'chat']);

// Combos the window itself owns (zoom, full screen, tab switching of the webview) though they are not rows of this table.
// Ctrl+A/C/V/X/Y/Z are the text box's own (copy, paste, undo…): a rule on them would swallow them in the chat.
const SYSTEM = Object.freeze(['F11', 'Ctrl+0', 'Ctrl+=', 'Ctrl++', 'Ctrl+-', 'Ctrl+Tab', 'Alt+F4', 'Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Y', 'Ctrl+Z']);

const MODS = ['Ctrl', 'Alt', 'Shift'];
const MOD_NAMES = { cmd: 'Ctrl', command: 'Ctrl', meta: 'Ctrl', control: 'Ctrl', ctrl: 'Ctrl', option: 'Alt', alt: 'Alt', shift: 'Shift' };
const KEY_NAMES = {
  esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', ins: 'Insert', insert: 'Insert', return: 'Enter', enter: 'Enter',
  space: 'Space', spacebar: 'Space', left: 'Left', arrowleft: 'Left', right: 'Right', arrowright: 'Right', up: 'Up', arrowup: 'Up',
  down: 'Down', arrowdown: 'Down', pgup: 'PageUp', pageup: 'PageUp', pgdn: 'PageDown', pagedown: 'PageDown', home: 'Home', end: 'End',
  tab: 'Tab', backspace: 'Backspace'
};
// keys that type something or only move the caret: they need a modifier or the text box would lose them
const NEEDS_MOD = new Set(['Space', 'Enter', 'Backspace', 'Tab', 'Delete', 'Left', 'Right', 'Up', 'Down', 'Home', 'End']);

function keyName(raw) {
  const s = String(raw);
  if (KEY_NAMES[s.toLowerCase()]) return KEY_NAMES[s.toLowerCase()];
  if (s === ' ') return 'Space';
  if (/^f([1-9]|1\d|2[0-4])$/i.test(s)) return s.toUpperCase();
  if (/^[a-z]$/i.test(s)) return s.toUpperCase();
  if (s.length === 1 && !/\s/.test(s)) return s; // digits and punctuation: \ / , . ; ' [ ] - = `
  return null;
}

// «ctrl + alt + a» → «Ctrl+Alt+A»; null when it is not a usable combo. Cmd/Meta count as Ctrl (the app treats them alike).
// One key and any modifiers; a letter, a digit, an arrow or Space alone needs a modifier (it would be typed in the text box).
export function normalizeCombo(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 40) return null;
  const text = input.trim();
  const parts = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text === '+' ? ['+'] : text.split('+');
  const mods = new Set(); let key = null;
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) return null;
    if (MOD_NAMES[p.toLowerCase()]) { mods.add(MOD_NAMES[p.toLowerCase()]); continue; }
    if (key !== null) return null;
    key = keyName(p);
    if (key === null) return null;
  }
  if (key === null) return null;
  const typed = key.length === 1 && key !== '\\' && key !== '`' ? true : NEEDS_MOD.has(key);
  if (!mods.size && typed) return null;
  return [...MODS.filter((m) => mods.has(m)), key].join('+');
}

const CODE_KEYS = { Backslash: '\\', Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`' };
// The combo a keydown means; null for a modifier alone, a dead key or AltGr (Ctrl+Alt that types a character).
export function comboFromEvent(e) {
  if (!e || typeof e.key !== 'string') return null;
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'Dead', 'Unidentified', 'Process'].includes(e.key)) return null;
  const ctrl = Boolean(e.ctrlKey || e.metaKey);
  const code = String(e.code ?? '');
  let key;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (CODE_KEYS[code]) key = CODE_KEYS[code];
  else key = keyName(e.key);
  if (!key) return null;
  if (ctrl && e.altKey && e.key.length === 1 && /^Key[A-Z]$/.test(code) && e.key.toLowerCase() !== key.toLowerCase()) return null;
  return [...[ctrl && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean), key].join('+');
}

// What core/keybindings.json holds. → { rules, problems }. Bad JSON gives no rules and one problem; the defaults stay.
export function parseFile(text) {
  if (text == null || String(text).trim() === '') return { rules: [], problems: [] };
  let data;
  try { data = JSON.parse(String(text)); } catch { return { rules: [], problems: [{ index: -1, command: null, reason: 'json' }] }; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.bindings) ? data.bindings : null;
  if (!list) return { rules: [], problems: [{ index: -1, command: null, reason: 'json' }] };
  return { rules: list.slice(0, 200), problems: [] };
}
export const serialize = (rules) => `${JSON.stringify(rules.map((r) => ({ key: r.key ?? null, command: r.command, ...(r.when && r.when !== 'always' ? { when: r.when } : {}) })), null, 2)}\n`;

const overlap = (a, b) => a === b || a === 'always' || b === 'always';

// What stops `command` from using `key` in `when`. → { reason: 'key' | 'system' | 'reserved' | 'conflict', with } or null.
export function conflictOf(table, command, key, when = 'always') {
  const k = normalizeCombo(key);
  if (!k) return { reason: 'key', with: null };
  if (SYSTEM.includes(k)) return { reason: 'system', with: k };
  for (const [id, v] of table) {
    if (id === command || !v.key || v.key !== k || !overlap(v.when, when)) continue;
    return { reason: v.reserved ? 'reserved' : 'conflict', with: id };
  }
  return null;
}

// The table in force: the defaults, then the user's rules (the last rule of a command wins). A rule is dropped, and said
// so in `problems`, when its command is unknown or reserved, its key is not valid, or it would share its key with another
// command in an overlapping context (the other one keeps it) or with a combo the window owns. key null unbinds the command.
// → { table: Map(command → { key|null, when, reserved, custom }), problems: [{ index, command, reason, with? }] }
export function resolve(rules = []) {
  const table = new Map(COMMANDS.map((c) => [c.id, { key: c.key, when: c.when, reserved: Boolean(c.reserved), custom: false }]));
  const problems = [];
  const last = new Map();
  (Array.isArray(rules) ? rules : []).forEach((r, index) => {
    if (r && typeof r === 'object') last.set(String(r.command), { r, index }); else problems.push({ index, command: null, reason: 'rule' });
  });
  for (const [command, { r, index }] of last) {
    const def = BY_ID.get(command);
    if (!def) { problems.push({ index, command, reason: 'unknown' }); continue; }
    if (def.reserved) { problems.push({ index, command, reason: 'reserved' }); continue; }
    const when = r.when === undefined ? def.when : r.when;
    if (!WHENS.includes(when)) { problems.push({ index, command, reason: 'when' }); continue; }
    if (r.key === null || r.key === '' || r.key === undefined) { table.set(command, { key: null, when, reserved: false, custom: true }); continue; }
    const key = normalizeCombo(r.key);
    if (!key) { problems.push({ index, command, reason: 'key' }); continue; }
    // the command's own default must not be in the way of itself; other commands that still hold the key win
    const clash = conflictOf(table, command, key, when);
    if (clash) { problems.push({ index, command, reason: clash.reason, with: clash.with }); continue; }
    table.set(command, { key, when, reserved: false, custom: true });
  }
  return { table, problems };
}

// The command a key press runs in this context ({ view: route.view }), or null.
export function matchCommand(table, e, { view = 'chat' } = {}) {
  const combo = comboFromEvent(e);
  if (!combo) return null;
  const inChat = view === 'chat' || view === 'session';
  for (const [id, v] of table) if (v.key === combo && (v.when === 'always' || inChat)) return id;
  return null;
}

// The rules the file holds after the user sets `command` to `key` (null: unbound). A default is not written.
export function withBinding(rules, command, key) {
  const def = BY_ID.get(command);
  const rest = (Array.isArray(rules) ? rules : []).filter((r) => r?.command !== command);
  if (!def || def.reserved) return rest;
  if (key !== null && normalizeCombo(key) === def.key) return rest;
  return [...rest, { key: key === null ? null : normalizeCombo(key), command }];
}
export const withoutBinding = (rules, command) => (Array.isArray(rules) ? rules : []).filter((r) => r?.command !== command);
