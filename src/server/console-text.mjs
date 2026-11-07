// 3.5, Orb en la terminal: plain ANSI drawing (colors, wrapping, a spinner) that works in Windows Terminal, the
// Windows console and Linux terminals. No colors when the output is not a terminal or NO_COLOR is set.
import { createT } from '../core/i18n.mjs';

export function langOf(env = process.env) {
  const pick = env.ORB_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || (() => { try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return ''; } })();
  return /^en/i.test(String(pick)) ? 'en' : 'es';
}

export function painter({ stream = process.stdout, env = process.env } = {}) {
  const on = Boolean(stream.isTTY) && !env.NO_COLOR && env.TERM !== 'dumb';
  const wrapIn = (open, close = 39) => (s) => (on ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
  return {
    on,
    bold: wrapIn(1, 22), dim: wrapIn(2, 22), italic: wrapIn(3, 23),
    red: wrapIn(31), green: wrapIn(32), yellow: wrapIn(33), blue: wrapIn(34), magenta: wrapIn(35), cyan: wrapIn(36), gray: wrapIn(90)
  };
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
export const visible = (s) => String(s).replace(ANSI, '');

// Wraps text to `width` columns by words; code blocks (``` … ```) and indented lines are left as they are.
export function wrap(text, width = 80, indent = '') {
  const w = Math.max(20, width - indent.length);
  const out = []; let code = false;
  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) code = !code;
    if (code || /^```/.test(line) || /^(\s{4}|\t)/.test(line) || visible(line).length <= w) { out.push(indent + line); continue; }
    const lead = (line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?/) ?? [''])[0];
    const pad = ' '.repeat(visible(lead).length);
    let cur = lead;
    for (const word of line.slice(lead.length).split(/\s+/).filter(Boolean)) {
      const sep = cur.length > lead.length ? ' ' : '';
      if (visible(cur).length + sep.length + visible(word).length > w && cur.trim()) { out.push(indent + cur); cur = pad + word; }
      else cur += sep + word;
    }
    if (cur.trim()) out.push(indent + cur);
  }
  return out.join('\n');
}

export const columns = (stream = process.stdout) => Math.min(Math.max(stream.columns || 80, 40), 160);

// A spinner on one line of a terminal (nothing when it is not one). start(label) · stop() clears its line.
export function spinner(stream = process.stdout, { ascii = process.platform === 'win32' && !process.env.WT_SESSION } = {}) {
  const frames = ascii ? ['|', '/', '-', '\\'] : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let timer = null; let i = 0; let label = '';
  const draw = () => { stream.write(`\r\x1b[2K\x1b[36m${frames[i = (i + 1) % frames.length]}\x1b[39m \x1b[2m${label}\x1b[22m`); };
  return {
    get running() { return Boolean(timer); },
    start(text) { if (!stream.isTTY) return; label = text; if (!timer) { draw(); timer = setInterval(draw, 90); timer.unref?.(); } },
    stop() { if (!timer) return; clearInterval(timer); timer = null; stream.write('\r\x1b[2K'); }
  };
}

// «hace 5 min» / «5 min ago» from an ISO date.
export function ago(iso, t) {
  const ms = Date.now() - Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return '—';
  const min = Math.round(ms / 60_000);
  if (min < 1) return t('time.now');
  if (min < 60) return t('time.minAgo', { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return t('time.hAgo', { n: h });
  return t('term.daysAgo', { n: Math.round(h / 24) });
}

export const translator = (env = process.env) => createT(langOf(env));
