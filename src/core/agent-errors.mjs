// Why an agent failed, in words the user understands: plan without access (e.g. Cursor's free plan cannot run its agent
// from the terminal), no login, a model the account cannot use, no network or the program missing. Quota and budget are
// handled apart (budget.mjs) because they only pause the account for a while.
import { translate } from './i18n.mjs';

const RULES = [
  { kind: 'plan', re: /(free plan|free tier|hobby plan|plan gratuito|upgrade (to|your)|requires? (an? )?(pro|paid|premium|subscription|business)|(pro|paid|premium) (plan|subscription) (is )?required|not (available|included) (on|in|with) your (current )?plan|subscription (is )?required|no active subscription|only available (on|for) (pro|paid)|payment required|\b402\b)/i,
    text: 'msg.agent.planText',
    advice: 'msg.agent.planAdvice' },
  { kind: 'login', re: /(not logged in|not authenticated|unauthenticated|please (log ?in|sign in)|log ?in required|login required|sign in to continue|authentication (failed|required|error)|invalid (api key|token|credentials)|api key is missing|api key (is )?not (configured|set)|auth(entication)? required|missing credentials|no credentials|log in with google|token (has )?expired|session expired|\b401\b|unauthori[sz]ed|run [`'"]?[\w-]+ login)/i,
    text: 'msg.agent.loginText',
    advice: 'msg.agent.loginAdvice' },
  { kind: 'model', re: /(unknown model|invalid model|model[^.\n]{0,60}(not (found|available|supported)|does not exist|isn't available|is not available)|(no|don't have) access to (the )?model|unsupported model)/i,
    text: 'msg.agent.modelText',
    advice: 'msg.agent.modelAdvice' },
  { kind: 'network', re: /(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network (error|is unreachable)|could not (connect|resolve)|failed to fetch|socket hang up)/i,
    text: 'msg.agent.networkText',
    advice: 'msg.agent.networkAdvice' },
  { kind: 'missing', re: /(spawn .* ENOENT|is not recognized as an internal or external command|command not found|no se reconoce como un comando)/i,
    text: 'msg.agent.missingText',
    advice: 'msg.agent.missingAdvice' }
];

// output: what the agent printed (final answer + error output). Returns null when there is nothing recognisable.
export function explainFailure(who, output, lang = 'es') {
  const text = String(output ?? '');
  for (const rule of RULES) if (rule.re.test(text)) return { kind: rule.kind, reason: translate(lang, rule.text, { who }), advice: translate(lang, rule.advice, { who }) };
  return null;
}
