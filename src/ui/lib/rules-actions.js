// Normas: every change of a rule or a rail, from the window. The password comes first, always: the engine refuses the
// call without its token, and a cancelled password changes nothing (the call resolves undefined). Errors the engine
// says in plain words (userFacing) are shown by notifyError; the caller reloads the lists after a change.
// A dialog that already asked the password in line hands over its token (`unlock`); the call is the same one.
import { call, act } from '@/lib/store.js';
import { unlockCore } from '@/lib/core-access.js';
import { ruleAction, railAction, RULE_METHOD } from '@/lib/rules-access.js';

async function guarded(action, method, params, ok, given = null) {
  const unlock = given ?? await unlockCore(action);
  if (!unlock) return undefined;
  return act(call(method, { ...params, unlock }), ok);
}

// op: create | save | pause | resume | delete. rule: the rule it is about (to tell a shipped one from your own).
export const changeRule = (op, rule, fields = {}, ok, unlock = null) => guarded(ruleAction(op, rule), RULE_METHOD[op], rule?.id ? { id: rule.id, ...fields } : fields, ok, unlock);
export const restoreRules = (ok, unlock = null) => guarded(ruleAction('restoreDefaults'), RULE_METHOD.restoreDefaults, {}, ok, unlock);
// enabled and/or values of one rail, in one write.
export const changeRail = (id, change, ok, unlock = null) => guarded(railAction(), 'rails.set', { id, ...change }, ok, unlock);
