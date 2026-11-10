// Approvals of sensitive tasks: only the app (a click by the user) signs them; the scheduler verifies them.
// The signature is an HMAC with a key made from this PC's secret. In the app the secret stays sealed by Windows in Rust
// (src-tauri/vault/src/machine.rs) and the engine holds only this key in memory, so an agent that reads files cannot
// forge an approval. Without the app (tests, or a system without that sealing) it comes from <home>/core/datos/clave.bin.
// The MCP server never gets the secret: it cannot sign, and it treats unverifiable approvals as missing (safe side).
import crypto from 'node:crypto';
import { ctx } from '../../platform/context.mjs';
import { machineKeys } from '../../platform/keys.mjs';

let cached = null;
export function defaultApprovalKey() {
  if (ctx.keys) return ctx.keys.approval;
  if (!cached || cached.home !== ctx.home) cached = { home: ctx.home, key: machineKeys().approval };
  return cached.key;
}

// What the user approves: changing any of this invalidates the approval.
// 3.8.3: and the task's permission level when it is «Preguntar», and what the user's own message asked for (a task that
// may push because the user said «súbelo»): added only when set, so the approvals signed before keep matching.
export function contentHash(task) {
  const extra = [];
  if (task.autonomy === 'preguntar') extra.push('preguntar');
  const asked = asList(task.user_asked);
  if (asked.length) extra.push([...asked].sort());
  return crypto.createHash('sha256').update(JSON.stringify([task.description, task.agent, task.model ?? null, task.project_path ?? null,
    [...task.sensitivity].sort(), task.reasoning ?? null, Boolean(task.fast), task.mode ?? 'carpeta', Boolean(task.readonly), ...(extra.length ? [extra] : [])])).digest('hex');
}
const asList = (v) => { if (Array.isArray(v)) return v; try { const j = JSON.parse(v ?? '[]'); return Array.isArray(j) ? j : []; } catch { return []; } };
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
// 3.2.1: the one rule for deletions the user asked for (the same whether the assistant marked the task as destructive or
// the keyword net found it): no separate approval when the user's current request asks to delete (a clause that is not
// negated) and names every file the task's deleting sentences name. A task that names no file (an app "where notes can be
// deleted") only needs the request to ask for it. Anything else waits for the click.
const FILE_RE = /(?:^|[\s«"'`(\[/\\])((?:[\w-][\w.-]*[\\/])*[\w-][\w.-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?=$|[\s»"'`),;:!?\]]|\.(?:\s|$))/g;
const DELETE_RE = /(rm\s+-rf|\b(borra\w*|borr[eé]\w*|elimina\w*|elimin[eé]\w*|delete\w*|remove\s+(the\s+)?files?|drop\s+table|formatea\w*)\b)/i;
export const filesIn = (text) => [...String(text ?? '').matchAll(FILE_RE)].map((m) => m[1].replace(/\\/g, '/').split('/').pop().toLowerCase());
export function filesToDelete(taskText) {
  const sentences = String(taskText ?? '').split(/(?<=[.!?;])\s+|\n+/);
  return [...new Set(sentences.filter((s) => DELETE_RE.test(s)).flatMap(filesIn))];
}
export function deletionAskedByUser(userText, taskText) {
  if (!detectSensitivity(userText).includes('destructive')) return false;
  const named = new Set(filesIn(userText));
  return filesToDelete(taskText).every((f) => named.has(f));
}

// The text without its negated clauses ("no hagas push", "sin borrar nada").
const affirmed = (text) => {
  const NEG = /(^|[^\p{L}])(no|nunca|jam[aá]s|sin|ni|don'?t|never|without)(?![\p{L}])/iu;
  const clauses = String(text ?? '').split(/[.;,:\n!?()]+|\s(?:y|e|o|pero|luego|después|entonces|además|and|then|but)\s/i);
  return clauses.filter((c) => !NEG.test(c)).join(' . ');
};
export function detectSensitivity(text) {
  const clean = affirmed(text);
  return KEYWORDS.filter(([, re]) => re.test(clean)).map(([tag]) => tag);
}

// 3.8.3 («Auto»): what the user's OWN message asks for in so many words, which «Auto» then does without another click:
// ['publish'] for «súbelo», «haz push», «publica», «despliega»… (not negated). Only ever called with the user's text (a
// chat turn the user typed, or board.currentRequest), never with an agent's: an agent cannot grant itself a push.
// Only orders to the agent (imperatives and «git push»), so «añade notificaciones push» or «un botón para publicar» do not
// count.
const PUBLISH_ASK = /(^|[^\p{L}])(git\s+push|(?:haz|hacer|hagas|haga)\s+(?:el\s+|un\s+)?push|push(?:[eé][aá]\w*|ear)|push\s+(?:a|al|to|it|the|los|el)|publ[ií]ca(?:lo|la|los|las)?|publish(?:\s+it)?|deploy(?:\s+it)?|despl[ií]ega(?:lo|la)?|s[uú]bel[oa]s?|sube(?:lo|los)?\s+(?:los\s+cambios|el\s+c[oó]digo|a\s+(?:github|gitlab|git|origin|remoto|main|master)|al\s+(?:repo\w*|remoto)))(?![\p{L}])/iu;
export function askedByUser(userText) {
  return PUBLISH_ASK.test(affirmed(userText)) ? ['publish'] : [];
}
