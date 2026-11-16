// Normas: every change of a rule or a rail, from the window. The password comes first, always: the engine refuses the
// call without its token, and a cancelled password changes nothing (the call resolves undefined). Errors the engine
// says in plain words (userFacing) are shown by notifyError; the caller reloads the lists after a change.
import { call, act } from '@/lib/store.js';
import { unlockCore } from '@/lib/core-access.js';
import { ruleAction, railAction, RULE_METHOD } from '@/lib/rules-access.js';

async function guarded(action, method, params, ok) {
  const unlock = await unlockCore(action);
  if (!unlock) return undefined;
  return act(call(method, { ...params, unlock }), ok);
}

// op: create | save | pause | resume | delete. rule: the rule it is about (to tell a shipped one from your own).
export const changeRule = (op, rule, fields = {}, ok) => guarded(ruleAction(op, rule), RULE_METHOD[op], rule?.id ? { id: rule.id, ...fields } : fields, ok);
export const restoreRules = (ok) => guarded(ruleAction('restoreDefaults'), RULE_METHOD.restoreDefaults, {}, ok);
// enabled and/or values of one rail, in one write.
export const changeRail = (id, change, ok) => guarded(railAction(), 'rails.set', { id, ...change }, ok);
