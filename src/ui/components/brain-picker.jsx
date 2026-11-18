// what the chat runs on, chosen under the message box: the brain (agent + model, one list grouped by agent), the
// reasoning and, for a direct chat, the permissions. A bubble warns when the account's usage runs high.
import { useEffect, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, Flame, Lightbulb, Star, X } from 'lucide-react';
import { AgentIcon } from './agent-icon.jsx';
import { Button } from './ui/button.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, BubbleTip } from './ui/overlay.jsx';
import { ModelGuide } from './model-guide.jsx';
import { form } from './dialogs.jsx';
import { call, getState, useStore } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { prettyModel } from '@/lib/tools.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { keepIfSame } from '@/lib/memo.js';
import { useFavoriteBrains, toggleFavoriteBrain } from '@/lib/favorite-brains.js';
import { isFavorite } from '../../shared/favorite-brains.mjs';

// The installed agents with their models (engine: models.catalog), read again when the settings change. The
// same catalog stays the same object (the memoised blocks of a direct conversation compare it by reference, and the app's
// version changes several times a second while an agent works).
export function useCatalog() {
  const version = useStore((s) => s.version);
  const [catalog, setCatalog] = useState(null);
  useEffect(() => { let alive = true; call('models.catalog').then((c) => alive && setCatalog((prev) => keepIfSame(prev, c))).catch(() => alive && setCatalog((prev) => keepIfSame(prev, []))); return () => { alive = false; }; }, [version]);
  return catalog;
}

// an account with its own plan has its own models (Codex Go and Pro); the others use the agent's list.
export const modelsOf = (a, account) => (account && a?.accountModels?.[account]) || a?.models || [];
// a model's name as the selector shows it, wherever the id comes from (an alias like «sonnet», the full id the
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
// the models the account has no usage of now (Cursor's API models after «usage limit») go last, dimmed.
const usableFirst = (list) => [...list].sort((x, y) => Number(Boolean(x.limitedUntil)) - Number(Boolean(y.limitedUntil)));
const untilShort = (ms, locale) => { const d = new Date(ms); return ms - Date.now() > 20 * 3_600_000 ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); };
const modelOf = (catalog, value) => modelsOf(catalog?.find((a) => a.id === value.agent), value.account).find((m) => m.id === (value.model ?? '')) ?? null;
// The agent's own default (id ''), named after the model the agent says it uses when it says so.
const labelOf = (a, m, t) => (m.id ? m.label : m.defaultOf ? t('brain.defaultIs', { model: m.defaultOf }) : t('brain.defaultOf', { agent: a.label }));

// «Codex Pro · GPT-6 · Alto»: what a favourite says on its row (and to the screen reader).
export function favoriteLabel(catalog, f, t) {
  const agent = catalog?.find((a) => a.id === f.agent);
  const account = agent?.accounts?.length > 1 ? agent.accounts.find((x) => x.id === f.account)?.label ?? agent.label : agent?.label ?? f.agent;
  const model = f.model ? modelLabel(catalog, f.agent, f.model) : modelOf(catalog, f)?.defaultOf ?? '';
  return [account, model, t(`reasoning.${f.reasoning}`)].filter(Boolean).join(' · ');
}

// value: { agent, model, account, reasoning }; onChange({ agent, model, account }); a favourite also brings its reasoning.
export function BrainPicker({ catalog, value, onChange, className }) {
  const t = useT();
  const agent = catalog?.find((a) => a.id === value.agent);
  const model = modelOf(catalog, value);
  // On the button, the agent's default reads as the model it stands for (Codex · GPT-6-Luna), without «Predeterminado».
  // with no model chosen and none the agent names, just the agent («Claude»), never «predeterminado».
  const label = !value.model ? (model?.defaultOf ?? '') : model && agent ? labelOf(agent, model, t) : modelLabel(catalog, value.agent, value.model);
  // with several accounts of one agent (Codex Go and Codex Pro), the button names the account in use.
  const who = agent?.accounts?.length > 1 ? agent.accounts.find((x) => x.id === value.account)?.label ?? agent.label : agent?.label;
  return (
    <DropdownMenu>
      <BubbleTip title={t('brain.title')} text={t('brain.titleText')}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={cn('max-w-64 gap-1.5', className)} data-testid="brain-picker" aria-label={t('brain.title')}>
            <AgentIcon agent={value.agent} className="size-4" />
            {/* on a phone, the model only (the icon says the agent), so the row stays on one line. */}
            <span className="truncate">{label ? <><span className="max-sm:hidden">{who ?? value.agent} · </span>{label}</> : <span className="max-sm:hidden">{who ?? value.agent}</span>}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
      </BubbleTip>
      {/* closing the menu does not put the focus back on its button: that opened the bubble, which then covered
          the project picker next to it. */}
      <DropdownMenuContent align="start" className="max-h-[60vh] w-72 overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        {!catalog?.length ? <div className="text-muted-foreground px-2 py-1.5 text-xs">{t('brain.none')}</div> : <><BrainFavorites catalog={catalog} value={value} onChange={onChange} /><BrainGroups catalog={catalog} value={value} onChange={onChange} /></>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The favourites on top (a click picks model, reasoning and account together) and the star that marks the brain in use.
function BrainFavorites({ catalog, value, onChange }) {
  const t = useT();
  const list = useFavoriteBrains();
  const on = isFavorite(list, value);
  return (<>
    {list.length ? <>
      <DropdownMenuLabel>{t('brain.favorites')}</DropdownMenuLabel>
      {list.map((f) => (
        <DropdownMenuItem key={`${f.agent}|${f.account}|${f.model}|${f.reasoning}`} onSelect={() => onChange(f)} data-testid="brain-favorite">
          <Star className="text-warning! size-3.5 fill-current" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{favoriteLabel(catalog, f, t)}</span>
          {value.agent === f.agent && (value.model ?? '') === f.model && value.reasoning === f.reasoning && (value.account || value.agent) === f.account ? <Check className="text-primary-text!" /> : null}
        </DropdownMenuItem>
      ))}
    </> : null}
    <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggleFavoriteBrain(value); }} aria-pressed={on} data-testid="brain-favorite-toggle">
      <Star className={cn('size-3.5', on && 'text-warning! fill-current')} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{on ? t('brain.unfavorite') : t('brain.favorite')}</span>
    </DropdownMenuItem>
    <DropdownMenuSeparator />
  </>);
}

// the list folded, so it stays short: «Recomendados» first (the assistant's Claude models and Codex's usual one),
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
        {/* each model says what it is for (fast, balanced, most capable), so no one has to know the names. */}
        <span className={cn('grid min-w-0 flex-1', !withAgent && 'pl-5')}>
          <span className="truncate">{withAgent ? `${a.label} · ` : ''}{labelOf(a, m, t)}</span>
          {m.limitedUntil ? <span className="text-warning-ink truncate text-micro leading-tight">{t('brain.noUsage', { when: untilShort(m.limitedUntil, locale) })}</span>
            : m.tier ? <span className="text-muted-foreground truncate text-micro leading-tight">{t(`brain.tier.${m.tier}`)}</span> : null}
        </span>
        {m.heavy ? <Flame className="text-warning! size-3.5" aria-label={t('brain.heavy')} /> : null}
        {on ? <Check className="text-primary-text!" /> : null}
      </DropdownMenuItem>
    );
  };
  const header = (id, icon, label, note) => (
    <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen((o) => (o === id ? null : id)); }} aria-expanded={open === id} className="text-control font-medium" data-testid={`brain-group-${id}`}>
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
      // one group per account when the agent has several (Codex Go, Codex Pro), each with its own models.
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

// the reasoning levels Orb offers; «Extra» (xhigh) only for the models whose agent says they take it.
export const REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh'];
const USUAL_LEVELS = ['low', 'medium', 'high'];
function levelsFor(catalog, value) {
  const m = modelOf(catalog, value);
  return m?.efforts?.length ? REASONING_LEVELS.filter((l) => m.efforts.includes(l)) : USUAL_LEVELS;
}

// the reasoning (DESIGN-SYSTEM §2.2) as a brain button that opens Bajo · Medio · Alto · Extra (the levels the model
// takes), the current one ticked. Each option says its relative usage under its name and, on hover, the usual tasks for
// it. value: { agent, model, account, reasoning }; levels: to give the list instead of reading it from the catalog.
export function ReasoningMenu({ catalog, value, onChange, levels, disabled }) {
  const t = useT();
  const list = levels ?? levelsFor(catalog, value);
  const current = list.includes(value.reasoning) ? value.reasoning : value.reasoning === 'xhigh' ? 'high' : (value.reasoning ?? 'medium');
  const name = t(`reasoning.${current}`);
  return (
    <DropdownMenu>
      <BubbleTip title={t('reasoning.title', { level: name })} text={t('reasoning.titleText')} side="top">
        <DropdownMenuTrigger asChild>
          {/* a quiet chip with the chosen level («Alto») and its bars, as tall as the model picker. */}
          <Button variant="ghost" size="sm" className="text-muted-foreground shrink-0 gap-1.5 px-2 font-normal" disabled={disabled} aria-label={t('reasoning.title', { level: name })} data-testid="reasoning-picker" data-level={current}>
            <span data-testid="reasoning-level">{name}</span><UsageMeter level={current} />
          </Button>
        </DropdownMenuTrigger>
      </BubbleTip>
      <DropdownMenuContent align="start" side="top" className="w-48" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="reasoning-menu">
        <DropdownMenuLabel>{t('brain.reasoning')}</DropdownMenuLabel>
        {list.map((level) => (
          // The bubble right next to the option: what it suits and, once, how much it uses.
          <BubbleTip key={level} title={t(`reasoning.${level}`)} text={`${t(`reasoning.tasks.${level}`)} ${t(`reasoning.use.${level}`)}.`} side="right" align="center" offset={10}>
            <DropdownMenuItem onSelect={() => onChange(level)} data-testid={`reasoning-${level}`} data-selected={current === level || undefined}>
              <span className="min-w-0 flex-1">{t(`reasoning.${level}`)}</span>
              <UsageMeter level={level} />
              <Check className={cn('text-primary-text!', current === level ? null : 'invisible')} />
            </DropdownMenuItem>
          </BubbleTip>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// One chip for the agent, its model and its reasoning under a conversation's box (mock-up 01-chat) and one menu with the
// models, the reasoning levels and «Guía de modelos». models: [{ value, label }] of the agent; the reasoning list is the
// one the model takes («Extra» only where the agent has it). The chip is the model picker; the level and its bars inside it
// are the reasoning picker (same test ids as when they were two buttons).
export function AgentChip({ catalog, agent, account, models, model, modelName, reasoning, onModel, onReasoning, disabled }) {
  const t = useT();
  const list = levelsFor(catalog, { agent, account, model });
  const current = list.includes(reasoning) ? reasoning : reasoning === 'xhigh' ? 'high' : (reasoning ?? 'medium');
  const name = t(`reasoning.${current}`);
  return (
    <DropdownMenu>
      <BubbleTip title={t('brain.title')} text={t('brain.titleText')} side="top">
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={disabled} aria-label={t('brain.title')} data-testid="session-model"
            className="text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground inline-flex h-[var(--ctl)] max-w-64 min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-[var(--r-ctl)] px-2 text-control whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50">
            <AgentIcon agent={agent} className="size-3.5 shrink-0 opacity-70" />
            {modelName ? <span className="truncate">{modelName}</span> : null}
            <span className="text-faint-foreground inline-flex shrink-0 items-center gap-1.5" data-testid="reasoning-picker" data-level={current}>
              <span data-testid="reasoning-level">{name}</span><UsageMeter level={current} />
            </span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
      </BubbleTip>
      <DropdownMenuContent align="end" side="top" className="max-h-[70vh] w-[240px] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="reasoning-menu">
        {models.length ? <>
          <DropdownMenuLabel>{t('session.model')}</DropdownMenuLabel>
          {models.map((m) => (
            <DropdownMenuItem key={m.value} onSelect={() => onModel(m.value)} data-testid={`session-model-${m.value}`} data-selected={m.value === model || undefined}>
              <span className="min-w-0 flex-1 truncate">{m.label}</span>
              <Check className={cn('text-muted-foreground!', m.value === model ? null : 'invisible')} />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </> : null}
        <ReasoningTail list={list} current={current} onReasoning={onReasoning} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The reasoning levels and «Guía de modelos», the end of the menu of AgentChip and BrainChip.
function ReasoningTail({ list, current, onReasoning }) {
  const t = useT();
  const guide = () => form(t('guide.open'), { wide: true, body: () => <ModelGuide auto={getState().app?.config?.budget?.autoModel !== false} />, ok: t('comp.dialogs.ok') });
  return (<>
    <DropdownMenuLabel>{t('brain.reasoning')}</DropdownMenuLabel>
    {list.map((level) => (
      <BubbleTip key={level} title={t(`reasoning.${level}`)} text={`${t(`reasoning.tasks.${level}`)} ${t(`reasoning.use.${level}`)}.`} side="right" align="center" offset={10}>
        <DropdownMenuItem onSelect={() => onReasoning(level)} data-testid={`reasoning-${level}`} data-selected={current === level || undefined}>
          <span className="min-w-0 flex-1">{t(`reasoning.${level}`)}</span>
          <UsageMeter level={level} />
          <Check className={cn('text-muted-foreground!', current === level ? null : 'invisible')} />
        </DropdownMenuItem>
      </BubbleTip>
    ))}
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={guide} data-testid="model-guide-open"><BookOpen />{t('guide.open')}</DropdownMenuItem>
  </>);
}

// The chip of the chat with the assistant, where the agent can also be changed: the same chip as AgentChip (agent icon, model and
// reasoning with its bars) and, in its menu, the favourites and the models of every agent (BrainPicker's) before the levels.
// value: { agent, model, account, reasoning }; onChange({ agent, model, account }); onReasoning(level).
export function BrainChip({ catalog, value, onChange, onReasoning, className }) {
  const t = useT();
  const agent = catalog?.find((a) => a.id === value.agent);
  const model = modelOf(catalog, value);
  const label = !value.model ? (model?.defaultOf ?? '') : model && agent ? labelOf(agent, model, t) : modelLabel(catalog, value.agent, value.model);
  const list = levelsFor(catalog, value);
  const current = list.includes(value.reasoning) ? value.reasoning : value.reasoning === 'xhigh' ? 'high' : (value.reasoning ?? 'medium');
  return (
    <DropdownMenu>
      <BubbleTip title={t('brain.title')} text={t('brain.titleText')} side="top">
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t('brain.title')} data-testid="brain-picker"
            className={cn('text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground inline-flex h-[var(--ctl)] max-w-64 min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-[var(--r-ctl)] px-2 text-control whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50', className)}>
            <AgentIcon agent={value.agent} className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">{label || (agent?.label ?? value.agent)}</span>
            <span className="text-faint-foreground inline-flex shrink-0 items-center gap-1.5" data-testid="reasoning-picker" data-level={current}>
              <span data-testid="reasoning-level">{t(`reasoning.${current}`)}</span><UsageMeter level={current} />
            </span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
      </BubbleTip>
      <DropdownMenuContent align="end" side="top" className="max-h-[70vh] w-72 overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="reasoning-menu">
        {!catalog?.length ? <div className="text-muted-foreground px-2 py-1.5 text-xs">{t('brain.none')}</div> : <><BrainFavorites catalog={catalog} value={value} onChange={onChange} /><BrainGroups catalog={catalog} value={value} onChange={onChange} /></>}
        <DropdownMenuSeparator />
        <ReasoningTail list={list} current={current} onReasoning={onReasoning} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// four small bars, as many filled as the level uses (Bajo 1 … Extra 4); the words are in the option's bubble.
const METER = { low: 1, medium: 2, high: 3, xhigh: 4 };
function UsageMeter({ level }) {
  const n = METER[level] ?? 2;
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden="true" data-testid="reasoning-meter" data-bars={n}>
      {[0, 1, 2, 3].map((i) => <span key={i} className={cn('w-[3px] rounded-[1px]', i < n ? 'bg-primary-text' : 'bg-muted-foreground/25')} style={{ height: `${5 + i * 2.3}px` }} />)}
    </span>
  );
}

// why the account may run out soon (or null). Only from its real usage (what the agent reports): 75 % or more, or
// 50 % with a choice that spends more (a heavy model or high reasoning). Without that figure, nothing: the model alone
// is no reason to warn (the bubble came out far too often).
function usageWarning(catalog, value, t) {
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
        <Lightbulb className="text-warning-ink mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium">{t('brain.warnTitle')}</div>
          <p className="text-muted-foreground mt-0.5 text-control leading-snug">{text}</p>
        </div>
        <button className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 cursor-pointer rounded p-1" onClick={onClose} aria-label={t('brain.close')}><X className="size-3.5" /></button>
      </div>
      <span className="bg-card absolute -bottom-1.5 left-8 size-3 rotate-45 border-r border-b" aria-hidden="true" />
    </div>
  );
}

// shown for 3 seconds and, once shown, not again for that account for a while (45 min, remembered on this PC); it
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
