// «Copiar para informar de un fallo»: the last N lines before a moment, as the engine writes them (secrets hidden
// there), shown as plain text before they are copied.
import { useEffect, useState } from 'react';
import { ShieldCheck, Copy } from 'lucide-react';
import { notifyOk } from '@/lib/notify.js';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/basic.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/overlay.jsx';
import { Segmented } from '@/components/ui/primitives.jsx';
import { call } from '@/lib/store.js';
import { fmtTime } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { previewLines } from '@/lib/activity-filters.js';

const COUNTS = [50, 200, 500];

// moment: the row picked in the list (or null: now). summary: its one-line description.
export function ReportDialog({ open, onOpenChange, moment, summary }) {
  const t = useT();
  const [lines, setLines] = useState(200);
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setText(null);
    call('activity.report', { at: moment?.at ?? undefined, lines }).then((r) => { if (alive) setText(String(r?.text ?? '')); }).catch((e) => { quiet(e); if (alive) setText(''); });
    return () => { alive = false; };
  }, [open, moment?.at, lines]);
  const view = previewLines(text);
  const copy = () => navigator.clipboard.writeText(text ?? '').then(() => { notifyOk(t('logbooks.reportCopied')); onOpenChange(false); });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]" data-testid="activity-report">
        <DialogHeader><DialogTitle>{t('logbooks.report')}</DialogTitle></DialogHeader>
        <div className="grid gap-1">
          <span className="text-muted-foreground text-micro uppercase">{t('logbooks.reportMoment')}</span>
          <p className="text-body">{moment ? `${fmtTime(moment.at)} · ${summary}` : t('logbooks.reportNow')}</p>
          <p className="text-muted-foreground text-control">{t('logbooks.reportMomentHint')}</p>
        </div>
        <div className="grid gap-1.5">
          <span className="text-muted-foreground text-micro uppercase">{t('logbooks.reportLines')}</span>
          <Segmented value={lines} onChange={setLines} options={COUNTS.map((n) => ({ value: n, label: String(n) }))} className="w-fit" />
        </div>
        <div className="grid gap-1.5">
          <span className="text-muted-foreground text-micro uppercase">{t('logbooks.reportPreview')}</span>
          <pre className="bg-muted/50 max-h-48 overflow-auto rounded-lg border p-3 text-micro whitespace-pre-wrap break-words" data-testid="activity-report-preview">
            {text == null ? <Spinner /> : <>{view.head.join('\n')}{view.more ? `\n${t('logbooks.reportMore', { n: view.more })}` : ''}</>}
          </pre>
        </div>
        <p className="text-muted-foreground flex items-start gap-1.5 text-control"><ShieldCheck className="mt-0.5 size-4 shrink-0" />{t('logbooks.reportPrivacy')}</p>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">{t('logbooks.reportCancel')}</Button></DialogClose>
          <Button onClick={copy} disabled={!text} data-testid="activity-report-copy"><Copy />{t('logbooks.reportCopy', { n: view.total })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
