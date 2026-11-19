// Ajustes › Agentes y uso › «Uso y agentes»: the accounts' usage cards (the ones of the Usage page), the limit and the weekly
// brake, and the switches of their rails. Nothing here has a path of its own: the values go through save() and the rails through
// the same confirmations and changeRail() as «Uso» and «Normas», so the master password is asked exactly as there.
import { useEffect, useState } from 'react';
import { ChartNoAxesColumn } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/basic.jsx';
import { Switch } from '@/components/ui/overlay.jsx';
import { useStore, call, go, closeSettings, fullPc } from '@/lib/store.js';
import { changeRail } from '@/lib/rules-actions.js';
import { confirmPauseRail, confirmResumeRail } from '@/views/rules-dialogs.jsx';
import { Account } from '@/views/usage.jsx';
import { useT, useLocale } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { Block, Panel, Setting, CardFoot, MoreOptions, save } from './rows.jsx';

const pct = (v, fallback) => Math.round((v ?? fallback) * 100);

// «Uso de las cuentas»: the same cards as the Usage page (usage.get), with the marks of the brakes.
export function UsageAccounts({ c }) {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const [accounts, setAccounts] = useState(null);
  const load = () => call('usage.get').then((r) => setAccounts(r ?? [])).catch(() => setAccounts((a) => a ?? []));
  useEffect(() => { load(); }, [version]);
  const stop = c.budget?.stopAt ?? 0.92; const weeklyStop = c.budget?.weeklyStopAt ?? 0.85; const warn = c.budget?.warnAt ?? 0;
  const hours = accounts?.[0]?.windowHours ?? c.budget?.windowHours ?? 5;
  return (
    <Block title={t('settings.usageAccounts')} count={accounts?.length || null} note={t('settings.usageAccountsNote', { stop: Math.round(stop * 100), hours, week: Math.round(weeklyStop * 100) })} data-testid="usage-accounts">
      {accounts?.length
        ? <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5">{accounts.map((u) => <Account key={u.account} u={u} locale={locale} stop={stop} weeklyStop={weeklyStop} warn={warn} reload={load} />)}</div>
        : accounts ? <p className="text-muted-foreground text-control">{t('usage.noLimits')}</p> : null}
      <div><Button size="sm" variant="outline" onClick={() => { closeSettings(); go({ view: 'usage' }); }} data-testid="usage-accounts-all"><ChartNoAxesColumn />{t('usage.open')}</Button></div>
    </Block>
  );
}

// «Aviso y frenos»: the limit of the window and the weekly brake (budget.stopAt and budget.weeklyStopAt, the values of the rails
// «freno-uso» and «freno-semanal»). save() asks the master password when one of them changes, as in «Normas».
export function BrakesCard({ c }) {
  const t = useT();
  const stopNow = pct(c.budget?.stopAt, 0.92); const weekNow = pct(c.budget?.weeklyStopAt, 0.85); const warnNow = pct(c.budget?.warnAt, 0);
  const [v, setV] = useState({ stop: String(stopNow), week: String(weekNow), warn: String(warnNow) });
  useEffect(() => { setV({ stop: String(stopNow), week: String(weekNow), warn: String(warnNow) }); }, [stopNow, weekNow, warnNow]);
  // Same ranges as the selects of the Uso view; an empty or out-of-range field saves nothing.
  // the engine takes 50 to 100 for both (a lower number is a stricter brake): none of that range is taken away here
  const RANGE = { stop: [50, 100], week: [50, 100], warn: [50, 100] };
  // the warning is only a heads-up: 0 turns it off (any other value is in the same 50 to 100 range as the brakes)
  const valid = (key) => { const s = String(v[key]).trim(); const n = Number(s); return s !== '' && Number.isFinite(n) && ((key === 'warn' && n === 0) || (n >= RANGE[key][0] && n <= RANGE[key][1])); };
  const allValid = valid('stop') && valid('week') && valid('warn');
  const apply = () => {
    if (!allValid) return undefined;
    const stop = Number(v.stop); const week = Number(v.week); const warn = Number(v.warn);
    // warnAt is not a rail value: saved alone it never asks for the master password
    const budget = { ...(stop !== stopNow ? { profile: null, stopAt: stop / 100 } : {}), ...(week !== weekNow ? { weeklyStopAt: week / 100 } : {}), ...(warn !== warnNow ? { warnAt: warn / 100 } : {}) };
    if (!Object.keys(budget).length) return undefined;
    return save({ budget }).then((r) => { if (!r) setV({ stop: String(stopNow), week: String(weekNow), warn: String(warnNow) }); });
  };
  // The linked phone cannot edit: the engine refuses it after asking for the password, so it only shows the values.
  const readOnly = !fullPc();
  const field = (key, label, hint, testid) => (
    <Setting label={label} hint={valid(key) || readOnly ? hint : t('settings.brakeInvalid', { min: RANGE[key][0], max: RANGE[key][1] })}>
      {readOnly ? <span className="tabular-nums" data-testid={testid}>{key === 'stop' ? stopNow : key === 'week' ? weekNow : warnNow} %</span>
        : <Input type="number" min={RANGE[key][0]} max={RANGE[key][1]} className="w-[72px]" value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} aria-label={label} aria-invalid={!valid(key)} data-testid={testid} />}
    </Setting>
  );
  if (readOnly) {
    return (
      <Block title={t('settings.brakesTitle')} note={t('settings.brakesNote')} data-testid="usage-brakes">
        <Panel>
          {field('warn', t('settings.warnAt'), t('settings.warnAtHint'), 'brake-warn')}
          {field('stop', t('settings.stopAt'), t('settings.stopAtHint'), 'brake-stop')}
          {field('week', t('settings.weeklyStop'), t('settings.weeklyStopHint'), 'brake-week')}
        </Panel>
      </Block>
    );
  }
  return (
    <Block title={t('settings.brakesTitle')} note={t('settings.brakesNote')} data-testid="usage-brakes">
      <Panel>
        {field('warn', t('settings.warnAt'), t('settings.warnAtHint'), 'brake-warn')}
        {field('stop', t('settings.stopAt'), t('settings.stopAtHint'), 'brake-stop')}
        {field('week', t('settings.weeklyStop'), t('settings.weeklyStopHint'), 'brake-week')}
        <CardFoot><Button size="sm" onClick={apply} disabled={!allValid} data-testid="brakes-save">{t('settings.save')}</Button></CardFoot>
      </Panel>
    </Block>
  );
}

// What the drawing does not show: the switches of the two rails (the PC only, as in «Uso»). A pause or a resume asks the same
// confirmation as «Normas» and then the master password, every time.
export function BrakeRails({ c }) {
  const t = useT();
  const [rails, setRails] = useState([]);
  const load = () => call('rails.list', {}).then((r) => setRails(Array.isArray(r) ? r : []), quiet);
  useEffect(() => { load(); }, []);
  const flip = async (rail, enabled) => {
    const ok = await (enabled ? confirmResumeRail(rail) : confirmPauseRail(rail));
    if (ok && await changeRail(rail.id, { enabled }, t('rules.railSaved'), ok.unlock)) load();
  };
  const row = (id, label, hint, testid) => {
    const rail = rails.find((r) => r.id === id);
    return rail ? <Setting key={id} label={label} hint={hint}><Switch checked={rail.activo !== false} onCheckedChange={(enabled) => flip(rail, enabled)} aria-label={label} data-testid={testid} /></Setting> : null;
  };
  const stop = pct(c.budget?.stopAt, 0.92); const week = pct(c.budget?.weeklyStopAt, 0.85);
  if (!fullPc() || !rails.some((r) => r.id === 'freno-uso' || r.id === 'freno-semanal')) return null;
  return (
    <MoreOptions testid="usage-more-options">
      <Block title={t('usage.atLimit')} note={t('usage.atLimitNote')}>
        <Panel>
          {row('freno-uso', t('usage.stopQueue', { pct: stop }), t('usage.stopQueueHint'), 'usage-stop-queue')}
          {row('freno-semanal', t('settings.weeklyRail', { pct: week }), t('settings.weeklyRailHint'), 'usage-stop-week')}
        </Panel>
      </Block>
    </MoreOptions>
  );
}
