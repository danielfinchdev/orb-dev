// Activity: every event of the board (who did what and when), searchable.
import { useEffect, useState } from 'react';
import { History, Copy, Search } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, Empty, Input } from '@/components/ui/basic.jsx';
import { useStore, call, go } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { fmtTime } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { activityLabel, activityDetail } from '@/lib/activity.js';

// 3.2: bare: inside «Memorias»: the search and copy go above the list instead of in a header of its own.
export function ActivityView({ bare = false }) {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => { const h = setTimeout(() => call('activity.list', { q, limit: 500 }).then(setRows).catch(() => {}), 200); return () => clearTimeout(h); }, [q, version]);
  const copy = () => navigator.clipboard.writeText(rows.map((r) => `${r.at}\t${r.actor}\t${r.kind}\t${r.task_id ? `#${r.task_id} ` : ''}${r.detail}`).join('\n')).then(() => toast.success(t('activity.copied')));
  return (
    <>
      {bare ? null : <PageHeader icon={<History className="text-primary size-5" />} title={t('activity.title')} meta={t('activity.meta')} />}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:pb-28">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative"><Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" /><Input className="h-8 w-64 max-w-full pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('activity.search')} data-testid="activity-search" /></div>
          <Button size="sm" variant="ghost" onClick={copy}><Copy />{t('activity.copy')}</Button>
        </div>
        <Card className="gap-0 py-0">
          {rows.length ? rows.map((r) => (
            <div key={r.id} onClick={() => r.task_id && go({ view: 'tasks', id: r.task_id })} className={`grid grid-cols-[120px_110px_1fr] gap-3 border-b px-4 py-2.5 text-[13px] last:border-b-0 ${r.task_id ? 'hover:bg-accent/50 cursor-pointer' : ''}`}>
              <span className="text-muted-foreground">{fmtTime(r.at)}</span>
              <span className="truncate">{AGENT[r.actor] ?? r.actor}</span>
              {/* 3.2.1: each event in words; the raw one on hover and in «Copiar». */}
              <span className="min-w-0" title={`${r.kind}${r.detail ? ` ${r.detail}` : ''}`}><span className="font-medium">{activityLabel(t, r.kind)}</span>{r.task_id ? <span className="text-muted-foreground"> · #{r.task_id} {r.title ?? ''}</span> : null}{activityDetail(t, r, locale, AGENT) ? <span className="text-muted-foreground block break-words">{activityDetail(t, r, locale, AGENT)}</span> : null}</span>
            </div>
          )) : <Empty icon={History} title={t('activity.empty')} />}
        </Card>
      </div>
    </>
  );
}
