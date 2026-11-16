// Normas: the rules Orb and the subagents follow. Two sides (Orb, Subagentes), each with its text rules and the rails
// the code enforces. Nothing loads until the tab opens and nothing runs at rest. Every change asks the master password
// first (lib/rules-actions.js); what the engine answers is trusted only as far as its shape.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollText, Plus, RotateCcw, ChevronRight, LockKeyhole } from 'lucide-react';
import { PageBody } from '@/components/page.jsx';
import { Card, Empty, Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Segmented } from '@/components/ui/primitives.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { call, bridge } from '@/lib/store.js';
import { notifyError } from '@/lib/notify.js';
import { useT } from '@/lib/i18n.js';
import { asList, ruleSide, railsOf, readRemoved, writeRemoved, isRemoved, pruneRemoved, isMissingMethod } from '@/lib/rules-access.js';
import { changeRule, restoreRules, changeRail } from '@/lib/rules-actions.js';
import { RuleCard, RailCard, FixedRail, RemovedRail } from './rules-cards.jsx';
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

function Section({ title, meta, children, testid }) {
  return (
    <section className="grid gap-3" data-testid={testid}>
      <div><h2 className="text-title font-medium">{title}</h2>{meta ? <p className="text-muted-foreground text-control">{meta}</p> : null}</div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

export function RulesView() {
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

  if (loading) return <PageBody className="px-5 py-5 md:pb-28"><div className="flex justify-center py-14"><Spinner /></div></PageBody>;
  const nothing = !rules.length && !rails.length;
  const texts = mine.length;

  return (
    <PageBody className="px-5 py-5 md:pb-28">
      <div className="mx-auto grid w-full max-w-4xl gap-6" data-testid="rules-view">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={side} onChange={setSide} aria-label={t('rules.tabsLabel')} options={[{ value: 'orb', label: t('rules.tabOrb'), testid: 'rules-side-orb' }, { value: 'agents', label: t('rules.tabAgents'), testid: 'rules-side-agents' }]} />
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-caption" title={t('rules.lockedHint')} data-testid="rules-locked"><LockKeyhole className="size-3.5" aria-hidden="true" />{t('rules.lockedPill')}</span>
          <div className="ml-auto flex items-center gap-2">
            {bridge.mobile ? null : (<>
              <Button variant="outline" size="sm" onClick={restoreSeed} data-testid="rules-restore-seed"><RotateCcw />{t('rules.restoreSeed')}</Button>
              <Button size="sm" onClick={create} data-testid="rules-new"><Plus />{t('rules.new')}</Button>
            </>)}
          </div>
        </div>

        {nothing ? (
          <Card className="py-6" data-testid="rules-empty">
            <Empty icon={ScrollText} title={t('rules.emptyTitle')}>{t('rules.emptyHint')}</Empty>
            {bridge.mobile ? null : <div className="flex justify-center"><Button variant="outline" size="sm" onClick={restoreSeed}><RotateCcw />{t('rules.restoreSeed')}</Button></div>}
          </Card>
        ) : (<>
          {core.length ? (
            <Section title={t('rules.fixedTitle')} meta={t('rules.fixedHint')} testid="rules-core">
              {core.map((r) => <FixedRail key={r.id} rail={r} />)}
            </Section>
          ) : null}

          <Section title={t('rules.textTitle')} meta={t(side === 'orb' ? 'rules.textMetaOrb' : 'rules.textMetaAgents', { n: texts })} testid="rules-texts">
            {texts ? mine.map((r) => <RuleCard key={r.id} rule={r} onEdit={edit} onToggle={toggle} onDelete={del} />) : <p className="text-muted-foreground text-control">{t('rules.noText')}</p>}
          </Section>

          <Section title={t('rules.railsTitle')} meta={t('rules.railsMeta', { n: shown.length })} testid="rules-rails">
            {shown.length ? shown.map((r) => <RailCard key={r.id} rail={r} onSwitch={railSwitch} onSave={railSave} onRemove={railRemove} />) : <p className="text-muted-foreground text-control">{t('rules.noRails')}</p>}
          </Section>

          {gone.length ? (
            <Collapsible data-testid="rules-removed">
              <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 text-left">
                <ChevronRight className="text-muted-foreground size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
                <span className="text-title font-medium">{t('rules.removedTitle')}</span>
                <span className="text-muted-foreground text-control">{t('rules.removedMeta', { n: gone.length })}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 grid gap-3">{gone.map((r) => <RemovedRail key={r.id} rail={r} onRestore={railRestore} />)}</CollapsibleContent>
            </Collapsible>
          ) : null}
        </>)}
      </div>
    </PageBody>
  );
}
