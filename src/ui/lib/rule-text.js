// A rule's text for reading (the one-line summary of the list): the template's variables told with their values and its
// conditions dropped, so «{orb} guardó una foto» reads «Orb guardó una foto». The editor keeps the text as written.
const PLAIN = { tarea: 'la tarea', carpeta: 'la carpeta', rama: 'la rama' };

export function readableRule(texto, { orb = 'Orb', usuario = '', es = true } = {}) {
  const user = usuario || (es ? 'el usuario' : 'the user');
  return String(texto ?? '')
    .replace(/\{(?:\?[a-z_]+|:|\/|norma:[a-z0-9-]{1,60})\}/g, '')
    .replace(/\{(orb|usuario|del_usuario|[a-z_]+)\}/g, (_, name) => {
      if (name === 'orb') return orb;
      if (name === 'usuario') return user;
      if (name === 'del_usuario') return usuario ? (es ? `de ${usuario}` : `${usuario}'s`) : (es ? 'del usuario' : "the user's");
      return PLAIN[name] ?? '';
    })
    .replace(/[ \t]{2,}/g, ' ');
}

// The short line of a rule in the list when it has no description of its own: the first sentence of its text, said plainly.
// A heading in capitals («PREGUNTAS CON OPCIONES: …») is dropped, a text written all in capitals is lowered, and
// identifiers of the tools (orb_ask, depends_on) are left out. `line` is the rule's first line of prose (ruleSummary).
export function ruleBlurb(line, max = 110) {
  let text = String(line ?? '').replace(/\s+/g, ' ').trim();
  const label = text.match(/^([^:.]{1,60}):\s+(.+)$/);
  if (label && label[1] === label[1].toUpperCase() && /\p{L}/u.test(label[1])) text = label[2];
  text = text
    .replace(/\s*\(\s*\b[a-z]+(?:_[a-z0-9]+)+\b\s*\)/g, '')
    .replace(/\b(?:con|usa|usar|llama a|llamar a|mediante)\s+\b[a-z]+(?:_[a-z0-9]+)+\b/gi, '')
    .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const sentence = text.match(/^.*?[.!?…](?=\s|$)/);
  text = (sentence ? sentence[0] : text).trim();
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) text = text.toLowerCase();
  text = text.replace(/\p{L}/u, (c) => c.toUpperCase());
  if (text.length > max) text = `${text.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:.\s]+$/, '')}…`;
  return text;
}
