// Small helpers that keep the daemon alive and its outputs clean: bounded log reads, log rotation, secret redaction, text normalisation.
import fs from 'node:fs';

export const MAX_DESCRIPTION = 12000;
export const MAX_DEP_RESULT = 1500;

// Last `bytes` bytes of a file as text ('' if it does not exist). Never reads the whole file.
export function tailFile(file, bytes = 20000) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ } }
}

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
const SECRET_FILES = [/(^|\/)BITACORA\.md$/i, /(^|\/)\.env(\..+)?$/i, /\.(pem|key|pfx|p12|jks|keystore|db|sqlite3?|kdbx|ppk|asc|gpg)$/i,
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
// Accepts the -z output (preferred) or plain lines (old callers and tests).
export function secretFiles(porcelain) {
  const text = String(porcelain ?? '');
  const files = text.includes('\0') ? porcelainPaths(text) : text.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).replace(/^"|"$/g, '').replace(/^.* -> /, '').replace(/\\/g, '/'));
  return files.filter(isSecretPath);
}
