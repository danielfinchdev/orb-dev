// 3.8.3: the permission switch under a chat's box: «Auto» (works on its own inside the project folder, undo instead of
// asking) or «Preguntar» (asks before anything risky), and «⋯» with the other levels (read only, review and test, ask for
// everything, full access). value: the chat's permission ('auto', 'editar', …); onChange(permission). more: the extra
// levels [{ value, label }] (none: no «⋯»). Same height, border and radius as the model and reasoning chips next to it.
import { useEffect } from 'react';
import { Zap, Hand, Ellipsis, Check } from 'lucide-react';
import { Tip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/overlay.jsx';
import { cn } from '@/lib/utils.js';
import { t } from '@/lib/i18n.js';
import { act, bridge, call, getState, refresh, setState, useStore } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';

const SEGMENT = 'inline-flex h-full items-center gap-1 rounded-md px-2 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50';

export function AutonomySwitch({ value, onChange, more = [], disabled = false, testid = 'autonomy' }) {
  const segment = (mode, Icon, label, tip) => {
    const on = value === mode;
    return (
      <Tip label={tip}>
        <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => { if (!on) onChange(mode); }} data-testid={`${testid}-${mode}`}
          className={cn(SEGMENT, on ? (mode === 'auto' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-accent text-foreground') : 'text-muted-foreground hover:text-foreground')}>
          <Icon className="size-3.5" />{label}
        </button>
      </Tip>
    );
  };
  const other = more.find((o) => o.value === value);
  return (
    <div role="radiogroup" aria-label={t('session.permissions')} className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border p-0.5" data-testid={testid} data-mode={value}>
      {segment('auto', Zap, t('session.autoMode'), t('session.autoTip'))}
      {segment('editar', Hand, t('session.askMode'), t('session.askTip'))}
      {more.length ? (
        <DropdownMenu modal={false}>
          <Tip label={t('session.moreModes')}>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button type="button" aria-label={t('session.moreModes')} className={cn(SEGMENT, other ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid={`${testid}-more`}>
                {other ? other.label : <Ellipsis className="size-4" />}
              </button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="start">
            {more.map((o) => (
              <DropdownMenuItem key={o.value} onSelect={() => { if (o.value !== value) onChange(o.value); }} data-testid={`${testid}-${o.value}`}>
                <Check className={cn('size-4', o.value === value ? 'opacity-100' : 'opacity-0')} />{o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

// 3.8.3: the one notice that «Auto» is on (also for an install that had chats, which moved to «Auto»), once per workspace
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
