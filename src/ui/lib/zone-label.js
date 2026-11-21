// How an IANA time zone reads on screen: «Europa/Madrid» in Spanish (continent translated, «_» as a space).
// Only the shown text changes; the stored value stays the IANA name.
const CONTINENT_ES = {
  Europe: 'Europa', America: 'América', Africa: 'África', Asia: 'Asia', Atlantic: 'Atlántico', Pacific: 'Pacífico',
  Indian: 'Índico', Australia: 'Australia', Antarctica: 'Antártida', Arctic: 'Ártico'
};

export function zoneLabel(iana, locale = 'es') {
  const name = String(iana ?? '');
  if (!String(locale).toLowerCase().startsWith('es') || !name.includes('/')) return name;
  const [continent, ...rest] = name.split('/');
  return [CONTINENT_ES[continent] ?? continent, ...rest.map((part) => part.replaceAll('_', ' '))].join('/');
}

// The engine words a schedule's timing in lower case with a padded hour («cada lunes a las 09:00»); the list reads it as a sentence
// («Cada lunes a las 9:00»). Applied to the text only, never to what is stored.
export function whenLabel(when) {
  const text = String(when ?? '');
  return (text.charAt(0).toUpperCase() + text.slice(1)).replace(/\b0(\d:\d{2})\b/g, '$1');
}
