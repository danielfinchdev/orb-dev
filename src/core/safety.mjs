// Small helpers that keep the daemon alive and its outputs clean: log rotation, secret redaction, text normalisation.
import fs from 'node:fs';

export const MAX_DESCRIPTION = 12000;
export const MAX_DEP_RESULT = 4000; // 3.1: a dependency's whole summary (1500 cut the "how to test it" part)

// Keeps one previous generation (file.1) once a log passes `max` bytes.
export function rotateIfBig(file, max = 10 * 1024 * 1024) {
  try {
    if (fs.statSync(file).size <= max) return false;
    fs.rmSync(`${file}.1`, { force: true });
    fs.renameSync(file, `${file}.1`);
    return true;
  } catch { return false; }
}

// One line, bounded: for anything an agent or a creator controls that ends up in BITACORA.md or a notice.
export const oneLine = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// 3.2.1: times written for people (names of backups, PIZARRA.md) in the PC's local time, not UTC.
const pad = (n) => String(n).padStart(2, '0');
export const localStamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
export const localText = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
// A size people can read: KB below 1 MB (never "0 MB" for 445 KB), MB with one decimal below 10 MB.
export function sizeText(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1048576) return `${Math.max(b ? 1 : 0, Math.round(b / 1024))} KB`;
  const mb = b / 1048576;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE|PGP[A-Z ]*)-----[\s\S]*?(?:-----END [A-Z ]*-----|$)/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxai-[A-Za-z0-9]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g
];
export function redactSecrets(text) {
  return SECRET_PATTERNS.reduce((out, re) => out.replace(re, '[secreto oculto]'), String(text ?? ''));
}

// Files that must never be committed automatically (a task may create them; the user decides what to do).
// BITACORA.md is private: it must never travel in a task branch.
const SECRET_FILES = [/(^|\/)BITACORA\.md$/i, /(^|\/)\.env(\..+)?$/i, /\.env$/i, /\.(pem|key|pfx|p12|jks|keystore|db|sqlite3?|kdbx|ppk|asc|gpg)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)[^/]*$/i, /(^|\/)\.?(credentials|client_secrets?|service[-_]?account[^/]*|panel-token|sessions|auth|token|tokens|secrets?)\.json$/i, /(^|\/)\.claude\.json$/i, /(^|\/)clave\.bin$/i,
  /(^|\/)\.(npmrc|pypirc|netrc|git-credentials|htpasswd|dockercfg)$/i, /(^|\/)\.docker\/config\.json$/i, /(^|\/)\.(aws|ssh|gnupg|codex[^/]*|claude)\//i, /\.(token|secret)$/i];
export const isSecretPath = (file) => { const f = String(file ?? '').replace(/\\/g, '/'); return SECRET_FILES.some((re) => re.test(f)) && !/(^|\/)\.env\.example$/i.test(f); };

// Paths from "git status --porcelain -z" (NUL separated: no quoting or escaping, so names with spaces, quotes or accents are exact).
// A rename entry carries the old path in the next field, which is skipped.
export function porcelainPaths(z) {
  const parts = String(z ?? '').split('\0'); const out = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]; if (entry.length < 4) continue;
    out.push(entry.slice(3).replace(/\\/g, '/'));
    if (/^[RC]/.test(entry)) i++;
  }
  return out;
}
// 3.2.1: secrets by content, not only by file name (a key pasted into config-prueba.env or notas.txt). The same patterns
// as redactSecrets, plus a "KEY = value" assignment whose value looks like a real key (letters and digits, 16+ characters,
// no code around it), so TOKEN_LIMIT = 123456789012 or apiKey: process.env.API_KEY do not count.
const CONTENT_PATTERNS = SECRET_PATTERNS.map((re) => new RegExp(re.source, re.flags.replace('g', '')));
const ASSIGN_RE = /\b[A-Za-z0-9_]*(?:api_?key|secret|token|password|passwd)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+/=]{16,})/i;
const PLACEHOLDER = /^(x{4,}|your|tu_|example|changeme|placeholder|dummy|test|fake)/i;
export function looksSecretText(text) {
  const t = String(text ?? '');
  if (CONTENT_PATTERNS.some((re) => re.test(t))) return true;
  const m = ASSIGN_RE.exec(t);
  return Boolean(m && /[A-Za-z]/.test(m[1]) && /\d/.test(m[1]) && !PLACEHOLDER.test(m[1]));
}
// Files whose ADDED lines look like a secret, from a unified diff ("git diff --cached -U0" or "git log -p"). Removed
// lines do not count (taking a key out must always be possible), nor .env.example files. At most 5 MB are read.
export function secretsInDiff(diff) {
  const hits = new Set(); let file = null;
  for (const line of String(diff ?? '').slice(0, 5_000_000).split('\n')) {
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).replace(/^"|"$/g, '');
      file = name === '/dev/null' ? null : name.replace(/^b\//, '');
      continue;
    }
    if (file && line.startsWith('+') && !/(^|\/)[^/]*\.env\.example$/i.test(file) && looksSecretText(line.slice(1))) hits.add(file);
  }
  return [...hits];
}
// The files of the index (what the next commit would save) with a secret in their added lines. `git` is workspace's git().
export const stagedSecrets = (dir, git) => secretsInDiff(git(dir, '-c', 'core.quotePath=false', 'diff', '--cached', '-U0', '--no-color', '--no-ext-diff').stdout);

// Accepts the -z output (preferred) or plain lines (old callers and tests).
export function secretFiles(porcelain) {
  const text = String(porcelain ?? '');
  const files = text.includes('\0') ? porcelainPaths(text) : text.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).replace(/^"|"$/g, '').replace(/^.* -> /, '').replace(/\\/g, '/'));
  return files.filter(isSecretPath);
}
