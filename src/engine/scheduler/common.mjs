// The scheduler's small helpers, shared by its parts (index.mjs and the files beside it).

import fs from 'node:fs';
import path from 'node:path';
import { ctx } from '../../platform/context.mjs';
import { groupOf } from '../../domain/projects/projects.mjs';
import { localeOf } from '../../shared/i18n.mjs';
import { assistantName } from '../../domain/tasks/board.mjs';
import { git } from '../../platform/git.mjs';
import { accountLabel } from '../../domain/usage/accounts.mjs';
import { adapter } from '../../agents/index.mjs';


// 2.7: a task of a multiplatform project knows its sister projects and the shared folder (API, design, texts, images).
export const groupNote = (board, project) => {
  const g = groupOf(board, project); if (!g) return '';
  return `\n- Este proyecto es parte del grupo multiplataforma «${g.name}» (${g.members.map((m) => m.name).join(', ')}). Lo que compartan (API, datos, diseño, textos, imágenes) está en la carpeta común ${g.common}: síguela y, si hace falta cambiar algo compartido, dilo en tu result para que ${assistantName()} lo coordine con los demás.`;
};
// 3.2.1: pieces built in parallel did not fit (.balloon-letter against .game-letter, 5 weapons against 4, a key nobody
// made): when the base left a CONTRATO.md, every piece that writes reads it first and checks its names against it.
export const contractNote = (cwd, task) => (!task.readonly && cwd && fs.existsSync(path.join(cwd, 'CONTRATO.md'))
  ? '\n- Hay un CONTRATO.md en la carpeta: léelo al empezar y respeta exactamente sus nombres (archivos, ids, clases, data-*, funciones, datos comunes como armas o niveles, y teclas). Antes de terminar, comprueba que lo tuyo coincide; si el contrato no basta o tienes que cambiar algo de él, avisa con orb_send_message a la otra pieza y dilo en tu result.'
  : '');

// 3.8.3: how often the leftovers still pending (their folder was busy) are looked at again.
export const LEFTOVERS_RETRY_MS = Number(process.env.ORB_LEFTOVERS_RETRY_MS) || 15_000;
export const hhmm = (ms) => new Date(ms).toLocaleTimeString(localeOf(ctx.config.language), { hour: '2-digit', minute: '2-digit' });
export const STATUS_ES = { done: 'hecha', failed: 'fallida', blocked: 'bloqueada', cancelled: 'cancelada' };
export const label = (agent) => { try { return adapter(agent).label; } catch { return agent; } };
// 3.2.1: who did a task in words the user knows: the account's own name when the agent has several (Codex Go, Codex Pro).
export const whoRan = (task) => { const acc = task.run_account; const name = acc ? accountLabel(acc) : null; return name && name !== acc ? name : label(task.assigned_to); };
export const remotesOf = (dir) => git(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes').stdout;
export const mainStatus = (dir) => { const r = git(dir, 'status', '--porcelain', '-uall'); return r.status === 0 ? r.stdout : null; };

// Adds the methods of a part's class to the Scheduler, as class methods (not enumerable), so the class reads as one.
export function mixin(target, ...parts) {
  for (const part of parts) for (const key of Object.getOwnPropertyNames(part.prototype)) if (key !== 'constructor') Object.defineProperty(target.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
}
