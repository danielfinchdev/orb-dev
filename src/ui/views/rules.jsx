// Normas: the rules of Orb and of the subagents. The editor comes later; until then this tab says so.
import { ScrollText } from 'lucide-react';
import { PageBody } from '@/components/page.jsx';
import { Card, Empty } from '@/components/ui/basic.jsx';
import { useT } from '@/lib/i18n.js';

export function RulesView() {
  const t = useT();
  return (
    <PageBody className="px-5 py-5 md:pb-28">
      <Card className="py-6" data-testid="rules-soon"><Empty icon={ScrollText} title={t('logbooks.rulesSoon')}>{t('logbooks.rulesSoonHint')}</Empty></Card>
    </PageBody>
  );
}
