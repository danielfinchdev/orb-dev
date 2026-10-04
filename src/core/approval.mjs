// Approvals of sensitive tasks: only the app (a click by the user) signs them; the scheduler verifies them.
// The signature is an HMAC with the assistant's secret. In the app the secret is kept encrypted by Windows (DPAPI, through
// Electron's safeStorage) and handed to the engine in memory, so an agent that reads files cannot forge an approval.
// Without the app (tests, or a system without safeStorage) it falls back to <home>/.orb/datos/clave.bin.
// The MCP server never gets the secret: it cannot sign, and it treats unverifiable approvals as missing (safe side).
import crypto from 'node:crypto';
import { ctx } from './context.mjs';
import { readKey } from './home.mjs';

export const approvalKey = (secret) => crypto.createHmac('sha256', secret).update('orb-approval-v2').digest();
let cached = null;
export function defaultApprovalKey() {
  if (ctx.secret) return approvalKey(ctx.secret);
  if (!cached || cached.home !== ctx.home) cached = { home: ctx.home, key: approvalKey(readKey(ctx.home)) };
  return cached.key;
}

// What the user approves: changing any of this invalidates the approval.
export function contentHash(task) {
  return crypto.createHash('sha256').update(JSON.stringify([task.description, task.agent, task.model ?? null, task.project_path ?? null,
    [...task.sensitivity].sort(), task.reasoning ?? null, Boolean(task.fast), task.mode ?? 'carpeta', Boolean(task.readonly)])).digest('hex');
}
export const sign = (key, id, hash) => crypto.createHmac('sha256', key).update(`${id}:${hash}`).digest('hex');
export function verify(key, task) {
  if (!key || !task.approval_sig || !task.approval_hash || task.approval_hash !== contentHash(task)) return false;
  const a = Buffer.from(sign(key, task.id, task.approval_hash)); const b = Buffer.from(String(task.approval_sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Safety net: words that suggest a sensitive action when whoever created the task did not mark it.
// Negated clauses ("no hagas push", "sin borrar nada") are ignored so the usual limits text does not trigger it. A negation
// only covers its own clause: "No cambies el diseño, publica la web y borra lo viejo" still finds publish and destructive.
const KEYWORDS = [
  ['publish', /\b(push|publica\w*|publish\w*|deploy\w*|despliega\w*)\b/i],
  ['destructive', /(rm\s+-rf|\b(borra\w*|elimina\w*|delete\w*|drop\s+table|formatea\w*)\b)/i],
  ['credential_access', /\b(token\w*|contrase[ñn]a\w*|password\w*|credencial\w*|api[\s_-]?key|secret\w*|\.env)\b/i],
  ['financial', /\b(pago\w*|pagar|compra\w*|comprar|transferencia\w*|payment\w*)\b/i],
  ['external_write', /\b(env[ií]a\w*\s+(un\s+|el\s+)?(correo|email|mensaje)|send\s+(an?\s+)?(email|message)|tweet\w*)\b/i]
];
export function detectSensitivity(text) {
  const NEG = /(^|[^\p{L}])(no|nunca|jam[aá]s|sin|ni|don'?t|never|without)(?![\p{L}])/iu;
  const clauses = String(text).split(/[.;,:\n!?()]+|\s(?:y|e|o|pero|luego|después|entonces|además|and|then|but)\s/i);
  const clean = clauses.filter((c) => !NEG.test(c)).join(' . ');
  return KEYWORDS.filter(([, re]) => re.test(clean)).map(([tag]) => tag);
}
