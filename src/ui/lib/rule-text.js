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
