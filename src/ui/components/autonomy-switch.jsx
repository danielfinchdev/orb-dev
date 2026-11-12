// the permission selector under a chat's box: ONE dropdown (combobox + listbox) that shows the current level and lists
// them all with an icon, a short description and a mark on the current one. «Auto» (works on its own inside the project
// folder, undo instead of asking) and «Preguntar» (asks before anything risky) come first, then `more` (read only, review
// and test, ask for everything, full access). value: the chat's permission ('auto', 'editar', …); onChange(permission).
// more: the extra levels [{ value, label }] (none: only Auto and Preguntar). Same height, border and radius as the model
// and reasoning chips next to it.
import { useEffect, useId, useRef, useState } from 'react';
import { Zap, Hand, Eye, FlaskConical, MessageCircleQuestion, ShieldAlert, ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/overlay.jsx';
import { cn } from '@/lib/utils.js';
import { t } from '@/lib/i18n.js';
import { PERMISSION } from '@/lib/labels.js';
import { act, bridge, call, getState, refresh, setState, useStore } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';

const LEVEL = {
  auto: { Icon: Zap, label: () => t('session.autoMode'), tip: () => t('session.autoTip') },
  editar: { Icon: Hand, label: () => t('session.askMode'), tip: () => t('session.askTip') },
  leer: { Icon: Eye, label: () => PERMISSION.leer, tip: () => t('session.tip.leer') },
  probar: { Icon: FlaskConical, label: () => PERMISSION.probar, tip: () => t('session.tip.probar') },
  preguntar: { Icon: MessageCircleQuestion, label: () => PERMISSION.preguntar, tip: () => t('session.tip.preguntar') },
  total: { Icon: ShieldAlert, label: () => PERMISSION.total, tip: () => t('session.tip.total') }
};

export function AutonomySwitch({ value, onChange, more = [], disabled = false, testid = 'autonomy' }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const list = useId();
  const refs = useRef([]);
  const levels = [
    { value: 'auto', label: LEVEL.auto.label() },
    { value: 'editar', label: LEVEL.editar.label() },
    ...more.filter((o) => o.value !== 'auto' && o.value !== 'editar')
  ];
  const meta = (v) => LEVEL[v] ?? { Icon: Hand, label: () => PERMISSION[v] ?? String(v), tip: () => '' };
  const current = meta(value);
  const CurrentIcon = current.Icon;
  const label = levels.find((o) => o.value === value)?.label ?? current.label();

  // the active option starts on the current level each time the list opens, and takes the focus.
  useEffect(() => {
    if (!open) return;
    setAt(Math.max(0, levels.findIndex((o) => o.value === value)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) refs.current[at]?.focus(); }, [open, at]);

  const pick = (v) => { setOpen(false); if (v !== value) onChange(v); };
  const key = (e) => {
    const last = levels.length - 1;
    const go = { ArrowDown: Math.min(at + 1, last), ArrowUp: Math.max(at - 1, 0), Home: 0, End: last }[e.key];
    if (go != null) { e.preventDefault(); setAt(go); }
  };

  return (
    <div className="inline-flex h-8 shrink-0 items-center" data-testid={testid} data-mode={value}>
      <Popover open={open} onOpenChange={(o) => { if (disabled) return; if (o) setAt(Math.max(0, levels.findIndex((l) => l.value === value))); setOpen(o); }}>
        <PopoverTrigger asChild>
          <button type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={list} aria-label={t('session.permissions')} title={current.tip()} disabled={disabled}
            data-testid={`${testid}-more`}
            className={cn('inline-flex h-full items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
              value === 'auto' ? 'bg-success-soft text-success' : value === 'total' ? 'border-warning/50 bg-warning-soft text-warning-ink' : 'text-foreground')}>
            <CurrentIcon className="size-3.5" />{label}<ChevronDown className="size-3.5 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-72 p-1">
          <div id={list} role="listbox" aria-label={t('session.permissions')} onKeyDown={key}>
            {levels.map((o, i) => {
              const { Icon, tip } = meta(o.value);
              const on = o.value === value;
              return (
                <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="option" aria-selected={on} tabIndex={i === at ? 0 : -1}
                  onClick={() => pick(o.value)} data-testid={`${testid}-${o.value}`}
                  className="hover:bg-accent focus-visible:bg-accent flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none">
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-[13px] font-medium">{o.label}</span><span className="text-muted-foreground text-xs leading-snug">{tip()}</span></span>
                  <Check className={cn('mt-0.5 size-4 shrink-0', on ? 'opacity-100' : 'opacity-0')} aria-hidden />
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// the one notice that «Auto» is on (also for an install that had chats, which moved to «Auto»), once per workspace
// (orb.json › ui.autoNoticed), with «Usar Preguntar» one click away. Not on the phone, nor before the first-run tour ends.
export function AutoNotice() {
  const ready = useStore((s) => Boolean(s.app?.config) && s.app.config.ui?.autoNoticed !== true && s.app.config.ui?.tourDone === true);
  useEffect(() => {
    if (bridge.mobile || !ready) return undefined;
    const id = setTimeout(async () => {
      const config = await call('config.save', { patch: { ui: { autoNoticed: true } } }).catch(() => null);
      if (!config) return;
      setState({ app: { ...getState().app, config } });
      if (config.permissions?.mode === 'preguntar') return;
      notify({ title: t('auto.noticeTitle'), body: t('msg.auto.notice'), tone: 'info', action: { label: t('auto.noticeAsk'), onClick: () => act(call('permissions.setMode', { mode: 'preguntar' }), t('session.askOn')).then(() => refresh()) } }, { ms: 20_000 });
    }, 3000);
    return () => clearTimeout(id);
  }, [ready]);
  return null;
}
