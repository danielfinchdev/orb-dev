// The small template language of the text rules (see defaults.mjs for the variables and conditions):
//   {var}                 replaced by its value when `var` is a known variable; an unknown one stays as written
//   {?cond}A{:}B{/}       A when `cond` is true, else B ({:}B optional); they nest. An unknown condition is false
//   {norma:<id>}          the already rendered text of another rule (empty if it is paused, deleted or not for this prompt)
// One pass over the template: a substituted value is never read as template again, so a path or a note that happens to
// contain `{?x}` or `{orb}` comes out literally.
// A line that held tags or values and came out empty (only whitespace) is dropped whole, newline included, however the
// conditions fall across lines; a blank line with no tags in it is kept. That way an optional line leaves no blank line behind.

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

// A flat list of tokens (a {nl} per line break), then a tree (an unmatched {:} or {/} is plain text, an unclosed {?x}
// closes at the end). {else} and {end} leave a {mark} so the line they sit in counts as one that held tags.
function parse(template, vars) {
  const flat = [];
  const lines = template.split('\n');
  lines.forEach((line, i) => {
    const toks = tokenizeLine(line, vars);
    // a line that holds only values (and blanks) is just those values: its own spacing is not kept
    const real = toks.filter((t) => !(t.k === 'text' && !t.v.trim()));
    if (real.length && real.every((t) => t.k === 'var' || t.k === 'norma')) flat.push({ k: 'solo', parts: real });
    else flat.push(...toks);
    if (i < lines.length - 1) flat.push({ k: 'nl' });
  });
  const root = { kids: [] }; const stack = [root];
  for (const t of flat) {
    const top = stack[stack.length - 1];
    if (t.k === 'if') { const node = { k: 'if', name: t.name, yes: [], no: null, kids: null }; node.kids = node.yes; top.kids.push(node); stack.push({ kids: node.yes, node }); }
    else if (t.k === 'else') { if (stack.length > 1 && !top.node.no) { top.kids.push({ k: 'mark' }); top.node.no = []; top.kids = top.node.no; } else top.kids.push({ k: 'text', v: t.raw }); }
    else if (t.k === 'end') { if (stack.length > 1) { top.kids.push({ k: 'mark' }); stack.pop(); } else top.kids.push({ k: 'text', v: t.raw }); }
    else top.kids.push(t);
  }
  return root.kids;
}

export function render(template, { vars = {}, conds = {}, norma = () => '' } = {}) {
  const tree = parse(String(template ?? ''), vars);
  const lines = []; let cur = { t: '', m: false };
  const value = (t) => (t.k === 'var' ? String(vars[t.name] ?? '') : String(norma(t.id) ?? ''));
  const finish = () => { if (!(cur.m && !cur.t.trim())) lines.push(cur.t); cur = { t: '', m: false }; };
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.k === 'text') cur.t += n.v;
      else if (n.k === 'nl') finish();
      else if (n.k === 'mark') cur.m = true;
      else if (n.k === 'solo') { cur.m = true; cur.t += n.parts.map(value).join(''); }
      else if (n.k === 'var') { cur.m = true; cur.t += value(n); }
      else if (n.k === 'norma') {
        cur.m = true;
        const v = value(n);
        // an empty rule also takes the space that led into it
        if (!v && cur.t.endsWith(' ')) cur.t = cur.t.slice(0, -1); else cur.t += v;
      } else if (n.k === 'if') { cur.m = true; walk(conds[n.name] ? n.yes : (n.no ?? [])); }
    }
  };
  walk(tree);
  finish();
  return lines.join('\n');
}
