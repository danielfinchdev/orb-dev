// «Skills y MCP del proyecto» (Resumen of the project page): the connectors and skills only this project receives, and
// adding one of those already installed. A scope is kept by the engine (extensions.scope); nothing is installed here.
import { useEffect, useState } from 'react';
import { Plug, Sparkles, Plus, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/overlay.jsx';
import { MoreButton } from '@/components/ui/primitives.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { useStore, call, act, go } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { notifyOk } from '@/lib/notify.js';
import { cn } from '@/lib/utils.js';
import { projectExtensions, extensionLabel } from '@/lib/project-extensions.js';

const scope = (row, project, add) => call('extensions.scope', { kind: row.kind, name: row.name, project, add });
const toSettings = () => go({ view: 'settings', section: 'extensiones' });

// What the agents would run or read, shown before a thing is added (a connector is a program, a skill is instructions).
function Detail({ row, t }) {
  return (
    <div className="bg-secondary grid gap-1.5 rounded-card p-3 text-caption" data-testid="project-ext-detail">
      {row.kind === 'skill' ? (
        <><span className="text-muted-foreground">{t('projects.ext.reads')}</span><span className="text-foreground">{row.description || row.name}</span></>
      ) : (
        <>
          <span className="text-muted-foreground">{t('projects.ext.runs')}</span>
          <code className="text-foreground font-mono break-all">{[row.command, ...(row.args ?? [])].filter(Boolean).join(' ')}</code>
          {row.keys?.length ? <span className="text-muted-foreground">{t('projects.ext.keys', { keys: row.keys.join(', ') })}</span> : null}
        </>
      )}
      <span className="text-warning-ink">{row.enabled ? t('projects.ext.scoped', { names: (row.projects ?? []).join(', ') }) : t('projects.ext.off')}</span>
      {!row.enabled && row.projects?.length ? <span className="text-warning-ink" data-testid="project-ext-reserved">{t('projects.ext.reserved', { names: row.projects.join(', ') })}</span> : null}
    </div>
  );
}

function addDialog({ candidates, blocked = [], project, t }) {
  const keyOf = (r) => `${r.kind}:${r.name}`;
  return form(t('projects.ext.dialogTitle', { project }), {
    description: t('projects.ext.dialogDesc'),
    initial: { pick: '' },
    ok: t('projects.ext.confirm'),
    okDisabled: (v) => !v.pick,
    onOk: async (v) => {
      const row = candidates.find((r) => keyOf(r) === v.pick);
      if (!row) return false;
      await scope(row, project, true);
      notifyOk(t('projects.ext.added', { name: extensionLabel(t, row) }));
      return true;
    },
    body: (v, set) => (
      <>
        {candidates.length ? (
          <div role="radiogroup" aria-label={t('projects.ext.pick')} className="grid gap-1.5" data-testid="project-ext-options">
            {candidates.map((r) => (
              <button key={keyOf(r)} type="button" role="radio" aria-checked={v.pick === keyOf(r)} onClick={() => set({ pick: keyOf(r) })} data-testid={`project-ext-option-${r.kind}-${r.name}`}
                className={cn('press flex h-(--ctl) cursor-pointer items-center gap-2 rounded-ctl border px-3 text-left text-control', v.pick === keyOf(r) ? 'border-primary-text/60 bg-primary-soft' : 'border-border hover:bg-accent/60')}>
                {r.kind === 'skill' ? <Sparkles className="text-muted-foreground size-3.5" /> : <Plug className="text-muted-foreground size-3.5" />}
                <span className="grow truncate">{extensionLabel(t, r)}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-muted-foreground text-control" data-testid="project-ext-nothing">{t('projects.ext.nothing')}</p>}
        {blocked.length ? <p className="text-muted-foreground text-caption" data-testid="project-ext-blocked">{t('projects.ext.blocked', { names: blocked.map((r) => r.name).join(', ') })}</p> : null}
        {v.pick ? <Detail row={candidates.find((r) => keyOf(r) === v.pick)} t={t} /> : null}
        <Button type="button" variant="link" size="xs" className="text-info text-control justify-self-start font-semibold" data-testid="project-ext-install" onClick={toSettings}>{t('projects.ext.install')}</Button>
      </>
    )
  });
}

// Shell: the page's own card (PjCard), so this card draws like its neighbours.
export function ProjectExtensionsCard({ p, Shell }) {
  const t = useT();
  const [data, setData] = useState(null);
  const changed = useStore((s) => s.app?.config);
  const load = () => call('extensions.list').then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [changed, p.name]);
  const { mine, sharedCount, candidates, blocked } = projectExtensions(data, p.name);
  const add = async () => { await addDialog({ candidates, blocked, project: p.name, t }); load(); };
  const remove = async (row) => {
    const label = extensionLabel(t, row);
    const last = (row.projects ?? []).length <= 1;
    if (last && !await confirm(t('projects.ext.removeLastTitle', { name: label }), t('projects.ext.removeLastBody', { name: label }), { ok: t('projects.ext.remove') })) return;
    const r = await act(scope(row, p.name, false), t(last ? 'projects.ext.removedOff' : 'projects.ext.removed', { name: label }));
    if (r?.skills) setData(r); else load();
  };
  return (
    <Shell icon={Plug} title={t('projects.ext.title')} data-testid="project-extensions"
      aside={<Button variant="outline" onClick={add} disabled={!data} data-testid="project-ext-add"><Plus />{t('projects.ext.add')}</Button>}>
      {mine.length ? mine.map((r) => (
        <div key={`${r.kind}:${r.name}`} className="flex items-center gap-2 text-control" data-testid="project-ext-row">
          {r.kind === 'skill' ? <Sparkles className="text-muted-foreground size-3.5" /> : <Plug className="text-muted-foreground size-3.5" />}
          <span className="grow truncate">{extensionLabel(t, r)}</span>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><MoreButton small label={t('projects.ext.more', { name: extensionLabel(t, r) })} data-testid="project-ext-menu" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => remove(r)} data-testid="project-ext-remove"><UserMinus />{t('projects.ext.remove')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )) : <p className="text-muted-foreground text-control" data-testid="project-ext-empty">{t('projects.ext.none')}</p>}
      {sharedCount ? (
        <p className="text-faint-foreground text-caption" data-testid="project-ext-shared">
          {t('projects.ext.shared', { n: sharedCount })} · <button type="button" className="text-info underline" onClick={toSettings}>{t('projects.ext.sharedLink')}</button>
        </p>
      ) : null}
    </Shell>
  );
}
