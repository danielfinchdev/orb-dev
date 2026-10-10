// The syntax highlighter (lib/highlight.js, ~180 KB with its grammars) is loaded the first time some code needs colour,
// not when the window opens. Until it arrives (a moment) the code is shown plain; then the component draws again.
import { useEffect, useState } from 'react';

let module = null;
let loading = null;
const load = () => (loading ??= import('./highlight.js').then((m) => { module = m; return m; }));

// need: whether there is code to colour now. Returns the module, or null while it loads.
export function useHighlight(need = true) {
  const [, setReady] = useState(Boolean(module));
  useEffect(() => {
    if (!need || module) return undefined;
    let alive = true;
    load().then(() => alive && setReady(true)).catch(() => { loading = null; });
    return () => { alive = false; };
  }, [need]);
  return module;
}
