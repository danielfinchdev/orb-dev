// 3.2: the title of a conversation. At once, a short one taken from the first message (what the user asked, without
// greetings or «quiero que»); then the engine asks the lightest model for a better one (engine/titles.mjs).

const FILLER = [
  /^(hola|buenas|buenos días|buenas tardes|oye|hey|hi|hello)[,!.\s]+/i,
  /^(por favor|please)[,\s]+/i,
  /^(quiero|quisiera|necesito|me gustaría|i want|i need|i'd like)( que)?\s+/i,
  /^(puedes|podrías|podéis|can you|could you)\s+/i,
  /^(ayúdame a|ayudame a|help me)\s+/i,
  /^(vamos a|let's)\s+/i
];

// «Quiero que me hagas una web de recetas con buscador. Que sea bonita» → «Web de recetas con buscador».
export function titleFrom(text, { words = 6, chars = 48 } = {}) {
  let s = String(text ?? '')
    .replace(/@\w+:[\w.-]+/g, ' ') // mention tokens (@tarea:12)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\p{Extended_Pictographic}️?/gu, ' ')
    .replace(/[`*_#>]/g, ' ')
    .split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  for (let i = 0; i < 3; i++) for (const re of FILLER) s = s.replace(re, '');
  s = s.split(/(?<=[.!?])\s+/)[0] ?? s; // the first sentence
  for (let i = 0; i < 3; i++) for (const re of FILLER) s = s.replace(re, '');
  for (let i = 0; i < 3; i++) s = s.replace(/^(que|me|nos|to)\s+/i, '');
  s = s.replace(/^(hagas|crees|hagáis|montes|make|build|create)\s+(\p{L}+\s+)?/iu, (m, verb, article) => (article && /^(un|una|unos|unas|a|an)\s+$/i.test(article) ? '' : article ?? ''));
  // Not starting with «un» / «una» («Un Hello World 3D…» → «Hello World 3D…»).
  s = s.replace(/^(un|una|unos|unas|an?)\s+/i, '');
  s = s.replace(/[\s.,;:!?¿¡"'«»()[\]]+$/g, '').replace(/[,\s]+(por favor|porfa|please|gracias|thanks)$/i, '').replace(/^[\s"'«»¿¡]+/, '').replace(/\s+/g, ' ').trim();
  const list = s.split(' ').slice(0, words);
  let out = '';
  for (const w of list) { if ((out ? `${out} ${w}` : w).length > chars) break; out = out ? `${out} ${w}` : w; }
  // Not ending on a little word («… con una»).
  for (let i = 0; i < 3; i++) out = out.replace(/\s+(de|del|con|y|e|o|a|al|en|para|por|un|una|unos|unas|el|la|los|las|que|the|of|with|and|to|for|a|an|in)$/i, '');
  out = out.replace(/[\s.,;:-]+$/, '');
  return out ? out[0].toUpperCase() + out.slice(1) : '';
}

// What a model answered as a title, cleaned: one line, no quotes, no final full stop, no «Título:».
export function cleanTitle(answer, { chars = 60 } = {}) {
  let s = String(answer ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  s = s.replace(/^(t[ií]tulo|title)\s*:\s*/i, '').replace(/[.。]+$/, '').replace(/^["'«»*`]+|["'«»*`]+$/g, '').replace(/[.。]+$/, '').trim();
  if (!s || s.length > chars || /[{}<>]/.test(s)) return '';
  return s[0].toUpperCase() + s.slice(1);
}
