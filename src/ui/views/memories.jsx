// «Bitácoras»: what Orb writes down, in one place: its journal (the logs), the activity (every event) and, when the
// engine has them, the rules. Each tab keeps its own route (logs, activity, rules), so links to them still work. The
// route and test ids keep the old name («memories»). The tabs live in the content of each tab (a view draws its own
// bar, because its actions change with the tab).
import { useEffect, useState } from 'react';
import { BookOpen, Activity, Scale } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay.jsx';
import { go, call } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { hasMethod } from '@/lib/activity-filters.js';
import { LogsView } from './logs.jsx';
import { ActivityView } from './activity.jsx';
import { RulesView } from './rules.jsx';

const TAB = { logs: 'logs', activity: 'activity', rules: 'rules' };
const ICON = { logs: BookOpen, activity: Activity, rules: Scale };

export function MemoriesView({ route }) {
  const t = useT();
  const [hasRules, setHasRules] = useState(false);
  useEffect(() => { let alive = true; hasMethod(call, 'rules.list').then((ok) => { if (alive) setHasRules(ok); }); return () => { alive = false; }; }, []);
  const tab = TAB[route.view] === 'rules' && !hasRules ? 'logs' : (TAB[route.view] ?? 'logs');
  const tabs = [['logs', t('logbooks.tabLogs')], ['activity', t('logbooks.tabActivity')], ...(hasRules ? [['rules', t('logbooks.tabRules')]] : [])];
  const bar = (
    <Tabs value={tab} onValueChange={(id) => go({ view: id })}>
      <TabsList variant="line" aria-label={t('logbooks.title')} data-testid="memories-tabs">
        {tabs.map(([id, label]) => { const Icon = ICON[id]; return <TabsTrigger key={id} value={id} data-testid={`memories-${id}`}><Icon />{label}</TabsTrigger>; })}
      </TabsList>
    </Tabs>
  );
  return tab === 'logs' ? <LogsView route={route} tabs={bar} /> : tab === 'activity' ? <ActivityView tabs={bar} /> : <RulesView tabs={bar} />;
}
