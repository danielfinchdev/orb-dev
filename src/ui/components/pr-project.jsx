// The project page's pull-request panel beyond the list: the filter with its three counters, the checks summary of a row,
// what is watching a PR, the permission an agent asked for on it and «Revisar tarea». Everything comes from GitHub through
// gh and from this engine, so it is plain text (React text nodes). Only this PC's window; nothing here publishes by itself.
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/basic.jsx';
import { Segmented } from '@/components/ui/primitives.jsx';
import { PrCard } from '@/components/pr-card.jsx';
import { call, bridge, fullPc } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { plural } from '@/lib/project-status.js';

// The number on a filter button: «200+» when the repository has more than the engine counted.
const countLabel = (n, capped) => (capped && n >= 1 ? `${n}+` : n);

// open / merged / closed with how many of each. counts: what projects.prCounts answered (zeros while it loads or fails).
export function PrFilter({ value, onChange, counts }) {
  const t = useT();
  const c = counts ?? { open: 0, merged: 0, closed: 0, capped: false };
  return (
    <Segmented value={value} onChange={onChange} aria-label={t('projects.prs.filterLabel')} data-testid="project-pr-filter" itemTestId={(v) => `project-pr-filter-${v}`}
      options={['open', 'merged', 'closed'].map((v) => ({ value: v, label: t(`projects.prs.f.${v}`), count: countLabel(c[v] ?? 0, c.capped) }))} />
  );
}

// The counters of the filter, read once per `key` (the page's git state) and again when asked (after a merge).
export function usePrCounts(project, key) {
  const [counts, setCounts] = useState(null);
  const load = useCallback((force = false) => {
    if (!fullPc() || !project) return Promise.resolve();
    return call('projects.prCounts', { name: project, force }).then(setCounts).catch(quiet);
  }, [project]);
  useEffect(() => { load(false); }, [load, key]);
  return [counts, load];
}

// The list of one state with its checks and dates; null while it loads. error: what gh said when it could not be read.
export function usePrList(project, state, key) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!fullPc() || !project) return undefined;
    let alive = true;
    setError(null);
    call('projects.prs', { name: project, state }).then((r) => { if (alive) setList(Array.isArray(r) ? r : []); }).catch((e) => { if (alive) { setList([]); setError(e?.message ?? String(e)); } });
    return () => { alive = false; };
  }, [project, state, key]);
  return { list, error };
}

// «Todo en verde» / «1 check falla» / «Checks en curso» from the engine's summary; nothing when the PR has no checks.
export function PrChecksBadge({ s }) {
  const t = useT();
  if (!s?.total) return null;
  if (s.failed) return <Badge variant="destructive" data-testid="pr-checks-badge">{plural(t, 'projects.prs.checksFail', s.failed)}</Badge>;
  if (s.running) return <Badge variant="info" data-testid="pr-checks-badge">{t('projects.prs.checksRunning')}</Badge>;
  return <Badge variant="success" data-testid="pr-checks-badge">{t('projects.prs.checksOk')}</Badge>;
}

// Is a chat watching this PR's CI (ciWatch, the switch of the chat's PR tab)? It only reads; the switch stays where it was.
export function usePrWatch(project, number) {
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (!fullPc() || !project) return undefined;
    let alive = true;
    const load = () => call('ciWatch.list').then((all) => { if (alive) setWatching((all ?? []).some((w) => w.project === project && w.number === number)); }).catch(quiet);
    load();
    const off = bridge.on('ciwatch:changed', load);
    return () => { alive = false; off?.(); };
  }, [project, number]);
  return watching;
}

// What agents have asked to do on this PR and wait for an answer (the same requests as the card in the chat).
export function usePrRequests(project, number) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!fullPc() || !project) return undefined;
    let alive = true;
    const mine = (r) => r?.project === project && r?.number === number;
    call('prConfirm.pending').then((all) => { if (alive) setList((all ?? []).filter(mine)); }).catch(quiet);
    const offAsk = bridge.on('pr:request', (r) => { if (mine(r)) setList((prev) => [...prev.filter((x) => x.id !== r.id), r]); });
    const offDone = bridge.on('pr:done', (r) => setList((prev) => prev.filter((x) => x.id !== r?.id)));
    return () => { alive = false; offAsk?.(); offDone?.(); };
  }, [project, number]);
  return list;
}

// An agent's request to comment or merge, shown inside its PR as the very card of the chat (same piece: the whole text of the
// comment, commit, branches, checks and the danger note), so the user sees exactly what would be published before answering.
// A request of another PR, or one that is gone (answered or expired: the engine drops it and sends pr:done), is not drawn.
// Denegar is the focused button, as in the chat. The answer is the card's own call (prConfirm.decline / prConfirm.answer,
// with the same reference); a merge asks for the exact commit the agent saw, so a PR that moved cannot be merged by it.
export function PrAsk({ r, project, number, onDone }) {
  if (!r || (project !== undefined && r.project !== project) || (number !== undefined && r.number !== number)) return null;
  return (
    <div data-testid="project-pr-ask">
      <PrCard r={{ focusCancel: true, ...r }} onDone={onDone} />
    </div>
  );
}
