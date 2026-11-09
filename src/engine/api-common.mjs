// 3.6: the checks every part of the engine's API shares (split out of api.mjs, unchanged).
import path from 'node:path';
import { tr } from '../platform/context.mjs';

// Names of the fields in the messages (Spanish as they were; the key is the Spanish word).
export const fld = (name) => { const key = `msg.api.f.${String(name).replace(/ /g, '_')}`; const t = tr(key); return t === key ? name : t; };
export const fail = (message) => { const e = new Error(message); e.userFacing = true; throw e; };
export const str = (v, name, max = 2000, { optional = false } = {}) => {
  if (v == null || v === '') { if (optional) return ''; fail(tr('msg.api.missing', { name: fld(name) })); }
  if (typeof v !== 'string') fail(tr('msg.api.invalid', { name: fld(name) }));
  if (v.length > max) fail(tr('msg.api.tooLong', { name: fld(name), max }));
  return v;
};
export const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) fail(tr('msg.api.invalid', { name: fld(name) })); return n; };
export const oneOf = (v, list, name, fallback) => { if (v == null || v === '') return fallback; if (!list.includes(v)) fail(tr('msg.api.invalid', { name: fld(name) })); return v; };
export const DECISION = ['allow', 'always', 'deny'];
export const images = (list) => {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 10 || list.some((f) => typeof f !== 'string' || !path.isAbsolute(f))) fail(tr('msg.api.badAttachments'));
  return list;
};
