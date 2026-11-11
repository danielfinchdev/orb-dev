// The small template language of the text rules (see defaults.mjs for the variables and conditions):
//   {var}                 replaced by its value when `var` is a known variable; an unknown one stays as written
//   {?cond}A{:}B{/}       A when `cond` is true, else B ({:}B optional); they nest. An unknown condition is false
//   {norma:<id>}          the already rendered text of another rule (empty if it is paused, deleted or not for this prompt)
// One pass over the template: a substituted value is never read as template again, so a path or a note that happens to
// contain `{?x}` or `{orb}` comes out literally.
// A line that holds only conditional tags is dropped, and so is a line that holds only values (variables, rules) when
// they all came out empty; that way an optional line leaves no blank line behind.

const TAG = /\{(\?[a-z_]+|:|\/|norma:[a-z0-9-]{1,60}|[a-z_]+)\}/g;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function tokenizeLine(line, vars) {
  const out = []; let last = 0;
  const text = (v) => { if (!v) return; const prev = out[out.length - 1]; if (prev?.k === 'text') prev.v += v; else out.push({ k: 'text', v }); };
  for (const m of line.matchAll(TAG)) {
    text(line.slice(last, m.index)); last = m.index + m[0].length;
    const t = m[1];
    if (t.startsWith('?')) out.push({ k: 'if', name: t.slice(1), raw: m[0] });
    else if (t === ':') out.push({ k: 'else', raw: m[0] });
    else if (t === '/') out.push({ k: 'end', raw: m[0] });
    else if (t.startsWith('norma:')) out.push({ k: 'norma', id: t.slice(6) });
    else if (own(vars, t)) out.push({ k: 'var', name: t });
    else text(m[0]);
  }
  text(line.slice(last));
  return out;
}

// A flat list of tokens, then a tree (an unmatched {:} or {/} is plain text, an unclosed {?x} closes at the end).
function parse(template, vars) {
  const flat = [];
  const lines = template.split('\n');
  for (const line of lines) {
    const toks = tokenizeLine(line, vars);
    const real = toks.filter((t) => !(t.k === 'text' && !t.v.trim()));
    if (real.length && real.every((t) => t.k === 'if' || t.k === 'else' || t.k === 'end')) { flat.push(...real); continue; }
    if (real.length && real.every((t) => t.k === 'var' || t.k === 'norma')) { flat.push({ k: 'solo', parts: real }); continue; }
    flat.push({ k: 'line' }, ...toks);
  }
  const root = { kids: [] }; const stack = [root];
  for (const t of flat) {
    const top = stack[stack.length - 1];
    if (t.k === 'if') { const node = { k: 'if', name: t.name, yes: [], no: null, kids: null }; node.kids = node.yes; top.kids.push(node); stack.push({ kids: node.yes, node }); }
    else if (t.k === 'else') { if (stack.length > 1 && !top.node.no) { top.node.no = []; top.kids = top.node.no; } else top.kids.push({ k: 'text', v: t.raw }); }
    else if (t.k === 'end') { if (stack.length > 1) stack.pop(); else top.kids.push({ k: 'text', v: t.raw }); }
    else top.kids.push(t);
  }
  return root.kids;
}

export function render(template, { vars = {}, conds = {}, norma = () => '' } = {}) {
  const tree = parse(String(template ?? ''), vars);
  let out = ''; let started = false;
  const value = (t) => (t.k === 'var' ? String(vars[t.name] ?? '') : String(norma(t.id) ?? ''));
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.k === 'text') out += n.v;
      else if (n.k === 'line') { if (started) out += '\n'; started = true; }
      else if (n.k === 'var') out += value(n);
      else if (n.k === 'norma') {
        const v = value(n);
        // an empty rule also takes the space that led into it
        if (!v && out.endsWith(' ')) out = out.slice(0, -1); else out += v;
      } else if (n.k === 'solo') {
        const v = n.parts.map(value).join('');
        if (v.trim()) { if (started) out += '\n'; started = true; out += v; }
      } else if (n.k === 'if') walk(conds[n.name] ? n.yes : (n.no ?? []));
    }
  };
  walk(tree);
  return out;
}
