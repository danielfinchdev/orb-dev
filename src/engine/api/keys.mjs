// Keyboard shortcuts of the window: core/keybindings.json holds the user's rules (src/shared/keybindings.mjs). Read and
// written here so the file stays in core with the rest of the user's data; the window matches the keys itself.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { writeAtomic } from '../../platform/fsx.mjs';
import { parseFile, resolve, serialize, normalizeCombo, commandOf, WHENS } from '../../shared/keybindings.mjs';
import { fail } from './common.mjs';

const fileOf = () => (ctx.paths?.core ? path.join(ctx.paths.core, 'keybindings.json') : null);

export function keysMethods({ emit }) {
  const read = () => {
    const file = fileOf();
    let text = '';
    try { if (file) text = fs.readFileSync(file, 'utf8'); } catch { /* none yet: the defaults */ }
    const { rules, problems } = parseFile(text);
    const resolved = resolve(rules);
    return { rules, problems: [...problems, ...resolved.problems] };
  };
  return {
    // → { rules, problems } ; problems say which rules of the file are not in force (and why).
    'keys.get': () => read(),
    // The window sends the whole list of rules it wants; a rule that would clash is refused, never half saved.
    'keys.save': ({ rules } = {}) => {
      if (!Array.isArray(rules) || rules.length > 200) fail(tr('msg.api.invalid', { name: 'rules' }));
      const clean = rules.map((r) => {
        if (!r || typeof r !== 'object' || !commandOf(String(r.command))) fail(tr('msg.api.invalid', { name: 'command' }));
        const key = r.key === null || r.key === '' ? null : normalizeCombo(String(r.key));
        if (r.key !== null && r.key !== '' && !key) fail(tr('msg.api.invalid', { name: 'key' }));
        if (r.when !== undefined && !WHENS.includes(r.when)) fail(tr('msg.api.invalid', { name: 'when' }));
        return { command: String(r.command), key, ...(r.when ? { when: r.when } : {}) };
      });
      const { problems } = resolve(clean);
      if (problems.length) return { saved: false, problems };
      const file = fileOf() ?? fail(tr('msg.api.invalid', { name: 'core' }));
      if (clean.length) writeAtomic(file, serialize(clean)); else fs.rmSync(file, { force: true });
      emit('keys:changed', { rules: clean });
      return { saved: true, rules: clean, problems: [] };
    }
  };
}
