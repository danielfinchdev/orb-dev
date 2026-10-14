// 2.6: what the chat runs on, chosen under the message box: the brain (agent + model, one list grouped by agent), the
// reasoning and, for a direct chat, the permissions. A bubble warns when the account's usage runs high.
import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Flame, Lightbulb, Star, X } from 'lucide-react';
import { AgentIcon } from './agent-icon.jsx';
import { Button } from './ui/button.jsx';
import { Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, BubbleTip } from './ui/overlay.jsx';
import { call, useStore } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { REASONING, options } from '@/lib/labels.js';
import { prettyModel } from '@/lib/tools.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';

// The installed agents with their models (engine: models.catalog), read again when the settings change.
export function useCatalog() {
  const version = useStore((s) => s.version);
  const [catalog, setCatalog] = useState(null);
  useEffect(() => { let alive = true; call('models.catalog').then((c) => alive && setCatalog(c)).catch(() => alive && setCatalog([])); return () => { alive = false; }; }, [version]);
  return catalog;
}

// 3.0: an account with its own plan has its own models (Codex Go and Pro); the others use the agent's list.
export const modelsOf = (a, account) => (account && a?.accountModels?.[account]) || a?.models || [];
// 3.2.1: a model's name as the selector shows it, wherever the id comes from (an alias like «sonnet», the full id the
// agent reports like «claude-sonnet-5-5» or «gpt-6-luna»); never the raw id.
export function modelLabel(catalog, agent, id) {
  if (!id) return '';
  const a = catalog?.find((x) => x.id === agent);
  const all = [...(a?.models ?? []), ...Object.values(a?.accountModels ?? {}).flat()].filter((m) => m?.id && m.label);
  const low = String(id).toLowerCase();
  const hit = all.find((m) => m.id === id) ?? all.find((m) => m.id.toLowerCase() === low)
    ?? (/^(sonnet|opus|haiku)$/.test(low) ? all.find((m) => m.id.toLowerCase().includes(low)) : null);
  return hit?.label ?? prettyModel(id);
}
// 3.2.1: the models the account has no usage of now (Cursor's API models after «usage limit») go last, dimmed.
const usableFirst = (list) => [...list].sort((x, y) => Number(Boolean(x.limitedUntil)) - Number(Boolean(y.limitedUntil)));
const untilShort = (ms, locale) => { const d = new Date(ms); return ms - Date.now() > 20 * 3_600_000 ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); };
const modelOf = (catalog, value) => modelsOf(catalog?.find((a) => a.id === value.agent), value.account).find((m) => m.id === (value.model ?? '')) ?? null;
// The agent's own default (id ''), named after the model the agent says it uses when it says so.
const labelOf = (a, m, t) => (m.id ? m.label : m.defaultOf ? t('brain.defaultIs', { model: m.defaultOf }) : t('brain.defaultOf', { agent: a.label }));

// value: { agent, model }; onChange({ agent, model, account }).
export function BrainPicker({ catalog, value, onChange, className }) {
  const t = useT();
  const agent = catalog?.find((a) => a.id === value.agent);
  const model = modelOf(catalog, value);
  // On the button, the agent's default reads as the model it stands for (Codex · GPT-6-Luna), without «Predeterminado».
  const label = model && agent ? (model.id === '' && model.defaultOf ? model.defaultOf : labelOf(agent, model, t)) : (value.model || t('brain.defaultModel'));
  // 3.1: with several accounts of one agent (Codex Go and Codex Pro), the button names the account in use.
  const who = agent?.accounts?.length > 1 ? agent.accounts.find((x) => x.id === value.account)?.label ?? agent.label : agent?.label;
  return (
    <DropdownMenu>
      <BubbleTip title={t('brain.title')} text={t('brain.titleText')}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={cn('max-w-64 gap-1.5', className)} data-testid="brain-picker" aria-label={t('brain.title')}>
            <AgentIcon agent={value.agent} className="size-4" />
            <span className="truncate">{who ?? value.agent} · {label}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
      </BubbleTip>
      {/* 3.2.1: closing the menu does not put the focus back on its button: that opened the bubble, which then covered
          the project picker next to it. */}
      <DropdownMenuContent align="start" className="max-h-[60vh] w-72 overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        {!catalog?.length ? <div className="text-muted-foreground px-2 py-1.5 text-xs">{t('brain.none')}</div> : <BrainGroups catalog={catalog} value={value} onChange={onChange} />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 2.6: the list folded, so it stays short: «Recomendados» first (the assistant's Claude models and Codex's usual one),
// then one group per agent; one group open at a time. The group of the brain in use says which model it is.
function BrainGroups({ catalog, value, onChange }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(null);
  const list = (a) => { const own = usableFirst(modelsOf(a, value.agent === a.id ? value.account : null)); return own.length ? own : [{ id: '', label: t('brain.defaultOf', { agent: a.label }) }]; };
  const recommended = catalog.flatMap((a) => list(a).filter((m) => m.recommended).map((m) => ({ a, m })));
  // acc: the account of a group of its own (an agent with several accounts); otherwise the one in use or the first.
  const item = (a, m, key, withAgent, acc = null) => {
    const account = acc?.id ?? (value.agent === a.id && a.accounts.some((x) => x.id === value.account) ? value.account : a.accounts[0]?.id ?? a.id);
    const on = value.agent === a.id && (value.model ?? '') === m.id && (!acc || value.account === acc.id);
    return (
      <DropdownMenuItem key={key} onSelect={() => onChange({ agent: a.id, model: m.id, account })} className={cn(m.limitedUntil && 'opacity-55')} data-testid={`brain-${acc?.id ?? a.id}-${m.id || 'default'}${withAgent ? '-rec' : ''}`}>
        {withAgent ? <AgentIcon agent={a.id} className="ml-5 size-3.5" /> : null}
        {/* 2.7: each model says what it is for (fast, balanced, most capable), so no one has to know the names. */}
        <span className={cn('grid min-w-0 flex-1', !withAgent && 'pl-5')}>
          <span className="truncate">{withAgent ? `${a.label} · ` : ''}{labelOf(a, m, t)}</span>
          {m.limitedUntil ? <span className="text-warning truncate text-[11px] leading-tight">{t('brain.noUsage', { when: untilShort(m.limitedUntil, locale) })}</span>
            : m.tier ? <span className="text-muted-foreground truncate text-[11px] leading-tight">{t(`brain.tier.${m.tier}`)}</span> : null}
        </span>
        {m.heavy ? <Flame className="text-warning! size-3.5" aria-label={t('brain.heavy')} /> : null}
        {on ? <Check className="text-primary!" /> : null}
      </DropdownMenuItem>
    );
  };
  const header = (id, icon, label, note) => (
    <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen((o) => (o === id ? null : id)); }} aria-expanded={open === id} className="text-[13px] font-medium" data-testid={`brain-group-${id}`}>
      <ChevronRight className={cn('size-3.5 transition-transform', open === id && 'rotate-90')} />{icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note ? <span className="text-muted-foreground max-w-28 truncate text-xs font-normal">{note}</span> : null}
    </DropdownMenuItem>
  );
  return (<>
    {recommended.length ? <>
      {header('rec', <Star className="text-warning! size-3.5" />, t('brain.recommended'))}
      {open === 'rec' ? recommended.map(({ a, m }) => item(a, m, `rec-${a.id}-${m.id}`, true)) : null}
      <DropdownMenuSeparator />
    </> : null}
    {catalog.map((a) => {
      // 3.1: one group per account when the agent has several (Codex Go, Codex Pro), each with its own models.
      if (a.accounts?.length > 1) return a.accounts.map((acc) => {
        const own = usableFirst(modelsOf(a, acc.id)); const models = own.length ? own : [{ id: '', label: t('brain.defaultOf', { agent: acc.label }) }];
        const current = value.agent === a.id && value.account === acc.id ? models.find((m) => m.id === (value.model ?? '')) : null;
        return (
          <div key={acc.id}>
            {header(acc.id, <AgentIcon agent={a.id} className="size-3.5" />, acc.label, current ? labelOf(a, current, t) : null)}
            {open === acc.id ? models.map((m) => item(a, m, `${acc.id}-${m.id || 'default'}`, false, acc)) : null}
          </div>
        );
      });
      const current = value.agent === a.id ? list(a).find((m) => m.id === (value.model ?? '')) : null;
      return (
        <div key={a.id}>
          {header(a.id, <AgentIcon agent={a.id} className="size-3.5" />, a.label, current ? labelOf(a, current, t) : null)}
          {open === a.id ? list(a).map((m) => item(a, m, m.id || 'default', false)) : null}
        </div>
      );
    })}
  </>);
}

export function ReasoningPicker({ value, onChange }) {
  const t = useT();
  return <Select size="sm" value={value} onValueChange={onChange} title={t('brain.reasoning')} options={options(REASONING).map((o) => ({ ...o, label: `${t('brain.reasoningShort')}: ${o.label.toLowerCase()}` }))} data-testid="reasoning-picker" />;
}

// 3.2: why the account may run out soon (or null). Only from its real usage (what the agent reports): 75 % or more, or
// 50 % with a choice that spends more (a heavy model or high reasoning). Without that figure, nothing: the model alone
// is no reason to warn (the bubble came out far too often).
export function usageWarning(catalog, value, t) {
  const agent = catalog?.find((a) => a.id === value.agent);
  const model = modelOf(catalog, value);
  const used = agent?.accounts.find((a) => a.id === value.account)?.usage ?? agent?.accounts[0]?.usage ?? null;
  if (used == null || used < 0.5) return null;
  const pct = Math.round(used * 100);
  const high = value.reasoning === 'high';
  if (high && model?.heavy) return t('brain.warnBoth', { model: model.label, pct });
  if (model?.heavy) return t('brain.warnHeavy', { model: model.label, pct });
  if (high) return t('brain.warnHigh', { pct });
  if (used >= 0.75) return t('brain.warnUsed', { pct });
  return null;
}

// The bubble above the message box, for a few seconds (or until its X).
export function UsageBubble({ text, onClose }) {
  const t = useT();
  if (!text) return null;
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 bg-card absolute bottom-full left-3 z-10 mb-3 w-max max-w-[min(24rem,calc(100%-1.5rem))] rounded-2xl border px-4 py-3 shadow-lg" role="status" data-testid="usage-bubble">
      <div className="flex items-start gap-3">
        <Lightbulb className="text-warning mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">{t('brain.warnTitle')}</div>
          <p className="text-muted-foreground mt-0.5 text-[13px] leading-snug">{text}</p>
        </div>
        <button className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 cursor-pointer rounded p-1" onClick={onClose} aria-label={t('brain.close')}><X className="size-3.5" /></button>
      </div>
      <span className="bg-card absolute -bottom-1.5 left-8 size-3 rotate-45 border-r border-b" aria-hidden="true" />
    </div>
  );
}

// 3.2: shown for 3 seconds and, once shown, not again for that account for a while (45 min, remembered on this PC); it
// stays in the bell (lib/notify.js).
const SHOW_MS = 3000;
const QUIET_MS = 45 * 60_000;
const WARNED = 'orb.usageWarned';
let warned = {}; try { warned = JSON.parse(localStorage.getItem(WARNED) || '{}') ?? {}; } catch { /* none yet */ }
export function useUsageBubble(catalog, value) {
  const t = useT();
  const text = usageWarning(catalog, value, t);
  const who = value.account ?? value.agent;
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!text) return undefined;
    const now = Date.now(); const at = warned[who] ?? 0;
    const left = at + SHOW_MS - now; // still within its seconds (shown again on the way back, or by another screen)
    if (left <= 0) {
      if (now - at < QUIET_MS) return undefined;
      warned = { ...warned, [who]: now };
      try { localStorage.setItem(WARNED, JSON.stringify(warned)); } catch { /* this session only */ }
      if (!notify({ title: t('brain.warnTitle'), body: text, tone: 'warning' }, { toast: false, ms: SHOW_MS }).show) return undefined;
    }
    setShown(text);
    const id = setTimeout(() => setShown(null), left > 0 ? left : SHOW_MS);
    return () => { clearTimeout(id); setShown(null); };
  }, [text, who]); // eslint-disable-line react-hooks/exhaustive-deps
  return { text: shown, close: () => setShown(null) };
}
