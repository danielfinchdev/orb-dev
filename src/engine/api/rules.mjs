// The API of the text rules (core\normas) and of the rails. Only this PC's window reaches the writes; the phone may
// read (src/domain/security/permissions.mjs). The master password is checked before these run (master.mjs › checkUnlock):
// here only the parameters and the files. Every write returns what the activity log needs (before / after).
import { ctx, tr } from '../../platform/context.mjs';
import { saveConfig } from '../../platform/config.mjs';
import { DEFAULT_CONFIG } from '../../platform/config-file.mjs';
import { redactSecrets } from '../../shared/secrets-scan.mjs';
import { listRules, readRule, saveRule, createRule, setRuleState, deleteRule, restoreDefaults, RuleError, MAX_TITLE, MAX_TEXT } from '../../domain/rules/rules.mjs';
import { RAILS, railById, railList, switchableIds } from '../../domain/rules/rails.mjs';
import { fail, str } from './common.mjs';

// A RuleError carries a code; the message shown comes from the locale files so it follows the app's language.
const userRule = (fn) => (...args) => {
  try { return fn(...args); } catch (error) {
    if (error instanceof RuleError) fail(tr(`msg.rules.err.${error.code}`, { maxTitle: MAX_TITLE, maxText: MAX_TEXT }));
    throw error;
  }
};
// Free text may hold a key somebody pasted into a rule: it is masked in everything this API returns.
const clean = (r) => (r ? { ...r, titulo: redactSecrets(r.titulo), texto: redactSecrets(r.texto) } : r);
const cleanPair = ({ before, after }) => ({
  before: Array.isArray(before) ? before.map(clean) : clean(before),
  after: Array.isArray(after) ? after.map(clean) : clean(after)
});
const ruleId = (v) => str(v, 'id', 100);

const pick = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function nest(entries) {
  const out = {};
  for (const [dotted, value] of entries) {
    const keys = dotted.split('.'); let o = out;
    for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
    o[keys.at(-1)] = structuredClone(value);
  }
  return out;
}
const SWITCH = (r) => !r.fixed;

export function rulesMethods({ emit }) {
  const saved = (patch) => { const c = saveConfig(patch); emit('config:changed', c); };
  // The phone gets the list without the protected paths: they are places on this PC.
  const railsFor = (principal) => railList().map((r) => (principal?.channel === 'desktop' ? r : { ...r, valores: Object.fromEntries(Object.entries(r.valores).filter(([k]) => k !== 'protected')) }));

  return {
    'rules.list': ({ includeDeleted }) => listRules({ deleted: includeDeleted === true }).map(clean),
    'rules.read': ({ id }) => clean(readRule(ruleId(id))) ?? fail(tr('msg.rules.err.noexiste')),
    'rules.save': userRule(({ id, titulo, para, texto }) => cleanPair(saveRule(ruleId(id), { titulo, para, texto }))),
    'rules.create': userRule(({ titulo, para, texto }) => cleanPair(createRule({ titulo, para, texto }))),
    'rules.pause': userRule(({ id }) => cleanPair(setRuleState(ruleId(id), 'pausada'))),
    'rules.resume': userRule(({ id }) => cleanPair(setRuleState(ruleId(id), 'activa'))),
    'rules.delete': userRule(({ id }) => cleanPair(deleteRule(ruleId(id)))),
    'rules.restoreDefaults': () => cleanPair(restoreDefaults()),

    'rails.list': (_params, principal) => railsFor(principal),
    // The switch and/or the values of one rail, saved in one write (validated as a whole by saveConfig).
    'rails.set': ({ id, enabled, values }, principal) => {
      const rail = railById(str(id, 'id', 100));
      if (!rail) fail(tr('msg.rails.err.unknown', { id }));
      if (!SWITCH(rail)) fail(tr('msg.rails.err.fixed', { id }));
      if (enabled === undefined && values === undefined) fail(tr('msg.rails.err.nothing'));
      if (enabled !== undefined && typeof enabled !== 'boolean') fail(tr('msg.api.invalid', { name: 'enabled' }));
      const patch = {};
      if (values !== undefined) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) fail(tr('msg.api.invalid', { name: 'values' }));
        // only the settings this rail lists: otherwise this would be a way to change any setting of orb.json
        for (const key of Object.keys(values)) if (!rail.keys.includes(key)) fail(tr('msg.rails.err.key', { id, key }));
        Object.assign(patch, nest(Object.entries(values)));
      }
      // to switch a rail back on, `enabled: true` is written (an absent entry also means on, but a patch cannot remove one)
      if (enabled !== undefined) patch.rails = { [id]: { enabled } };
      try { saved(patch); } catch (error) { error.userFacing = true; throw error; }
      return railsFor(principal);
    },
    // Every switch on and every rail value back to the shipped one.
    'rails.restore': (_params, principal) => {
      // «protected» is the owner's own list: restoring keeps it and only adds the shipped entries that are missing.
      const patch = nest(RAILS.flatMap((r) => r.keys).filter((k) => k !== 'protected').map((k) => [k, pick(DEFAULT_CONFIG, k)]));
      const mine = Array.isArray(ctx.config.protected) ? ctx.config.protected : [];
      const lower = new Set(mine.map((x) => String(x).toLowerCase()));
      patch.protected = [...mine, ...DEFAULT_CONFIG.protected.filter((x) => !lower.has(String(x).toLowerCase()))];
      // a hand-written orb.json may hold ids that take no switch (a core rail, an unknown one): they are not touched
      const ok = new Set(switchableIds());
      const stored = Object.keys(ctx.config.rails ?? {}).filter((id) => ok.has(id));
      patch.rails = Object.fromEntries(stored.map((id) => [id, { enabled: true }]));
      try { saved(patch); } catch (error) { error.userFacing = true; throw error; }
      return railsFor(principal);
    }
  };
}
