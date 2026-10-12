// 3.2: «Memorias»: what Orb remembers, in one place: the logs (bitácoras, its memory of each project) and the activity
// (every event of the board). Each one keeps its own route (logs, activity), so links to them still work.
import { BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { go } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { LogsView } from './logs.jsx';
import { ActivityView } from './activity.jsx';

export function MemoriesView({ route }) {
  const t = useT();
  const tab = route.view === 'activity' ? 'activity' : 'logs';
  const tabs = [['logs', t('memories.logs')], ['activity', t('memories.activity')]];
  return (
    <>
      <PageHeader icon={<BookOpen className="text-primary size-5" />} title={t('memories.title')} meta={t(tab === 'logs' ? 'logs.meta' : 'activity.meta')}>
        <div className="bg-muted inline-flex rounded-lg p-[3px]" role="tablist" data-testid="memories-tabs">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go({ view: id })} data-testid={`memories-${id}`}
              className={cn('cursor-pointer rounded-md px-3 py-1 text-[13px] transition-colors', tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
          ))}
        </div>
      </PageHeader>
      {tab === 'logs' ? <LogsView route={route} bare /> : <ActivityView bare />}
    </>
  );
}
