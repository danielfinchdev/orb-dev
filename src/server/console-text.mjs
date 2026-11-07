// The text of orb-server's commands: plain ANSI colours (none when the output is not a terminal or NO_COLOR is set) and
// the language of the console.
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

export const translator = (env = process.env) => createT(langOf(env));
