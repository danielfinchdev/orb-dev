// The recovery code as typed: with or without dashes and spaces, in any case, it is the same 32 characters; any other
// text (a phrase the user chose) is used as written (NFKC, trimmed). The vault applies the same rule to what it receives
// (src-tauri/vault/src/vault/code.rs › normalize); test/fixtures/recovery-code-vectors.json holds the cases both pass.
export function normalizeCode(text) {
  const s = String(text ?? '').normalize('NFKC').trim();
  const compact = s.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z2-9]{32}$/.test(compact) && /^[A-Za-z2-9\s-]+$/.test(s) ? compact : s;
}
