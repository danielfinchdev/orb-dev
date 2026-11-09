// 3.8.2: what the Markdown of a message draws beyond text and code: formulas (LaTeX between $$, with KaTeX) and diagrams
// (```mermaid blocks). Both libraries load only when a message has one (their own chunks). Mermaid runs with
// securityLevel 'strict' (no HTML labels, no clicks, its SVG sanitised); neither needs eval, so the window's CSP stays
// as it is. A formula or diagram that does not parse is shown as the code it was.
import { useEffect, useId, useState } from 'react';
import { isDark } from '@/lib/store.js';

let katexLoad = null;
const loadKatex = () => (katexLoad ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default ?? m));

export function MathBlock({ tex, display = false }) {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let alive = true;
    loadKatex().then((katex) => {
      if (!alive) return;
      try { setHtml(katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxSize: 50, maxExpand: 1000, output: 'htmlAndMathml' })); }
      catch { setHtml(false); }
    }).catch(() => alive && setHtml(false));
    return () => { alive = false; };
  }, [tex, display]);
  if (!html) return display ? <pre><code>{tex}</code></pre> : <code>{tex}</code>;
  // KaTeX's own markup (trust off: no links, no HTML from the formula).
  return display ? <div className="math-display overflow-x-auto py-1" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
}

let mermaidLoad = null; let mermaidTheme = null;
const loadMermaid = () => (mermaidLoad ??= import('mermaid').then((m) => m.default ?? m));
let renders = 0;
// One diagram at a time: mermaid keeps global state while it draws.
let queue = Promise.resolve();

export function MermaidBlock({ code }) {
  const [svg, setSvg] = useState(null);
  const base = useId().replace(/[^\w-]/g, '');
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const mermaid = await loadMermaid();
      const theme = isDark() ? 'dark' : 'default';
      if (mermaidTheme !== theme) { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit', htmlLabels: false, flowchart: { htmlLabels: false } }); mermaidTheme = theme; }
      const id = `mmd-${base}-${++renders}`;
      try { const out = await mermaid.render(id, code); if (alive) setSvg(out.svg); }
      catch { if (alive) setSvg(false); document.getElementById(`d${id}`)?.remove(); document.getElementById(id)?.remove(); }
    };
    queue = queue.then(run, run).catch(() => alive && setSvg(false));
    return () => { alive = false; };
  }, [code, base]);
  if (!svg) return <pre><code className="language-mermaid">{code}</code></pre>;
  // Mermaid's SVG, sanitised by Mermaid itself (strict).
  return <div className="mermaid-diagram my-2 overflow-x-auto" data-testid="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
