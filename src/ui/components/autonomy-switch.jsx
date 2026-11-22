// the permission selector under a chat's box: ONE dropdown (combobox + listbox) that shows the current level and lists
// them all with an icon, a short description and a mark on the current one. «Auto» (works on its own inside the project
// folder, undo instead of asking) and «Preguntar» (asks before anything risky) come first (Preguntar, then Auto), then `more` (read only, review
// and test, ask for everything, full access). value: the chat's permission ('auto', 'editar', …); onChange(permission).
// more: the extra levels [{ value, label }] (none: only Auto and Preguntar). Same height, border and radius as the model
// and reasoning chips next to it. request: { at, focus } opens the menu with «Más opciones» unfolded and the focus on the switch whose
// key is `focus`; it changes nothing by itself.
import { useEffect, useId, useRef, useState } from 'react';
import { ShieldCheck, ShieldQuestion, Eye, FlaskConical, ShieldAlert, ShieldOff, ChevronDown, ChevronRight, Check, SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, Switch } from '@/components/ui/overlay.jsx';
import { cn } from '@/lib/utils.js';
import { t } from '@/lib/i18n.js';
import { PERMISSION } from '@/lib/labels.js';
import { act, bridge, call, getState, refresh, setState, useStore } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';

const LEVEL = {
  auto: { Icon: ShieldCheck, label: () => t('session.autoMode'), tip: () => t('session.autoTip') },
  editar: { Icon: ShieldQuestion, label: () => t('session.askMode'), tip: () => t('session.askTip') },
  leer: { Icon: Eye, label: () => PERMISSION.leer, tip: () => t('session.tip.leer') },
  probar: { Icon: FlaskConical, label: () => PERMISSION.probar, tip: () => t('session.tip.probar') },
  preguntar: { Icon: ShieldAlert, label: () => PERMISSION.preguntar, tip: () => t('session.tip.preguntar') },
  total: { Icon: ShieldOff, label: () => PERMISSION.total, tip: () => t('session.tip.total') }
};

// the order of the levels under «Más opciones»: from the least to the most access.
const MORE_ORDER = ['leer', 'probar', 'preguntar', 'total'];

// main: the levels listed first (default Auto and Preguntar; none lists `more` directly, with no «Más opciones» row).
// extra: switches under the extra levels inside «Más opciones» [{ key, testid, Icon, label, tip, checked, onToggle }].
export function AutonomySwitch({ value, onChange, more = [], extra = [], main = ['editar', 'auto'], disabled = false, testid = 'autonomy', request = null }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const list = useId();
  const refs = useRef([]);
  const extras = useRef(null);
  const aim = useRef(null); // the switch the focus goes to once the menu has opened
  const meta = (v) => LEVEL[v] ?? { Icon: ShieldQuestion, label: () => PERMISSION[v] ?? String(v), tip: () => '' };
  const first = main.map((v) => ({ value: v, label: meta(v).label() }));
  const rank = (v) => { const i = MORE_ORDER.indexOf(v); return i < 0 ? MORE_ORDER.length : i; };
  const rest = more.filter((o) => !main.includes(o.value)).sort((x, y) => rank(x.value) - rank(y.value));
  const group = rest.length > 0 || extra.length > 0;
  // «Más opciones» unfolds inside this same menu; with no main levels the group is simply the menu.
  const showRest = main.length === 0 || expanded;
  const levels = showRest ? [...first, ...rest] : first;
  const current = meta(value);
  const CurrentIcon = current.Icon;
  const label = [...first, ...rest].find((o) => o.value === value)?.label ?? current.label();

  // the active option starts on the current level each time the list opens, and takes the focus.
  const begin = () => {
    const inRest = rest.some((o) => o.value === value);
    setExpanded(inRest);
    const all = inRest || main.length === 0 ? [...first, ...rest] : first;
    setAt(Math.max(0, all.findIndex((o) => o.value === value)));
  };
  useEffect(() => { if (open && !aim.current) refs.current[at]?.focus(); }, [open, at]);
  // opened from outside (the «Móvil» chip): the group is unfolded and the focus goes to the switch, once its row exists
  useEffect(() => {
    if (!request || disabled) return;
    begin(); setExpanded(true); aim.current = request.focus ?? null; setOpen(true);
  }, [request?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !aim.current) return undefined;
    let frame = 0; let tries = 0;
    const look = () => {
      const target = extra.find((x) => x.key === aim.current)?.testid;
      const el = extras.current?.querySelector(`[data-testid="${target}"]`);
      if (el) { el.focus(); aim.current = null; } else if (tries++ < 8) frame = requestAnimationFrame(look); else aim.current = null;
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v) => { setOpen(false); if (v !== value) onChange(v); };
  const key = (e) => {
    const last = levels.length - 1;
    // arrows move between the options only; the button and the switches are reached with Tab
    if (!e.target.closest?.('[role="option"]')) return;
    const go = { ArrowDown: Math.min(at + 1, last), ArrowUp: Math.max(at - 1, 0), Home: 0, End: last }[e.key];
    if (go != null) { e.preventDefault(); setAt(go); }
  };
  const option = (o, i) => {
    const { Icon, tip } = meta(o.value);
    const on = o.value === value;
    return (
      <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="option" aria-selected={on} tabIndex={i === at ? 0 : -1}
        onClick={() => pick(o.value)} data-testid={`${testid}-${o.value}`}
        className="hover:bg-accent focus-visible:bg-accent flex w-full cursor-pointer items-start gap-2 rounded-[var(--r-ctl)] px-2 py-1.5 text-left outline-none">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-control font-medium">{o.value === 'total' && !o.label.endsWith('…') ? `${o.label}…` : o.label}</span><span className="text-muted-foreground text-xs leading-snug">{tip()}</span></span>
        <Check className={cn('text-muted-foreground mt-0.5 size-4 shrink-0', on ? 'opacity-100' : 'opacity-0')} aria-hidden />
      </button>
    );
  };

  return (
    <div className="inline-flex h-[var(--ctl)] shrink-0 items-center" data-testid={testid} data-mode={value}>
      <Popover open={open} onOpenChange={(o) => { if (disabled) return; if (o) begin(); else aim.current = null; setOpen(o); }}>
        <PopoverTrigger asChild>
          <button type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={list} aria-label={t('session.permissions')} title={current.tip()} disabled={disabled}
            data-testid={`${testid}-more`}
            className={cn('inline-flex h-full items-center gap-1.5 rounded-[var(--r-ctl)] px-2 text-control whitespace-nowrap transition-colors duration-200 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
              value === 'auto' ? 'text-success' : value === 'total' ? 'border-warning/50 bg-warning-soft text-warning-ink border font-medium' : 'text-muted-foreground hover:text-foreground')}>
            <CurrentIcon className="size-3.5" />{label}<ChevronDown className="size-3.5 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-[280px] p-1">
          <div id={list} onKeyDown={key}>
            {first.length ? <div role="listbox" aria-label={t('session.permissions')}>{first.map((o, i) => option(o, i))}</div> : null}
            {main.length > 0 && group ? <hr className="border-border my-1 h-0 shrink-0 border-0 border-t" /> : null}
            {main.length > 0 && group ? (
              <button type="button" aria-expanded={expanded} aria-controls={`${list}-group`} onClick={() => setExpanded(!expanded)} data-testid={`${testid}-options`}
                className="hover:bg-accent focus-visible:bg-accent text-control flex w-full cursor-pointer items-center gap-2 rounded-[var(--r-ctl)] px-2 py-1.5 text-left outline-none">
                <SlidersHorizontal className="size-4 shrink-0" /><span className="min-w-0 flex-1">{t('session.moreOptions')}</span>
                <ChevronRight className={cn('text-muted-foreground size-4 shrink-0 transition-transform', expanded && 'rotate-90')} aria-hidden />
              </button>
            ) : null}
            {showRest ? <div id={`${list}-group`} className={cn(main.length > 0 && 'pl-2')} data-testid={`${testid}-group`}>
              {rest.length ? <div role="listbox" aria-label={main.length > 0 ? t('session.moreOptions') : t('session.permissions')}>{rest.map((o, i) => option(o, first.length + i))}</div> : null}
              {extra.length ? <hr className="border-border my-1 h-0 shrink-0 border-0 border-t" /> : null}
              {extra.length ? <div ref={extras} role="group" aria-label={t('session.extraAccess')}>
                {extra.map(({ key: k, testid: id, Icon, label: name, tip, checked, onToggle }) => (
                  <div key={k} className="flex w-full items-start gap-2 rounded-[var(--r-ctl)] px-2 py-1.5">
                    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-control font-medium">{name}</span><span id={`${list}-${k}-tip`} className="text-muted-foreground text-xs leading-snug">{tip}</span></span>
                    <Switch size="sm" checked={checked} aria-label={name} aria-describedby={`${list}-${k}-tip`} onCheckedChange={() => { if (!checked) setOpen(false); onToggle(); }} data-testid={id} />
                  </div>
                ))}
              </div> : null}
            </div> : null}
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
