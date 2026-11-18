// Normas: the rules Orb and the subagents follow. Two sides (Orb, Subagentes), each with its text rules and the rails
// the code enforces. Nothing loads until the tab opens and nothing runs at rest. Every change asks the master password
// first (lib/rules-actions.js); what the engine answers is trusted only as far as its shape.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollText, Plus, RotateCcw, LockKeyhole } from 'lucide-react';
import { Badge, Empty, Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { ListCard } from '@/components/ui/primitives.jsx';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay.jsx';
import { call, bridge } from '@/lib/store.js';
import { notifyError } from '@/lib/notify.js';
import { useT } from '@/lib/i18n.js';
import { asList, ruleSide, railsOf, readRemoved, writeRemoved, isRemoved, pruneRemoved, isMissingMethod } from '@/lib/rules-access.js';
import { changeRule, restoreRules, changeRail } from '@/lib/rules-actions.js';
import { RuleCard, RailCard, FixedRail, RemovedRail } from './rules-cards.jsx';
import { BitacorasPage } from './bitacoras-page.jsx';
import { confirmPauseRail, confirmResumeRail, confirmRemoveRail, confirmRestoreRail, confirmSaveRail, confirmPauseRule, confirmDeleteRule, confirmRestoreRules, openRuleEditor } from './rules-dialogs.jsx';

const store = () => { try { return window.localStorage; } catch { return null; } };

function useRules(setRemoved) {
  const [state, setState] = useState({ loading: true, rules: [], rails: [] });
  const load = useCallback(async () => {
    // rails.list may not exist in an older engine: the tab then shows the text rules only
    const [rules, rails] = await Promise.all([
      call('rules.list', {}).then(asList, (error) => { notifyError(error); return []; }),
      call('rails.list', {}).then(asList, (error) => { if (!isMissingMethod(error)) notifyError(error); return []; })
    ]);
    setState({ loading: false, rules, rails });
    setRemoved((cur) => { const next = pruneRemoved(cur, rails); if (next.length !== cur.length) writeRemoved(store(), next); return next.length === cur.length ? cur : next; });
  }, [setRemoved]);
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

// A block of the tab: its heading (.sec-h) with a quiet count and, at the end, what applies to all of it.
function Section({ title, meta, badge, children, testid }) {
  return (
    <section className="flex flex-col gap-3" data-testid={testid}>
      <div className="sec-h flex flex-wrap items-center gap-2.5"><h2 className="m-0 font-(family-name:--title) text-title font-semibold">{title}</h2>{meta ? <span className="text-muted-foreground text-caption">{meta}</span> : null}<span className="flex-1" />{badge}</div>
      {children}
    </section>
  );
}

// The frame of a list of rows: hairlines between them.
const Rows = ({ children }) => <ListCard className="[&>*+*]:border-border [&>*+*]:border-t">{children}</ListCard>;

export function RulesView({ tabs }) {
  const t = useT();
  const [removed, setRemoved] = useState(() => readRemoved(store()));
  const [{ loading, rules, rails }, load] = useRules(setRemoved);
  const [side, setSide] = useState('orb');
  const sideKey = side === 'orb' ? 'orb' : 'subagentes';

  const mine = useMemo(() => rules.filter((r) => r.estado !== 'eliminada' && ruleSide(r, sideKey)), [rules, sideKey]);
  const { switchable } = useMemo(() => railsOf(rails, sideKey), [rails, sideKey]);
  // the core is shown once, on the Subagentes side: it is what the agents cannot touch
  const core = useMemo(() => (side === 'orb' ? [] : asList(rails).filter((r) => r.fijo)), [rails, side]);
  const shown = switchable.filter((r) => !isRemoved(r, removed));
  const gone = switchable.filter((r) => isRemoved(r, removed));

  const forget = (id) => { const next = removed.filter((x) => x !== id); setRemoved(next); writeRemoved(store(), next); };
  const remember = (id) => { const next = [...removed, id]; setRemoved(next); writeRemoved(store(), next); };

  // ---- text rules
  const create = async () => {
    const fields = await openRuleEditor(null, sideKey);
    if (fields && await changeRule('create', null, fields, t('rules.created'))) load();
  };
  const edit = async (rule) => {
    const fields = await openRuleEditor(rule);
    if (fields && await changeRule('save', rule, fields, t('rules.saved'))) load();
  };
  const toggle = async (rule) => {
    const pausing = rule.estado !== 'pausada';
    if (pausing && !(await confirmPauseRule(rule))) return;
    if (await changeRule(pausing ? 'pause' : 'resume', rule, {}, t(pausing ? 'rules.paused.ok' : 'rules.resumed.ok'))) load();
  };
  const del = async (rule) => {
    if (await confirmDeleteRule(rule) && await changeRule('delete', rule, {}, t('rules.deleted.ok'))) load();
  };
  const restoreSeed = async () => {
    if (await confirmRestoreRules() && await restoreRules(t('rules.restored.ok'))) load();
  };

  // ---- rails: every change asks the password, every time
  const railSwitch = async (rail, next) => {
    if (!(await (next ? confirmResumeRail(rail) : confirmPauseRail(rail)))) return;
    if (await changeRail(rail.id, { enabled: next }, t('rules.railSaved'))) load();
  };
  const railSave = async (rail, before, after, changed) => {
    if (!(await confirmSaveRail(rail, before, after))) return false;
    const done = await changeRail(rail.id, { values: changed }, t('rules.railSaved'));
    if (done) load();
    return Boolean(done);
  };
  const railRemove = async (rail) => {
    if (!(await confirmRemoveRail(rail))) return;
    // the rail is turned off first (even when it already is: removing asks the password too); only then is it hidden
    if (await changeRail(rail.id, { enabled: false }, t('rules.railSaved'))) { remember(rail.id); load(); }
  };
  const railRestore = async (rail) => {
    if (!(await confirmRestoreRail(rail))) return;
    if (await changeRail(rail.id, { enabled: true }, t('rules.railSaved'))) { forget(rail.id); load(); }
  };

  const nothing = !rules.length && !rails.length;
  const texts = mine.length;
  const everyTime = <Badge variant="secondary">{t('rules.everyTime')}</Badge>;

  return (
    <BitacorasPage meta={t('nav.logbooksHint')} onRefresh={load} tabs={tabs}>
      {loading ? <div className="flex justify-center py-14"><Spinner /></div> : (
        <div className="flex flex-col gap-4" data-testid="rules-view">
          <div className="toolbar flex flex-wrap items-center gap-2">
            <Tabs value={side} onValueChange={setSide}>
              <TabsList variant="line" className="w-auto border-0 p-0" aria-label={t('rules.tabsLabel')}>
                <TabsTrigger value="orb" data-testid="rules-side-orb">{t('rules.tabOrb')}</TabsTrigger>
                <TabsTrigger value="agents" data-testid="rules-side-agents">{t('rules.tabAgents')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="flex-1" />
            {bridge.mobile ? null : (<>
              <Button variant="outline" onClick={restoreSeed} data-testid="rules-restore-seed"><RotateCcw />{t('rules.restoreSeed')}</Button>
              <Button onClick={create} data-testid="rules-new"><Plus />{t('rules.new')}</Button>
            </>)}
          </div>
          <div className="state flex flex-wrap items-center gap-2 text-control" data-testid="rules-locked"><LockKeyhole className="text-muted-foreground size-3.5" aria-hidden="true" /><b className="font-medium">{t('rules.lockedPill')}</b><span className="text-faint-foreground text-caption">{t('rules.lockedHint')}</span></div>

          {nothing ? (
            <div className="bg-card border-border rounded-card flex flex-col gap-3 border py-6" data-testid="rules-empty">
              <Empty icon={ScrollText} title={t('rules.emptyTitle')}>{t('rules.emptyHint')}</Empty>
              {bridge.mobile ? null : <div className="flex justify-center"><Button variant="outline" onClick={restoreSeed}><RotateCcw />{t('rules.restoreSeed')}</Button></div>}
            </div>
          ) : (<>
            {core.length ? (
              <Section title={t('rules.fixedTitle')} meta={t('rules.fixedMeta', { n: core.length })} testid="rules-core">
                <p className="note text-muted-foreground m-0 text-caption">{t('rules.fixedHint')}</p>
                <Rows>{core.map((r) => <FixedRail key={r.id} rail={r} />)}</Rows>
              </Section>
            ) : null}

            <Section title={t('rules.textTitle')} meta={t(side === 'orb' ? 'rules.textMetaOrb' : 'rules.textMetaAgents', { n: texts })} testid="rules-texts">
              {texts ? <Rows>{mine.map((r) => <RuleCard key={r.id} rule={r} onEdit={edit} onToggle={toggle} onDelete={del} />)}</Rows> : <p className="text-muted-foreground m-0 text-control">{t('rules.noText')}</p>}
            </Section>

            <Section title={t('rules.railsTitle')} meta={t('rules.railsMeta', { n: shown.length })} badge={everyTime} testid="rules-rails">
              {shown.length ? <Rows>{shown.map((r) => <RailCard key={r.id} rail={r} onSwitch={railSwitch} onSave={railSave} onRemove={railRemove} />)}</Rows> : <p className="text-muted-foreground m-0 text-control">{t('rules.noRails')}</p>}
            </Section>

            {gone.length ? (
              <Section title={t('rules.removedTitle')} meta={t('rules.removedMeta', { n: gone.length })} badge={everyTime} testid="rules-removed">
                <Rows>{gone.map((r) => <RemovedRail key={r.id} rail={r} onRestore={railRestore} />)}</Rows>
              </Section>
            ) : null}
          </>)}
        </div>
      )}
    </BitacorasPage>
  );
}
