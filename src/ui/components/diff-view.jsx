// A git diff as coloured lines: the expert mode's diff tab and the «Cambios» of a task (task-changes.jsx).
import { createElement, useMemo } from 'react';
import { useHighlight } from '@/lib/use-highlight.js';
import { cn } from '@/lib/utils.js';
import { hunkStart } from '@/lib/diff-hunk.js';

// A diff's kinds of line. After "diff --git" come header lines (index, ---, +++…) until the first hunk ("@@") or the
// "+++" line, so a removed line that starts with "--" is still a removed line.
const MAX_DIFF_HIGHLIGHT = 8000; // lines; past that the diff is shown plain (it is coloured line by line)
function diffRows(text, hl) {
  const out = [];
  let header = false; let lang = null; let oldN = 0; let newN = 0;
  const all = text.split('\n');
  const colour = hl && all.length <= MAX_DIFF_HIGHLIGHT;
  for (const l of all) {
    if (l.startsWith('diff --git ')) { header = true; lang = hl?.languageFor(/ b\/(.+)$/.exec(l)?.[1]); out.push({ kind: 'meta', l }); continue; }
    if (header) {
      const m = /^(?:---|\+\+\+) [ab]\/(.+)$/.exec(l); if (m && hl) lang = hl.languageFor(m[1]) ?? lang;
      if (l.startsWith('+++ ')) header = false;
      if (l.startsWith('@@')) { header = false; [oldN, newN] = hunkStart(l); out.push({ kind: 'hunk', l }); continue; }
      out.push({ kind: 'meta', l }); continue;
    }
    if (l.startsWith('@@')) { [oldN, newN] = hunkStart(l); out.push({ kind: 'hunk', l }); continue; }
    if (l.startsWith('\\')) { out.push({ kind: 'meta', l }); continue; } // "\ No newline at end of file"
    const signed = l[0] === '+' || l[0] === '-' || l[0] === ' ';
    const body = signed ? l.slice(1) : l;
    const kind = l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx';
    // the line's number in the new file (old one for a removed line), for the comments written on it
    const at = kind === 'del' ? { line: oldN++, side: 'old' } : { line: newN++, side: 'new' };
    if (kind === 'ctx') oldN++;
    out.push({ kind, ...(signed ? at : {}), sign: signed ? l[0] : '', code: colour ? hl.highlightLine(body, lang, createElement) : body ? [body] : [] });
  }
  return out;
}
const ROW = { add: 'code-add', del: 'code-del', hunk: 'code-hunk', meta: 'code-meta-line', ctx: '' };

// headers: false leaves out the lines before the first hunk (diff --git, index, ---, +++), when the file is named apart.
// onLine(line) (optional) puts a «+» on each code line: it gets { line, side: 'new' | 'old', text }. `below(line)` may
// return what shows under that line (the comments written on it, the box to write one).
export function DiffLines({ text, headers = true, className, testid, onLine, below, lineLabel }) {
  const hl = useHighlight(Boolean(text));
  const rows = useMemo(() => {
    const all = text ? diffRows(text, hl) : [];
    if (headers) return all;
    const first = all.findIndex((r) => r.kind === 'hunk');
    return first < 0 ? all : all.slice(first);
  }, [text, hl, headers]);
  return (
    <div className={cn('code-surface w-max min-w-full py-2 text-caption leading-[1.55]', className)} data-testid={testid}>
      {rows.map((r, i) => (
        <div key={i}>
          <div className={cn('group/line relative px-3 whitespace-pre', onLine && 'pl-7', ROW[r.kind])} data-change={r.kind === 'add' || r.kind === 'del' ? '' : undefined}>
            {onLine && r.line ? <button type="button" className="text-primary absolute top-0 left-1.5 hidden h-full w-5 cursor-pointer items-center justify-center font-bold group-hover/line:flex focus-visible:flex" aria-label={lineLabel} title={lineLabel} onClick={() => onLine({ line: r.line, side: r.side, text: r.code ? '' : '' })} data-testid="diff-comment-add">+</button> : null}
            {r.code ? <><span className="code-sign">{r.sign}</span>{r.code.length ? r.code : (r.sign ? null : ' ')}</> : (r.l || ' ')}
          </div>
          {below && r.line ? below(r) : null}
        </div>
      ))}
    </div>
  );
}
