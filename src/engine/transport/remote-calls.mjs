// What a phone may call: the settings it receives, the call guard, notification previews and the path-free shaping of results.
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { REMOTE_METHODS } from '../../domain/security/permissions.mjs';

// The settings a phone gets: what the interface shows, without connector commands and secrets, login folders or paths
// of the agents' programs.
export function phoneConfig(c) {
  if (!c || typeof c !== 'object') return c;
  return {
    ...c,
    mcpServers: (c.mcpServers ?? []).map((m) => ({ name: m.name, enabled: m.enabled, agents: m.agents })),
    accounts: (c.accounts ?? []).map(({ home: _home, ...a }) => a),
    agents: Object.fromEntries(Object.entries(c.agents ?? {}).map(([k, a]) => { const { path: _path, ...rest } = a ?? {}; return [k, rest]; })),
    projectRoots: [], mobile: { enabled: c.mobile?.enabled, preview: pushPreview(c) }
  };
}

// The checks of a call coming from a phone or a browser: null when it may run, or why not. `uploadsDir`: the pictures
// that may go with it.
export function guardCall(board, method, params, { allowed = REMOTE_METHODS, uploadsDir = null } = {}) {
  if (!allowed.has(method)) return tr('msg.remote.pcOnly');
  if (params.permission === 'total') return tr('msg.remote.totalPcOnly');
  // A conversation the PC gave total access to is driven from the PC only.
  if (method.startsWith('sessions.') && method !== 'sessions.stop' && params.id !== undefined && board.one('SELECT permission FROM sessions WHERE id = ?', String(params.id))?.permission === 'total') return tr('msg.remote.totalConvPcOnly');
  // The HTML pages of such a conversation are not read from a phone either (the page names its chat in `session`).
  if ((method === 'htmlPages.get' || method === 'htmlPages.choose') && params.session !== undefined && board.one('SELECT permission FROM sessions WHERE id = ?', String(params.session))?.permission === 'total') return tr('msg.remote.totalConvPcOnly');
  // Pictures from a phone are only the ones it uploaded itself (never other files of the PC).
  if (params.images !== undefined) {
    if (!uploadsDir) return tr('msg.remote.ownImages');
    const dir = uploadsDir + path.sep;
    if (!Array.isArray(params.images) || params.images.some((f) => typeof f !== 'string' || !path.resolve(f).startsWith(dir) || !IMAGE_NAME.test(path.basename(f)))) return tr('msg.remote.ownImages');
  }
  return null;
}
// what a notification shows on a locked phone: 'all', 'chat' (the default) or 'none' (only «Tienes un mensaje
// nuevo»). 'all' and 'chat' show the same (there are no bots' messages to hide).
export const PREVIEWS = ['all', 'chat', 'none'];
export const pushPreview = (config) => (PREVIEWS.includes(config?.mobile?.preview) ? config.mobile.preview : 'chat');
// no folder of this PC reaches a phone or browser. A value that is one whole absolute path (a project's folder, a
// task's copy, a conversation's cwd…) goes as its place inside the assistant folder («proyectos/web/tienda»), or just
// its last part when it is outside; in any other text (a chat message, an activity line, an error, a key), only the assistant folder's own
// path is cut, written in any case and with either separator. Free text is never replaced whole (a message that
// starts with C:\ keeps its words). (Other paths an agent wrote in its text go as they are.)
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|mnt|media|var|tmp|opt|private|Volumes|srv|data)\/)/;
// Names the PC gives to what a phone uploads. Only pictures may go in `images`: the other kinds are stored but never
// resolve to a path there, so guardCall refuses them as images.
const IMAGE_NAME = /^\d+-[0-9a-f]{8}\.(png|jpg|webp|gif)$/;
// Fields of free text (what people and agents write): never replaced whole, only the assistant folder is cut.
const TEXT_FIELD = /^(body|text|title|description|message|note|notes|result|summary|content|prompt|question|answer|label|reason|error|detail|final|output|input|brief|elements)$/i;
// A whole value that is one path (a single line, no sentence in it), in any other field.
const isPath = (v) => ABSOLUTE.test(v) && v.length <= 400 && !/[\r\n]|[.,;:!?]\s/.test(v);
function placeOf(file) {
  const rel = ctx.home ? path.relative(ctx.home, file) : '';
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(/[\\/]+/).join('/') : file.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '…'; // either separator: a Windows path on any system
}
// The assistant folder inside a text: «<home>\x» → «x», the folder alone → «…» (in JSON its \ are doubled: matched too).
const homePattern = () => {
  if (!ctx.home) return null;
  const parts = path.resolve(ctx.home).split(/[\\/]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const SEP = '[\\\\/]+';
  return new RegExp(`${/^[\\/]/.test(path.resolve(ctx.home)) ? SEP : ''}${parts.join(SEP)}(?:(${SEP})|(?![\\w-]|\\.\\w))`, 'gi');
};
const cutHome = (text, re) => (re ? text.replace(re, (m, sep) => (sep ? '' : '…')) : text);
// The approval fingerprint and its signature stay on the PC: the phone approves with previewHash, so nothing it receives
// (answers or pushed events, at any depth) carries them.
const PC_ONLY_KEYS = new Set(['approval_hash', 'approval_sig']);
export function withoutPaths(value, depth = 0, key = '', re = homePattern()) {
  if (typeof value === 'string') return !TEXT_FIELD.test(key) && isPath(value) ? placeOf(value) : cutHome(value, re);
  if (!value || typeof value !== 'object') return value;
  if (depth > 12) { try { return JSON.parse(cutHome(JSON.stringify(value, (k, v) => (PC_ONLY_KEYS.has(k) ? undefined : v)), re)); } catch { return null; } }
  if (Array.isArray(value)) return value.map((v) => withoutPaths(v, depth + 1, key, re));
  return Object.fromEntries(Object.entries(value).filter(([k]) => !PC_ONLY_KEYS.has(k)).map(([k, v]) => [cutHome(k, re), withoutPaths(v, depth + 1, k, re)]));
}

// What a call from outside gets back: the settings without secrets, and no folder of this PC (its home, the assistant's
// paths; any other path as its place in the assistant folder).
export function shapeResult(method, result) {
  // The whiteboard comes back to the PC as it went (whiteboard.save): only its attachments are cut.
  if (method === 'whiteboard.load' && result) return { ...result, attachments: withoutPaths(result.attachments) };
  // The phone approves the fingerprint of the full description: say when the folder cut above changed the text it shows.
  if (method === 'tasks.get' && result && typeof result.description === 'string') {
    const re = homePattern();
    // user_asked is part of the same fingerprint, so a cut there also counts.
    const cut = (v) => Array.isArray(v) ? v.some(cut) : typeof v === 'string' && Boolean(re) && cutHome(v, re) !== v;
    return { ...withoutPaths(result), descriptionCut: cut(result.description) || cut(result.user_asked) };
  }
  if (method !== 'app.state' || !result) return withoutPaths(result);
  const { home: _home, paths: _paths, ...rest } = result;
  const activeProject = rest.activeProject ? (({ path: _path, ...p }) => p)(rest.activeProject) : rest.activeProject;
  return withoutPaths({ ...rest, activeProject, config: phoneConfig(rest.config) });
}

// A free text as a phone receives it (the assistant folder cut), to compare what the phone says it saw with what the PC holds.
export const phoneText = (text) => (typeof text === 'string' ? cutHome(text, homePattern()) : text);

export { IMAGE_NAME };

// A file name from the phone made safe to show and to log: no folders or drives, no characters Windows refuses, no
// reserved device names, no invisible or direction-changing characters, bounded length. Never used to build a path.
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\x00-\x1f\x7f-\x9f<>:"|?*\\/]/g;
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
export function sanitizeUploadName(name, fallback = 'archivo') {
  if (typeof name !== 'string') return fallback;
  let n = name.normalize('NFC').replace(INVISIBLE, '');
  n = n.split(/[\\/]/).pop(); // last part only: drops folders, drives (C:\x) and ../
  n = n.replace(BAD_CHARS, '').replace(/^[\s.]+|[\s.]+$/g, '');
  const dot = n.lastIndexOf('.');
  let base = dot > 0 ? n.slice(0, dot) : n;
  let ext = dot > 0 ? n.slice(dot + 1).replace(/\s+$/, '') : '';
  if (dot === 0) { base = ''; ext = ''; }
  base = [...base].slice(0, 80).join('').replace(/[\s.]+$/, '');
  ext = [...ext].slice(0, 10).join('');
  if (!base || /^\.+$/.test(base)) base = fallback;
  if (RESERVED_NAME.test(base)) base = `_${base}`;
  return ext ? `${base}.${ext}` : base;
}

// Only pictures are announced and kept: `images` is the one place a phone can cite an upload and guardCall takes only
// pictures there, so a PDF or text file would upload fine and then fail on send with a 403.
export const UPLOAD_TYPES = Object.freeze(['png', 'jpg', 'webp', 'gif']);
const TEXT_KINDS = new Set(['txt', 'md', 'csv', 'json']);
// What an upload really is, from its first bytes (never from a name): a picture, a PDF or plain UTF-8 text; null for
// anything else. `hint` is the extension the client says (only to tell md/csv/json apart inside plain text).
// Text that starts like a script or markup (#!, <…) is refused so nothing renderable is kept; real executables carry
// NUL/control bytes and are refused above.
export function sniffUpload(b, hint = '') {
  if (b.length < 4) return null;
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return null; }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) return null;
  const head = text.replace(/^﻿/, '').trimStart();
  if (/^(#!|<)/.test(head)) return null;
  const want = String(hint).toLowerCase();
  if (want === 'json') { try { JSON.parse(text); return 'json'; } catch { return 'txt'; } }
  return TEXT_KINDS.has(want) ? want : 'txt';
}
