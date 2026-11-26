// Ajustes › Datos: «Restablecer y desinstalar» and «Datos de antes» (src/engine/api/uninstall.mjs does the work). The window asks the
// engine for a plan and shows it as it is; nothing is deleted until the user confirms that very list. Orb's own part (the Recycle
// Bin, the uninstaller) is the app's (src-tauri/src/uninstall.rs). This PC's window only.
import { useEffect, useState } from 'react';
import { RotateCcw, Trash2, Link2, History, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Field, Input } from '@/components/ui/basic.jsx';
import { ListCard } from '@/components/ui/primitives.jsx';
import { form, confirm } from '@/components/dialogs.jsx';
import { call, bridge, getState } from '@/lib/store.js';
import { notifyError, notifyOk } from '@/lib/notify.js';
import { unlockCore } from '@/lib/core-access.js';
import { useT, t as tNow, useLocale } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';
import { BOXES, SHORTCUTS, normalizeKeep } from '../../shared/uninstall-boxes.mjs';
import { SURVEY_MAX, surveyIssue, surveyUrl } from '../../shared/uninstall-survey.mjs';
import { Block, Panel, Setting } from './settings/rows.jsx';

export const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const plural = (key, n) => tNow(`${key}.${n === 1 ? 'one' : 'other'}`, { n });

// The minigames' records and sounds live in this window's own storage (the engine cannot see them): counted and cleared here.
const GAMES_PREFIX = 'orb.juegos';
const gameKeys = () => { try { return Object.keys(localStorage).filter((k) => k.startsWith(GAMES_PREFIX)); } catch { return []; } };
export const gamesBytes = () => { try { return gameKeys().reduce((a, k) => a + (k.length + (localStorage.getItem(k) ?? '').length) * 2, 0); } catch { return 0; } };
const clearGames = () => { for (const k of gameKeys()) { try { localStorage.removeItem(k); } catch { quiet(); } } };

// ---- the boxes
const initialKeep = (mode) => ({ keep: Object.fromEntries(BOXES.map((b) => [b, mode === 'reset' && b === 'projects'])), copyFirst: true });
const sameKeep = (keep, names) => BOXES.every((b) => (keep[b] === true) === names.includes(b));
const DEPS = { settings: 'uninstall.dep.settings', link: 'uninstall.dep.link' };

function KeepBody({ mode, v, set, facts }) {
  const t = useT();
  const { keep, forced } = normalizeKeep(v.keep, { mode, mcpKeys: facts?.mcpKeys === true, copyFirst: v.copyFirst });
  const shown = BOXES.filter((b) => !(mode === 'reset' && b === 'projects'));
  // «Hacer una copia antes» is on by default, off in «Borrar todo»
  const pick = (names) => set({ keep: Object.fromEntries(BOXES.map((b) => [b, names.includes(b)])), copyFirst: names.length > 0 });
  const shortcut = (key, names, label) => (
    <Button type="button" size="sm" variant={sameKeep(keep, names) ? 'secondary' : 'outline'} aria-pressed={sameKeep(keep, names)} onClick={() => pick(names)} data-testid={`uninstall-shortcut-${key}`}>{label}</Button>
  );
  return (
    <>
      <p className="text-muted-foreground m-0 text-control leading-[1.45]">{t(mode === 'reset' ? 'uninstall.introReset' : 'uninstall.introRemove')}</p>
      <div role="group" aria-label={t('uninstall.shortcuts')} className="flex flex-wrap gap-2">
        {shortcut('all', SHORTCUTS.all, t('uninstall.keepAll'))}
        {shortcut('projects', SHORTCUTS.projects, t('uninstall.keepProjects'))}
        {shortcut('nothing', SHORTCUTS.nothing, t('uninstall.deleteAll'))}
      </div>
      <ListCard data-testid="uninstall-boxes">
        {shown.map((b) => (
          <label key={b} className={cn('border-border flex cursor-pointer items-start gap-3 px-3.5 py-2.5 not-first:border-t', forced[b] && 'cursor-default')}>
            <input type="checkbox" className="accent-primary-text mt-0.5 size-4 flex-none" checked={keep[b]} disabled={Boolean(forced[b])} data-testid={`uninstall-box-${b}`}
              onChange={(e) => set({ keep: { ...v.keep, [b]: e.target.checked } })} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <b className="text-control font-medium">{t(`uninstall.box.${b}`)}</b>
              <span className="text-muted-foreground text-caption">{t(`uninstall.box.${b}Desc`)}</span>
              {DEPS[b] ? <span className="text-faint-foreground flex items-center gap-1 text-caption"><Link2 className="size-3" aria-hidden="true" />{t(DEPS[b])}</span> : null}
            </span>
          </label>
        ))}
      </ListCard>
      <p className="text-faint-foreground m-0 text-caption">{t('uninstall.keyNote')}</p>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="accent-primary-text mt-0.5 size-4 flex-none" checked={v.copyFirst} onChange={(e) => set({ copyFirst: e.target.checked })} data-testid="uninstall-copy" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="text-control font-medium">{t('uninstall.copyFirst')}</b>
          <span className="text-muted-foreground text-caption">{t('uninstall.copyFirstDesc')}</span>
          <span className="text-faint-foreground flex items-center gap-1 text-caption"><Link2 className="size-3" aria-hidden="true" />{t('uninstall.dep.copy')}</span>
        </span>
      </label>
    </>
  );
}

// ---- the list of what goes, exactly as the engine computed it
function Row({ title, meta, badge, tone, children }) {
  return (
    <div className="border-border flex items-center justify-between gap-3 px-3.5 py-2.5 not-first:border-t">
      <div className="flex min-w-0 flex-col gap-0.5"><b className="text-control font-medium">{title}</b>{meta?.length ? <span className="text-muted-foreground flex flex-wrap gap-x-2 text-caption">{meta.filter(Boolean).map((m) => <span key={m}>{m}</span>)}</span> : null}{children}</div>
      {badge ? <Badge variant={tone}>{badge}</Badge> : null}
    </div>
  );
}

function PlanBody({ plan, v, set }) {
  const t = useT();
  const games = plan.keep.games ? 0 : gamesBytes();
  const rows = [];
  for (const b of BOXES) {
    if (plan.keep[b] || b === 'projects') continue;
    if (b === 'games') { if (games > 0) rows.push(<Row key={b} title={t('uninstall.box.games')} meta={[size(games)]} />); continue; }
    const box = plan.boxes[b];
    if (!box || !(box.items > 0 || (b === 'link' && box.devices > 0))) continue;
    rows.push(<Row key={b} title={t(`uninstall.box.${b}`)} meta={[b === 'link' && box.devices > 0 ? plural('uninstall.phones', box.devices) : null, box.bytes > 0 ? size(box.bytes) : null]} />);
  }
  if (plan.boxes.key?.items > 0) rows.push(<Row key="key" title={t('uninstall.keyRow')} meta={[size(plan.boxes.key.bytes)]} />);
  if (plan.dirty.length) {
    const names = [...new Set(plan.dirty.map((d) => d.project).filter(Boolean))].join(', ');
    rows.push(<Row key="dirty" title={plural('uninstall.dirty', plan.dirty.length)} meta={[names, t('uninstall.dirtyNote')]} />);
  }
  if (plan.trash.length) {
    const bytes = plan.trash.reduce((a, x) => a + x.bytes, 0);
    rows.push(<Row key="trash" title={t('uninstall.projectsMade')} meta={[plural('uninstall.folders', plan.trash.length), size(bytes)]} badge={<><Trash2 className="size-3" aria-hidden="true" />{t('uninstall.toBin')}</>} tone="info">
      <span className="text-faint-foreground text-caption">{plan.trash.map((x) => x.name).join(', ')}</span>
    </Row>);
  }
  const big = plan.keptProjects.filter((x) => x.why === 'big');
  return (
    <>
      <p className="text-foreground m-0 text-control">{t('uninstall.deletes')}</p>
      <ListCard data-testid="uninstall-plan">{rows.length ? rows : <p className="text-muted-foreground m-0 px-3.5 py-3 text-control" data-testid="uninstall-nothing">{t('uninstall.nothing')}</p>}</ListCard>
      {plan.oldProjects.length ? (
        <ListCard data-testid="uninstall-old">
          <Row title={plural('uninstall.oldKept', plan.oldProjects.length)} meta={[t('uninstall.oldKeptNote')]} badge={t('uninstall.kept')} tone="success" />
          {plan.oldProjects.map((n) => <Row key={n} title={n} />)}
        </ListCard>
      ) : null}
      {big.length ? (
        <ListCard data-testid="uninstall-big">
          {big.map((x) => (
            <div key={x.name}>
              <Row title={t('uninstall.big', { name: x.name })} meta={[size(x.bytes ?? 0), t('uninstall.bigNote')]} badge={t('uninstall.forever')} tone="warning" />
              <label className="border-border flex cursor-pointer items-start gap-3 border-t px-3.5 py-2.5">
                <input type="checkbox" className="accent-primary-text mt-0.5 size-4 flex-none" checked={v.forever.includes(x.name)} onChange={(e) => set({ forever: e.target.checked ? [...v.forever, x.name] : v.forever.filter((n) => n !== x.name) })} data-testid="uninstall-forever" />
                <span className="flex flex-col gap-0.5"><b className="text-control font-medium">{t('uninstall.foreverCheck', { name: x.name })}</b><span className="text-muted-foreground text-caption">{t('uninstall.foreverHint')}</span></span>
              </label>
            </div>
          ))}
        </ListCard>
      ) : null}
      {plan.skipped.map((s) => <p key={s.path} className="text-faint-foreground m-0 text-caption break-all">{t('uninstall.skipped', { path: s.path })}</p>)}
      <p className="text-faint-foreground m-0 text-caption">{t('uninstall.agentsNote')}</p>
      <p className="m-0 text-control"><b>{t('uninstall.final')}</b></p>
    </>
  );
}

// «Borrar todo» of an uninstall: the word is typed (the engine asks for it too).
async function askWord() {
  const word = tNow('uninstall.word');
  return form(tNow('uninstall.wordTitle'), {
    initial: { word: '' },
    body: (v, set) => (
      <>
        <p className="text-muted-foreground m-0 text-control leading-[1.45]">{tNow('uninstall.wordBody')}</p>
        <p className="m-0 text-control"><b>{tNow('uninstall.final')}</b></p>
        <Field label={tNow('uninstall.wordLabel', { word })}><Input autoComplete="off" placeholder={word} value={v.word} onChange={(e) => set({ word: e.target.value })} data-testid="uninstall-word" /></Field>
      </>
    ),
    ok: tNow('uninstall.wordOk'), okDanger: true,
    okDisabled: (v) => v.word.trim().toUpperCase() !== word,
    onOk: (v) => { if (v.word.trim().toUpperCase() !== word) throw new Error(tNow('uninstall.needWord')); return v.word.trim(); }
  });
}

// The optional note before the uninstaller. Nothing is sent by Orb: when the user wrote something, the prefilled GitHub issue opens in
// the browser (the safe external-link opener) and the user submits it there. A failure to open it never stops the uninstall.
async function askSurvey() {
  const t = tNow;
  const asked = await form(t('uninstall.survey.title'), {
    initial: { text: '' }, ok: t('uninstall.survey.next'), cancel: t('uninstall.survey.skip'),
    body: (v, set) => (
      <>
        <p className="text-muted-foreground m-0 text-control leading-[1.45]">{t('uninstall.survey.body')}</p>
        <Input autoComplete="off" maxLength={SURVEY_MAX} aria-label={t('uninstall.survey.label')} value={v.text} onChange={(e) => set({ text: e.target.value })} data-testid="uninstall-survey" />
        <span className="text-faint-foreground text-caption">{t('uninstall.survey.count', { n: [...v.text].length, max: SURVEY_MAX })}</span>
      </>
    )
  });
  const version = getState().app?.version;
  const issue = asked ? surveyIssue(asked.text, version) : null;
  if (!issue) return;
  const send = await form(t('uninstall.survey.confirmTitle'), {
    initial: {}, ok: t('uninstall.survey.open'), cancel: t('uninstall.survey.no'),
    body: () => (
      <>
        <p className="text-muted-foreground m-0 text-control leading-[1.45]">{t('uninstall.survey.confirmBody')}</p>
        <ListCard data-testid="uninstall-survey-preview"><Row title={issue.title} meta={[issue.note, issue.version ? `Orb ${issue.version}` : null]} /></ListCard>
        <p className="m-0 text-control"><b>{t('uninstall.survey.public')}</b></p>
      </>
    )
  });
  if (!send) return;
  const url = surveyUrl(asked.text, version);
  try { await Promise.race([bridge.openExternal(url), new Promise((r) => setTimeout(r, 3000))]); } catch (error) { quiet(error); }
}

// What a run that stopped says: what went, what failed and what is left, and that the uninstaller was not opened.
const label = (x) => x.name ?? x.path ?? x.box;
async function showFailure(report) {
  const t = tNow;
  const left = report.pending.map(label).slice(0, 6).join(', ');
  const body = [t('uninstall.failedBody', { done: report.done.length, failed: report.failed.map((x) => `${label(x)}${x.error ? ` (${x.error})` : ''}`).join(', ') || '—' }), left ? t('uninstall.failedLeft', { left }) : null, t('uninstall.failedAgain')].filter(Boolean).join('\n\n');
  await confirm(t('uninstall.failedTitle'), body, { ok: t('uninstall.failedClose'), cancel: null, danger: true });
}

// mode: 'uninstall' | 'reset'. The whole flow: unlock, what to keep, the list, (the typed word), the run, and the end.
export async function runUninstall(mode) {
  const unlock = await unlockCore('uninstall');
  if (!unlock) return;
  let facts;
  try { facts = await call('uninstall.plan', { mode, keep: {}, unlock }); } catch (error) { notifyError(error); return; }
  const picked = await form(tNow(mode === 'reset' ? 'uninstall.titleReset' : 'uninstall.titleRemove'), {
    wide: true, initial: initialKeep(mode), ok: tNow('uninstall.review'),
    body: (v, set) => <KeepBody mode={mode} v={v} set={set} facts={facts} />,
    onOk: async (v) => {
      const u = await unlockCore('uninstall'); if (!u) return false;
      const input = { mode, keep: normalizeKeep(v.keep, { mode, mcpKeys: facts.facts?.mcpKeys === true, copyFirst: v.copyFirst }).keep, copyFirst: v.copyFirst };
      return { input, plan: await call('uninstall.plan', { ...input, unlock: u }) };
    }
  });
  if (!picked) return;
  const done = await form(tNow(mode === 'reset' ? 'uninstall.confirmReset' : 'uninstall.confirmRemove'), {
    wide: true, okDanger: true, lockBusy: true, initial: { forever: [] }, ok: tNow(mode === 'reset' ? 'uninstall.doReset' : 'uninstall.doRemove'),
    okDisabled: () => false,
    body: (v, set) => <PlanBody plan={picked.plan} v={v} set={set} />,
    onOk: async (v) => {
      const u = await unlockCore('uninstall'); if (!u) return false;
      // a folder too big for the Recycle Bin the user agreed to delete for good changes the plan: it is made again (and its id with it)
      const plan = v.forever.length ? await call('uninstall.plan', { ...picked.input, forever: v.forever, unlock: u }) : picked.plan;
      let typed = null;
      if (mode === 'uninstall' && BOXES.every((b) => !plan.keep[b])) { typed = await askWord(); if (!typed) return false; }
      if (mode === 'uninstall') await askSurvey();
      const run = await call('uninstall.run', { ...picked.input, forever: v.forever, planId: plan.id, typed, unlock: await unlockCore('uninstall') });
      if (run.ok && !picked.input.keep.games) clearGames();
      return run;
    }
  });
  if (!done) return;
  if (!done.ok) { await showFailure(done.report); setTimeout(() => window.location.reload(), 1500); return; }
  if (done.mode === 'reset') { notifyOk(tNow('uninstall.resetDone'), { ms: 4000 }); setTimeout(() => window.location.reload(), 1200); return; }
  notifyOk(tNow('uninstall.removing'), { ms: 8000 });
  // the uninstaller could not start: the engine, closed by the run, starts again and the window with it
  try { await bridge.uninstall(done.code); } catch (error) { notifyError(error); await call('uninstall.restart').catch(quiet); setTimeout(() => window.location.reload(), 1500); }
}

// At the start: a delete that stopped (a reported failure) or that Orb cannot check waits for the user's word. «Seguir borrando»
// lets the engine run its journal again; «Dejarlo así» closes it and nothing more is deleted. Closing the dialog asks again next time.
export function StoppedDelete() {
  useEffect(() => {
    if (bridge.mobile) return undefined;
    let alive = true;
    (async () => {
      const p = await call('uninstall.pending').catch(() => null);
      if (!alive || !p || (p.state !== 'stopped' && p.state !== 'untrusted')) return;
      const stopped = p.state === 'stopped';
      const answer = await confirm(tNow(stopped ? 'uninstall.stoppedTitle' : 'uninstall.untrustedTitle'),
        stopped ? tNow('uninstall.stoppedBody', { done: p.done, left: p.left }) : tNow('uninstall.untrustedBody'),
        { ok: tNow(stopped ? 'uninstall.stoppedKeep' : 'uninstall.stoppedLeave'), cancel: tNow(stopped ? 'uninstall.stoppedLeave' : 'uninstall.untrustedNotNow'), danger: stopped, noClose: true });
      // true: go on (stopped) or close it (untrusted); false: leave it (stopped) or ask again (untrusted)
      const doResume = stopped && answer === true;
      const doClose = (stopped && answer === false) || (!stopped && answer === true);
      if (!doResume && !doClose) return;
      const unlock = await unlockCore('uninstall');
      if (!unlock) return;
      try {
        if (doResume) { await call('uninstall.resume', { unlock }); notifyOk(tNow('uninstall.resuming'), { ms: 6000 }); setTimeout(() => window.location.reload(), 2500); }
        else await call('uninstall.discard', { unlock });
      } catch (error) { notifyError(error); }
    })();
    return () => { alive = false; };
  }, []);
  return null;
}

// The block at the end of Datos.
export function UninstallBlock() {
  const t = useT();
  const [busy, setBusy] = useState(null);
  if (bridge.mobile || !bridge.uninstall) return null;
  const go = async (mode) => { setBusy(mode); try { await runUninstall(mode); } finally { setBusy(null); } };
  return (
    <Block title={t('uninstall.blockTitle')} note={t('uninstall.blockNote')} data-testid="uninstall-card">
      <Panel>
        <Setting label={t('uninstall.resetName')} hint={t('uninstall.resetHint')}>
          <Button size="sm" variant="danger" onClick={() => go('reset')} disabled={busy !== null} data-testid="uninstall-reset">{busy === 'reset' ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}{t('uninstall.resetButton')}</Button>
        </Setting>
        <Setting label={t('uninstall.removeName')} hint={t('uninstall.removeHint')}>
          <Button size="sm" variant="danger" onClick={() => go('uninstall')} disabled={busy !== null} data-testid="uninstall-remove">{busy === 'uninstall' ? <LoaderCircle className="animate-spin" /> : <Trash2 />}{t('uninstall.removeButton')}</Button>
        </Setting>
      </Panel>
    </Block>
  );
}

// «Datos de antes»: what «Empezar de cero» put aside inside core, until the user deletes it.
export function PreviousBlock() {
  const t = useT();
  const locale = useLocale();
  const [list, setList] = useState([]);
  const load = () => call('previous.list').then((r) => setList(r?.list ?? [])).catch(quiet);
  useEffect(() => { if (!bridge.mobile) load(); }, []);
  if (bridge.mobile || !list.length) return null;
  const when = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const remove = async (d) => {
    if (!(await confirm(t('uninstall.previousConfirm', { date: when(d.date) }), t('uninstall.previousConfirmBody'), { ok: t('uninstall.previousDelete'), danger: true }))) return;
    const unlock = await unlockCore('previous'); if (!unlock) return;
    try { await call('previous.delete', { name: d.name, unlock }); notifyOk(t('uninstall.previousDone')); load(); } catch (error) { notifyError(error); }
  };
  return (
    <Block title={t('uninstall.previousTitle')} note={t('uninstall.previousNote', { size: size(list.reduce((a, d) => a + d.bytes, 0)) })} data-testid="previous-card">
      <Panel>
        {list.map((d) => (
          <Setting key={d.name} label={t('uninstall.previousName', { date: when(d.date) })} hint={t('uninstall.previousHint')}>
            <Button size="sm" variant="danger" onClick={() => remove(d)} data-testid="previous-delete"><Trash2 />{t('uninstall.previousDelete')}</Button>
          </Setting>
        ))}
      </Panel>
    </Block>
  );
}

// The first screen after reinstalling over a workspace that was already there (15b): nothing is used until the user answers.
export function PreviousQuestion({ previous, onAnswered }) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const answer = async (choice) => {
    setBusy(choice); setError(null);
    try { await bridge.previous(choice); onAnswered(choice); } catch (e) { setError(String(e?.message ?? e)); setBusy(null); }
  };
  const date = previous.since ? new Date(previous.since).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const day = new Date().toISOString().slice(0, 10);
  return (
    <div className="bg-background fixed inset-0 z-50 grid place-items-center p-6" data-testid="previous-question">
      <div role="alertdialog" aria-label={t('uninstall.q.title')} className="bg-card border-border rounded-card grid w-full max-w-[520px] gap-4 border p-6 shadow-lg">
        <div className="flex items-start gap-4">
          <span className="bg-primary-soft text-primary-text grid size-12 flex-none place-items-center rounded-[14px]"><History className="size-6" aria-hidden="true" /></span>
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="m-0 font-(family-name:--title) text-[18px] font-semibold">{t('uninstall.q.title')}</h2>
            <p className="m-0 text-control">{t('uninstall.q.hint')}</p>
            <p className="text-muted-foreground m-0 text-control">{t('uninstall.q.note')}</p>
          </div>
        </div>
        <details className="text-control">
          <summary className="text-muted-foreground cursor-pointer">{t('uninstall.q.details')}</summary>
          <p className="text-muted-foreground mt-2 mb-0 text-caption break-all">{t('uninstall.q.detailsBody', { home: previous.home, size: size(previous.bytes ?? 0), date, day })}</p>
        </details>
        {error ? <p role="alert" className="text-destructive m-0 text-caption">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => answer('fresh')} data-testid="previous-fresh">{busy === 'fresh' ? <LoaderCircle className="animate-spin" /> : null}{t('uninstall.q.fresh')}</Button>
          <Button disabled={busy !== null} onClick={() => answer('recover')} data-testid="previous-recover">{busy === 'recover' ? <LoaderCircle className="animate-spin" /> : null}{t('uninstall.q.recover')}</Button>
        </div>
      </div>
    </div>
  );
}
