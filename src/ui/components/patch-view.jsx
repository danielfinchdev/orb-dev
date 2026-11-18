// One file's patch in the Cambios tab, as the approved design draws it: a header with the file and its hunk, a number
// beside every line, the added and removed lines tinted, and a «+» on hover to comment a line. Three layouts of the same
// patch: unified, split (removed left, added right) and «Antes» (the old file alone). Syntax colour follows DiffLines: it
// loads on first use and is skipped past MAX_HIGHLIGHT lines so a big diff stays quick.
import { createElement, useMemo } from 'react';
import { useHighlight } from '@/lib/use-highlight.js';
import { patchRows, beforeRows, splitPairs, lineAt } from '@/lib/patch-rows.js';
import { cn } from '@/lib/utils.js';

export const MAX_HIGHLIGHT = 8000;
const TINT = { add: 'code-add', del: 'code-del' };
const SIGN = { add: 'text-(--code-add)', del: 'text-(--code-del)' };
const baseName = (p) => String(p ?? '').split('/').pop();

// A number and its line. `at` ({ line, side }) is what a comment on this line is filed under; `onLine` puts the «+» on it.
function Cell({ r, no, at, onLine, lineLabel, className }) {
  return (
    <div className={cn('dl group/line relative flex min-w-0', TINT[r.kind], className)} data-change={TINT[r.kind] ? '' : undefined}>
      <span className="no text-faint-foreground w-8.5 shrink-0 pr-2 text-right select-none">{no}</span>
      <span className="tx min-w-0 flex-1 overflow-hidden pr-3 whitespace-pre"><span className={cn('code-sign', SIGN[r.kind])}>{r.sign}</span>{r.code ?? (r.body || ' ')}</span>
      {onLine && at ? <button type="button" className="bg-primary text-primary-foreground absolute top-0.5 left-0.5 hidden size-4 cursor-pointer place-items-center rounded-full text-micro leading-none font-bold group-hover/line:grid focus-visible:grid" aria-label={lineLabel} title={lineLabel} onClick={() => onLine(at)} data-testid="diff-comment-add">+</button> : null}
    </div>
  );
}

// text: the file's unified patch. view: 'unified' | 'split'. side: 'after' (the diff) | 'before' (the old file alone).
// onLine({ line, side }) enables the comments; below({ line, side }) gives what shows under a line (comments, the box).
export function PatchView({ text, path, view = 'unified', side = 'after', onLine, below, lineLabel, className }) {
  const hl = useHighlight(Boolean(text));
  const parsed = useMemo(() => patchRows(text), [text]);
  const rows = useMemo(() => {
    if (!hl || parsed.length > MAX_HIGHLIGHT) return parsed;
    const lang = hl.languageFor(path);
    return parsed.map((r) => (r.body ? { ...r, code: hl.highlightLine(r.body, lang, createElement) } : r));
  }, [parsed, hl, path]);
  const firstHunk = rows.find((r) => r.kind === 'hunk');
  const body = useMemo(() => rows.filter((r) => r !== firstHunk), [rows, firstHunk]);
  const old = side === 'before';
  const shown = useMemo(() => (old ? beforeRows(body) : body), [body, old]);
  const pairs = useMemo(() => (view === 'split' && !old ? splitPairs(body) : null), [body, view, old]);
  const under = (at) => (below && at?.line != null ? below(at) : null);
  const full = (r, key) => (r.kind === 'hunk'
    ? <div key={key} className="code-hunk px-3 whitespace-pre">{r.l}</div>
    : <div key={key} className="text-muted-foreground px-3 whitespace-pre">{r.l}</div>);
  return (
    <div className={cn('diff border-border overflow-hidden rounded-card border font-mono text-caption leading-[1.7]', className)} data-testid="patch-view" data-view={pairs ? 'split' : 'unified'} data-side={side}>
      <div className="hd bg-secondary text-muted-foreground px-2.5 py-1.5 whitespace-pre">{baseName(path)}{firstHunk ? ` · ${firstHunk.l}` : ''}</div>
      <div className="code-surface max-h-96 overflow-auto">
        <div className="w-max min-w-full">
          {pairs ? pairs.map((p, i) => {
            if (p.full) return full(p.full, i);
            const l = p.left; const r = p.right;
            return (
              <div key={i}>
                <div className="grid min-w-0 grid-cols-2 [&>*+*]:border-border [&>*+*]:border-l">
                  {l ? <Cell r={l} no={l.oldNo} at={lineAt(l, 'old')} onLine={onLine} lineLabel={lineLabel} /> : <div className="bg-secondary/40" />}
                  {r ? <Cell r={r} no={r.newNo} at={lineAt(r, 'new')} onLine={onLine} lineLabel={lineLabel} /> : <div className="bg-secondary/40" />}
                </div>
                {l ? under(lineAt(l, 'old')) : null}
                {r ? under(lineAt(r, 'new')) : null}
              </div>
            );
          }) : shown.map((r, i) => {
            if (r.kind === 'hunk' || r.kind === 'meta') return full(r, i);
            const at = lineAt(r, old ? 'old' : 'new');
            return <div key={i}><Cell r={r} no={at.line} at={at} onLine={onLine} lineLabel={lineLabel} />{under(at)}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
