import { Bot, ChartNoAxesColumn } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay.jsx';
import { go } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';

// The two tabs under the bar of «Agentes» and «Uso»: the agents with their accounts, and the usage. Each keeps its own route.
export function AgentsUsageTabs({ current }) {
  const t = useT();
  return (
    <Tabs value={current} onValueChange={(view) => go(view === 'usage' ? { view: 'usage' } : 'agents')}>
      <TabsList variant="line" aria-label={t('agents.title')} data-testid="agents-tabs">
        <TabsTrigger value="agents" className="underline" data-testid="agents-tab-agents"><Bot />{t('agents.tabAgents')}</TabsTrigger>
        <TabsTrigger value="usage" className="underline" data-testid="agents-tab-usage"><ChartNoAxesColumn />{t('usage.title')}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
