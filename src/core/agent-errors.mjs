// Why an agent failed, in words the user understands: plan without access (e.g. Cursor's free plan cannot run its agent
// from the terminal), no login, a model the account cannot use, no network or the program missing. Quota and budget are
// handled apart (budget.mjs) because they only pause the account for a while.
const RULES = [
  { kind: 'plan', re: /(free plan|free tier|hobby plan|plan gratuito|upgrade (to|your)|requires? (an? )?(pro|paid|premium|subscription|business)|(pro|paid|premium) (plan|subscription) (is )?required|not (available|included) (on|in|with) your (current )?plan|subscription (is )?required|no active subscription|only available (on|for) (pro|paid)|payment required|\b402\b)/i,
    text: (who) => `tu plan de ${who} no permite usar su agente desde otras apps (con el plan gratuito no funciona: hace falta un plan de pago)`,
    advice: (who) => `Activa un plan de pago de ${who}, o desactívalo en «Agentes» para que no se le manden tareas. Puedes reintentar la tarea con otro agente.` },
  { kind: 'login', re: /(not logged in|not authenticated|unauthenticated|please (log ?in|sign in)|log ?in required|login required|sign in to continue|authentication (failed|required|error)|invalid (api key|token|credentials)|token (has )?expired|session expired|\b401\b|unauthori[sz]ed|run [`'"]?[\w-]+ login)/i,
    text: (who) => `${who} no tiene la sesión iniciada (o ha caducado)`,
    advice: (who) => `Ve a «Agentes» y pulsa «Iniciar sesión» en ${who}; después reintenta la tarea.` },
  { kind: 'model', re: /(unknown model|invalid model|model[^.\n]{0,60}(not (found|available|supported)|does not exist|isn't available|is not available)|(no|don't have) access to (the )?model|unsupported model)/i,
    text: (who) => `${who} no puede usar el modelo elegido con esta cuenta`,
    advice: () => 'Abre la tarea, pulsa «Cambiar modelo» y deja el modelo vacío (el predeterminado del agente) o elige otro.' },
  { kind: 'network', re: /(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network (error|is unreachable)|could not (connect|resolve)|failed to fetch|socket hang up)/i,
    text: (who) => `${who} no pudo conectarse a internet o a su servidor`,
    advice: () => 'Comprueba la conexión (y la VPN o el proxy, si usas) y reintenta la tarea.' },
  { kind: 'missing', re: /(spawn .* ENOENT|is not recognized as an internal or external command|command not found|no se reconoce como un comando)/i,
    text: (who) => `no encuentro el programa de ${who} en este equipo`,
    advice: (who) => `Instálalo desde «Agentes» (o comprueba la ruta de ${who}) y reintenta.` }
];

// output: what the agent printed (final answer + error output). Returns null when there is nothing recognisable.
export function explainFailure(who, output) {
  const text = String(output ?? '');
  for (const rule of RULES) if (rule.re.test(text)) return { kind: rule.kind, reason: rule.text(who), advice: rule.advice(who) };
  return null;
}
