// «Hacer commit…» in the chat's header: the project's changed files, the message Orb proposes (editable) and two buttons,
// «Commit» and «Commit y push». The push is the engine's (never forced, nothing key-shaped leaves); only this PC's window.
import { useEffect, useRef, useState } from 'react';
import { GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, BubbleTip, Checkbox } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Textarea, Spinner } from '@/components/ui/basic.jsx';
import { call } from '@/lib/store.js';
import { notifyError, notifyOk } from '@/lib/notify.js';
import { errorText } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';

function CommitBody({ project, onClose }) {
  const t = useT();
  const [files, setFiles] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [message, setMessage] = useState('');
  const [guess, setGuess] = useState(false);
  const [writing, setWriting] = useState(true);
  const [busy, setBusy] = useState(false);
  const ticket = useRef(0);
  const suggest = () => {
    const mine = ++ticket.current; setWriting(true);
    call('projects.commitSuggest', { name: project }).then((r) => { if (mine !== ticket.current) return; setMessage(r.message ?? ''); setGuess(r.source === 'guess'); }).catch(quiet).finally(() => { if (mine === ticket.current) setWriting(false); });
  };
  useEffect(() => {
    let alive = true;
    call('projects.commitFiles', { name: project }).then((list) => { if (!alive) return; setFiles(list); setPicked(new Set(list.filter((f) => !f.risky).map((f) => f.path))); if (list.some((f) => !f.risky)) suggest(); else setWriting(false); })
      .catch((e) => { notifyError(errorText(e)); onClose(); });
    return () => { alive = false; ticket.current += 1; };
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (p) => setPicked((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const run = async (push) => {
    setBusy(true);
    try {
      const r = await call('projects.commit', { name: project, message, files: [...picked], push });
      if (push && r.pushed === false) notifyError(t('commit.pushFailed', { detail: r.pushError ?? '' }));
      else notifyOk(push ? t('commit.donePush', { branch: r.branch }) : t('commit.done', { files: r.files }));
      onClose(true);
    } catch (e) { notifyError(errorText(e)); } finally { setBusy(false); }
  };
  const ready = picked.size > 0 && message.trim().length > 0 && !busy;
  return (
    <>
      <DialogHeader><DialogTitle>{t('commit.title')}</DialogTitle><DialogDescription>{t('commit.desc')}</DialogDescription></DialogHeader>
      {!files ? <Spinner /> : !files.length ? <p className="text-muted-foreground text-sm" data-testid="commit-none">{t('commit.none')}</p> : (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <div className="text-muted-foreground text-xs font-medium">{t('commit.files')}</div>
            <ul className="border-border max-h-48 overflow-auto rounded-md border p-1.5" data-testid="commit-files">
              {files.map((f) => (
                <li key={f.path}>
                  <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs">
                    <Checkbox checked={picked.has(f.path)} disabled={f.risky} onCheckedChange={() => toggle(f.path)} aria-label={f.path} />
                    <span className="text-muted-foreground w-5 shrink-0 font-mono">{f.status}</span>
                    <bdi className="min-w-0 flex-1 truncate font-mono" title={f.path}>{f.path}</bdi>
                    {f.risky ? <span className="text-warning-ink shrink-0">{t('commit.risky')}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-muted-foreground text-xs font-medium">{t('commit.message')}</div>
              <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={writing || busy} onClick={suggest} data-testid="commit-again"><RefreshCw className="size-3" />{t('commit.again')}</Button>
            </div>
            <Textarea value={writing ? '' : message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={5000} placeholder={writing ? t('commit.writing') : ''} disabled={writing} className="font-mono text-xs" data-testid="commit-message" />
            {guess && !writing ? <p className="text-muted-foreground text-xs">{t('commit.guess')}</p> : null}
          </div>
          <p className="text-muted-foreground text-xs">{t('commit.pushNote')}</p>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onClose()} disabled={busy}>{t('commit.cancel')}</Button>
        <Button type="button" variant="outline" disabled={!ready} onClick={() => run(false)} data-testid="commit-only">{t('commit.commit')}</Button>
        <Button type="button" disabled={!ready} onClick={() => run(true)} data-testid="commit-push">{t('commit.commitPush')}</Button>
      </DialogFooter>
    </>
  );
}

// The button for the chat's header; the dialog loads its files only while it is open.
export function CommitButton({ project }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!project) return null;
  return (
    <>
      <BubbleTip title={t('commit.button')} text={t('commit.tip')}>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="commit-open"><GitCommitHorizontal />{t('commit.button')}</Button>
      </BubbleTip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">{open ? <CommitBody project={project} onClose={() => setOpen(false)} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}
