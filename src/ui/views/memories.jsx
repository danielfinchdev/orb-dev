// «Memorias»: what Orb remembers, in one place: the logs (bitácoras, its memory of each project) and the activity
// (every event of the board). Each one keeps its own route (logs, activity), so links to them still work.
import { NotebookPen } from 'lucide-react';
import { Segmented } from '@/components/ui/primitives.jsx';
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
      <PageHeader icon={<NotebookPen className="text-primary size-5" />} title={t('memories.title')} meta={t(tab === 'logs' ? 'logs.meta' : 'activity.meta')}>
        <Segmented value={tab} onChange={(id) => go({ view: id })} options={tabs.map(([value, label]) => ({ value, label }))} itemTestId={(id) => `memories-${id}`} data-testid="memories-tabs" />
      </PageHeader>
      {tab === 'logs' ? <LogsView route={route} bare /> : <ActivityView bare />}
    </>
  );
}
