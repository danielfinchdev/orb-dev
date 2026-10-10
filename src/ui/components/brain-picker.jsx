// 2.6: what the chat runs on, chosen under the message box: the brain (agent + model, one list grouped by agent), the
// reasoning and, for a direct chat, the permissions. A bubble warns when the choice spends the quota fast.
import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Flame, Lightbulb, Star, X } from 'lucide-react';
import { AgentIcon } from './agent-icon.jsx';
import { Button } from './ui/button.jsx';
import { Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, BubbleTip } from './ui/overlay.jsx';
import { call, useStore } from '@/lib/store.js';
import { PERMISSION, REASONING, options } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// The installed agents with their models (engine: models.catalog), read again when the settings change.
export function useCatalog() {
  const version = useStore((s) => s.version);
  const [catalog, setCatalog] = useState(null);
  useEffect(() => { let alive = true; call('models.catalog').then((c) => alive && setCatalog(c)).catch(() => alive && setCatalog([])); return () => { alive = false; }; }, [version]);
  return catalog;
}

const modelOf = (catalog, value) => catalog?.find((a) => a.id === value.agent)?.models.find((m) => m.id === (value.model ?? '')) ?? null;
// The agent's own default (id ''), named after the model the agent says it uses when it says so.
const labelOf = (a, m, t) => (m.id ? m.label : m.defaultOf ? t('brain.defaultIs', { model: m.defaultOf }) : t('brain.defaultOf', { agent: a.label }));

// value: { agent, model }; onChange({ agent, model, account }).
export function BrainPicker({ catalog, value, onChange, className }) {
  const t = useT();
  const agent = catalog?.find((a) => a.id === value.agent);
  const model = modelOf(catalog, value);
  // On the button, the agent's default reads as the model it stands for (Codex · GPT-6-Luna), without «Predeterminado».
  const label = model && agent ? (model.id === '' && model.defaultOf ? model.defaultOf : labelOf(agent, model, t)) : (value.model || t('brain.defaultModel'));
  return (
    <DropdownMenu>
      <BubbleTip title={t('brain.title')} text={t('brain.titleText')}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={cn('max-w-64 gap-1.5', className)} data-testid="brain-picker" aria-label={t('brain.title')}>
            <AgentIcon agent={value.agent} className="size-4" />
            <span className="truncate">{agent?.label ?? value.agent} · {label}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
      </BubbleTip>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-72 overflow-y-auto">
        {!catalog?.length ? <div className="text-muted-foreground px-2 py-1.5 text-xs">{t('brain.none')}</div> : <BrainGroups catalog={catalog} value={value} onChange={onChange} />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 2.6: the list folded, so it stays short: «Recomendados» first (the assistant's Claude models and Codex's usual one),
// then one group per agent; one group open at a time. The group of the brain in use says which model it is.
function BrainGroups({ catalog, value, onChange }) {
  const t = useT();
  const [open, setOpen] = useState(null);
  const list = (a) => (a.models.length ? a.models : [{ id: '', label: t('brain.defaultOf', { agent: a.label }) }]);
  const recommended = catalog.flatMap((a) => list(a).filter((m) => m.recommended).map((m) => ({ a, m })));
  const item = (a, m, key, withAgent) => {
    const on = value.agent === a.id && (value.model ?? '') === m.id;
    return (
      <DropdownMenuItem key={key} onSelect={() => onChange({ agent: a.id, model: m.id, account: a.accounts[0]?.id ?? a.id })} data-testid={`brain-${a.id}-${m.id || 'default'}${withAgent ? '-rec' : ''}`}>
        {withAgent ? <AgentIcon agent={a.id} className="ml-5 size-3.5" /> : null}
        <span className={cn('min-w-0 flex-1 truncate', !withAgent && 'pl-5')}>{withAgent ? `${a.label} · ` : ''}{labelOf(a, m, t)}</span>
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

export function PermissionPicker({ value, onChange, disabled }) {
  const t = useT();
  return <Select size="sm" value={value} onValueChange={onChange} disabled={disabled} title={t('brain.permissions')} options={options(PERMISSION)} data-testid="permission-picker" />;
}

// Why this choice may spend the quota fast (or null): high reasoning, a heavy model, or an account already well used.
export function usageWarning(catalog, value, t) {
  const agent = catalog?.find((a) => a.id === value.agent);
  const model = modelOf(catalog, value);
  const used = agent?.accounts.find((a) => a.id === value.account)?.usage ?? agent?.accounts[0]?.usage ?? null;
  if (value.reasoning === 'high' && model?.heavy) return t('brain.warnBoth', { model: model.label });
  if (value.reasoning === 'high') return t('brain.warnHigh');
  if (model?.heavy) return t('brain.warnHeavy', { model: model.label });
  if (used != null && used >= 0.75) return t('brain.warnUsed', { pct: Math.round(used * 100) });
  return null;
}

// The bubble above the message box. Closed with its X, it stays closed for that same choice.
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

// The bubble for a choice, shown once per choice until closed.
export function useUsageBubble(catalog, value) {
  const t = useT();
  const text = usageWarning(catalog, value, t);
  const key = `${value.agent}|${value.model}|${value.reasoning}|${text}`;
  const [closed, setClosed] = useState('');
  return { text: closed === key ? null : text, close: () => setClosed(key) };
}
