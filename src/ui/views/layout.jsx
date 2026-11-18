// «Ordenar carpetas»: the folders an earlier Orb kept at the top of the workspace (bitacora, android\adb-tools,
// each server in mcp-servers) and what to do with each. Nothing moves until «Aplicar» (src/domain/workspace/core-folder.mjs ›
// applyLayout); a folder some program is using stops it all with a clear message and «Reintentar». Shown after the
// welcome and when an updated Orb finds them (main.jsx, phase 'layout'). When the logs went into core, a last
// screen says once where they are now (other tools, like the user's AGENTS.md or CLAUDE.md, must point there).
import { useState } from 'react';
import { BookOpen, Copy, FolderCheck, Plug, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Spinner } from '@/components/ui/basic.jsx';
import { Select } from '@/components/ui/overlay.jsx';
import { Segmented, ListCard } from '@/components/ui/primitives.jsx';
import { WizardPage, WizardCard, WizardFoot, WizardText, WizardTitle, StartMark } from '@/components/wizard.jsx';
import { bridge } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { layoutOptions, layoutTitle } from '@/lib/core-access.js';
import { notifyError } from '@/lib/notify.js';

const KIND_ICON = { logs: BookOpen, adb: Smartphone, mcp: Plug };
const H2 = 'm-0 font-(family-name:--title) text-dialog leading-[1.45] font-semibold';

// step: 'carpetas' when it is a step of the welcome (its row of steps on top); none when an updated Orb finds the folders.
// applyMethod: the call that applies it; «Ordenar carpetas» on demand uses projects.layoutApply (the same, refused while
// anything is working).
export function LayoutReview({ plan, onDone, step = null, applyMethod = 'app.layoutApply' }) {
  const t = useT();
  const items = (plan?.items ?? []).filter((it) => !it.kept);
  const [choices, setChoices] = useState(() => Object.fromEntries(items.map((it) => [it.id, it.choice])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [moved, setMoved] = useState(null); // { logs: { dir, files } | null, servers: [{ from, to }] }: what moved
  const apply = async (all) => {
    setBusy(true); setError('');
    try {
      const r = await bridge.call(applyMethod, { choices: all ?? choices });
      if (r?.logsMoved || r?.serversMoved?.length) setMoved({ logs: r.logsMoved ?? null, servers: r.serversMoved ?? [] }); else onDone();
    }
    catch (e) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  // the label over the title says when this step shows (the mock-up's kicker)
  const kick = step ? `${t('setup.kick', { n: 3 })} · ${t('layout.kickReview')}` : null;
  if (moved) return <Moved logs={moved.logs} servers={moved.servers} onDone={onDone} step={step} kick={step ? `${t('setup.kick', { n: 3 })} · ${t('layout.kickMoved')}` : null} />;
  const toCore = items.some((it) => ['move', 'mcp'].includes(choices[it.id]));
  return (
    <WizardPage step={step} data-testid="layout-review">
      <WizardCard kick={kick}>
        <WizardTitle>{t('layout.title')}</WizardTitle>
        <WizardText>{t('layout.intro', { home: plan?.home ?? '' })}</WizardText>
        <ListCard>
          {items.map((it) => {
            const Icon = KIND_ICON[it.kind] ?? Plug;
            const options = layoutOptions(it).map((o) => ({ value: o.value, label: t(o.key, o.vars) }));
            const set = (v) => setChoices({ ...choices, [it.id]: v });
            return (
              <div key={it.id} className="border-border flex min-w-0 flex-wrap items-start gap-3 px-3.5 py-3 not-first:border-t" data-testid={`layout-item-${it.id}`}>
                <Icon className="text-muted-foreground mt-0.5 size-4 flex-none" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-control leading-[1.45] font-medium">{t(layoutTitle(it))}{it.kind === 'logs' ? <Badge variant="success" className="ml-2 align-middle" data-testid="layout-logs-recommended">{t('layout.recommended')}</Badge> : null}</div>
                  <div className="text-muted-foreground mt-0.5 text-caption leading-[1.45]">
                    <code className="font-mono break-all">{it.name}</code>
                    {it.project ? <> · {t('layout.mcpProject')}</> : null}
                    {it.kind === 'logs' ? <span data-testid="layout-logs-note"> · {t('layout.logsNote')}</span> : null}
                  </div>
                </div>
                {options.length <= 2
                  ? <Segmented role="group" aria-label={t(layoutTitle(it))} value={choices[it.id]} onChange={(v) => { if (!busy) set(v); }} options={options.map((o) => ({ ...o, testid: `layout-choice-${it.id}-${o.value}` }))} data-testid={`layout-choice-${it.id}`} />
                  : <Select className="w-full sm:w-56" value={choices[it.id]} disabled={busy} onValueChange={set} options={options} data-testid={`layout-choice-${it.id}`} />}
              </div>
            );
          })}
        </ListCard>
        <WizardText>{toCore ? `${t('layout.coreNote')} ` : ''}{t('layout.pathsNote')}</WizardText>
        {error ? <p className="text-destructive m-0 text-control" role="alert" data-testid="layout-error">{error}</p> : null}
        <WizardFoot>
          <Button variant="outline" disabled={busy} onClick={() => apply(Object.fromEntries(items.map((it) => [it.id, 'keep'])))} data-testid="layout-keep-all">{t('layout.keepAll')}</Button>
          <Button disabled={busy} onClick={() => apply()} data-testid="layout-apply">{busy ? <Spinner className="border-primary-foreground/40 border-t-primary-foreground" /> : null}{t(error ? 'layout.retry' : 'layout.apply')}</Button>
        </WizardFoot>
      </WizardCard>
    </WizardPage>
  );
}

// The logs (and the MCP servers) are in their new place now: exactly where, and what to change outside Orb.
function Path({ p, testid }) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 font-mono text-caption break-all" data-testid={testid}>{p}</code>
      <Button variant="ghost" size="icon-xs" title={t('layout.copyPath')} aria-label={t('layout.copyPath')} onClick={() => navigator.clipboard?.writeText(p).catch(() => notifyError(t('app.copyFailed')))}><Copy /></Button>
    </div>
  );
}
const DoneBox = ({ children, ...props }) => <div className="bg-card border-border rounded-card flex flex-col items-start gap-3 border p-4" {...props}>{children}</div>;
function Moved({ logs, servers = [], onDone, step, kick }) {
  const t = useT();
  return (
    <WizardPage step={step} data-testid="layout-logs-moved">
      <WizardCard kick={kick}>
        {logs ? <LogsMoved moved={logs} /> : null}
        {servers.length ? (
          <DoneBox data-testid="layout-servers-moved">
            <StartMark icon={FolderCheck} mood="happy" />
            <h2 className={H2}>{t('layout.serversMovedTitle')}</h2>
            <WizardText>{t('layout.serversMovedIntro')}</WizardText>
            {servers.map((m) => (
              <div key={m.to} className="grid gap-1 self-stretch">
                <span className="text-muted-foreground truncate font-mono text-caption line-through">{m.from}</span>
                <Path p={m.to} testid="layout-server-path" />
              </div>
            ))}
            <WizardText>{t('layout.serversMovedNote')}</WizardText>
          </DoneBox>
        ) : null}
        <WizardFoot><Button onClick={onDone} data-testid="layout-logs-ok">{t('layout.continue')}</Button></WizardFoot>
      </WizardCard>
    </WizardPage>
  );
}
function LogsMoved({ moved }) {
  const t = useT();
  const files = moved.files?.length ? moved.files : [moved.dir];
  return (
    <>
      <DoneBox>
        <StartMark icon={FolderCheck} mood="happy" />
        <h2 className={H2}>{t('layout.logsMovedTitle')}</h2>
        <WizardText>{t('layout.logsMovedIntro')}</WizardText>
        <div className="grid gap-2 self-stretch">
          {files.map((f) => (
            <div key={f} className="grid gap-1">
              <Path p={f} testid="layout-logs-path" />
              {moved.readOnly?.includes(f) ? <span className="text-muted-foreground text-caption" data-testid="layout-logs-readonly">{t('layout.logsReadOnly')}</span> : null}
            </div>
          ))}
        </div>
      </DoneBox>
      <WizardText>{t('layout.logsMovedNote')}</WizardText>
    </>
  );
}
