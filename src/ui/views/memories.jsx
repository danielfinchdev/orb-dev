// «Bitácoras»: what Orb writes down, in one place: its journal (the logs), the activity (every event) and, when the
// engine has them, the rules. Each tab keeps its own route (logs, activity, rules), so links to them still work. The
// route and test ids keep the old name («memories»).
import { useEffect, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { Segmented } from '@/components/ui/primitives.jsx';
import { PageHeader } from '@/components/page.jsx';
import { go, call } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { hasMethod } from '@/lib/activity-filters.js';
import { LogsView } from './logs.jsx';
import { ActivityView } from './activity.jsx';
import { RulesView } from './rules.jsx';

const TAB = { logs: 'logs', activity: 'activity', rules: 'rules' };

export function MemoriesView({ route }) {
  const t = useT();
  const [hasRules, setHasRules] = useState(false);
  useEffect(() => { let alive = true; hasMethod(call, 'rules.list').then((ok) => { if (alive) setHasRules(ok); }); return () => { alive = false; }; }, []);
  const tab = TAB[route.view] === 'rules' && !hasRules ? 'logs' : (TAB[route.view] ?? 'logs');
  const tabs = [['logs', t('logbooks.tabLogs')], ['activity', t('logbooks.tabActivity')], ...(hasRules ? [['rules', t('logbooks.tabRules')]] : [])];
  const meta = { logs: t('logs.meta'), activity: t('activity.meta'), rules: t('logbooks.metaRules') }[tab];
  return (
    <>
      <PageHeader icon={<NotebookPen className="text-primary size-5" />} title={t('logbooks.title')} meta={meta}>
        <Segmented value={tab} onChange={(id) => go({ view: id })} options={tabs.map(([value, label]) => ({ value, label }))} itemTestId={(id) => `memories-${id}`} data-testid="memories-tabs" />
      </PageHeader>
      {tab === 'logs' ? <LogsView route={route} bare /> : tab === 'activity' ? <ActivityView bare /> : <RulesView />}
    </>
  );
}
