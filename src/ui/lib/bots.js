// 3.5: the pure pieces of the «Bots» mode (no React, no store): which mode a screen is in, the bot a chat opens with,
// what the editor sends. Magic Link's: lib/link.js. Tested in test/bots-ui.test.mjs.
import { parseAvatar } from '../../core/avatar.mjs';

// The screens of the «Bots» mode; any other belongs to «Orb».
export const BOT_VIEWS = ['bot-chats', 'bot-chat', 'bot-group', 'bots', 'bot-groups', 'bot-reminders', 'bot-memory', 'bot-home', 'bot-server', 'bot-settings'];
// A shared screen («Más», Magic Link) opened from the Bots mode carries mode: 'bots' and stays in it.
export const modeOf = (route) => (BOT_VIEWS.includes(route?.view) || route?.mode === 'bots' ? 'bots' : 'orb');

// The tool groups a bot may have, in the order the editor shows them (the engine's list: src/core/bots.mjs › TOOL_GROUPS).
export const TOOL_ORDER = ['internet', 'recordatorios', 'correo', 'calendario', 'navegador', 'casa', 'equipo', 'oce', 'servidor', 'gestion'];
// The reasoning levels a bot may use (src/core/bots.mjs › EFFORTS).
export const EFFORTS = ['low', 'medium', 'high', 'xhigh'];

// The bot a «Chat» opens with: the last one talked to (if it still exists), the chief, or the first.
export function chatBot(bots, lastId = null) {
  const list = Array.isArray(bots) ? bots : [];
  return list.find((b) => b.id === Number(lastId)) ?? list.find((b) => b.is_chief) ?? list[0] ?? null;
}

// A new bot's fields, as the editor starts them.
export const newBotDraft = (agent = 'claude') => ({ name: '', icon: '🤖', role_text: '', agent, model: '', effort: 'medium', tools: ['internet', 'recordatorios'], accounts: {}, exclusive: [], is_chief: false, paused: false });
// What the editor sends: only what the engine takes, the lists cleaned up.
export function botPayload(d) {
  const words = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  const mcp = words(d.accounts?.mcp);
  const accounts = { ...(mcp.length ? { mcp } : {}), ...(String(d.accounts?.account ?? '').trim() ? { account: String(d.accounts.account).trim() } : {}) };
  return {
    name: String(d.name ?? '').trim(), icon: String(d.icon ?? '').trim(), role_text: String(d.role_text ?? '').trim(),
    agent: d.agent, model: d.model || null, effort: EFFORTS.includes(d.effort) ? d.effort : 'medium',
    tools: TOOL_ORDER.filter((t) => (d.tools ?? []).includes(t)), accounts, exclusive: words(d.exclusive).map((x) => x.toLowerCase()),
    is_chief: Boolean(d.is_chief), paused: Boolean(d.paused),
    // 3.6: its avatar { shape, color } (src/core/avatar.mjs), when the editor has one.
    ...(parseAvatar(d.avatar) ? { avatar: parseAvatar(d.avatar) } : {}),
    // 3.6: its daily caps (empty: none), only when the editor shows them.
    ...(d.caps !== undefined ? { caps: capsPayload(d.caps) } : {})
  };
}
// 3.6: a bot's daily caps as the engine takes them ({ daily_turns, daily_tokens, daily_usd }), or null for none.
export function capsPayload(c) {
  const n = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
  const out = { daily_turns: n(c?.daily_turns), daily_tokens: n(c?.daily_tokens), daily_usd: n(c?.daily_usd) };
  return Object.values(out).every((v) => v == null) ? null : out;
}

// Whether this window may create, change and delete bots: the PC app only (a linked phone or browser does not).
export const canManageBots = ({ mobile, access } = {}) => !mobile || Boolean(access?.bots);

// A date for <input type="datetime-local"> and for bots.reminders.create (AAAA-MM-DDTHH:MM, local time).
export function localWhen(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Who wrote a line of a bot's or a group's chat: the user, a bot (its name and icon) or Orb.
export function speakerOf(line) {
  if (line?.role === 'usuario') return { kind: 'user' };
  if (line?.role === 'bot') return { kind: 'bot', id: line.meta?.bot ?? null, name: line.meta?.name ?? '', icon: line.meta?.icon ?? '' };
  return { kind: 'system' };
}

// A live line (bot.message) into the list on screen: a new one at the end, a changed one (updated) in its place.
export function mergeLine(lines, msg) {
  if (!msg || msg.id == null) return lines;
  const i = lines.findIndex((l) => l.id === msg.id);
  if (i >= 0) { const next = [...lines]; next[i] = { ...lines[i], meta: msg.meta ?? lines[i].meta, ...(msg.updated ? {} : { body: msg.body }) }; return next; }
  if (msg.updated) return lines;
  return [...lines, { id: msg.id, role: msg.role, body: msg.body, meta: msg.meta ?? null, at: new Date().toISOString(), conversation_id: msg.conversation }];
}
