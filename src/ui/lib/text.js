// 3.2.1: a long text cut at a word, with «…» (notices were cut in the middle of one: «el agente dice que es para: «Par»).
export function cutWords(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max).replace(/[\s«“"'(]+\S*$/u, '').replace(/[\s,;:.-]+$/u, '');
  return `${cut || s.slice(0, max)}…`;
}
