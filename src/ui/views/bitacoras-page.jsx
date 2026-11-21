// The frame the three tabs of «Bitácoras» share: the common 56 px bar (title, a short useful line, the view's own icon
// actions, the bell and «⋯») and the body with the tabs on top (they live in the content, not in the bar).
import { RefreshCw } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { MoreButton } from '@/components/ui/primitives.jsx';
import { BubbleTip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/overlay.jsx';
import { useT } from '@/lib/i18n.js';

// actions: icon buttons of the tab, drawn before the bell. onRefresh: what «Actualizar» of «⋯» does. menuItems: the tab's own items of «⋯» (what the mock-up does not draw), after it.
export function BitacorasPage({ meta, actions, menuItems, onRefresh, tabs, children, bodyClassName }) {
  const t = useT();
  return (
    <>
      <PageHeader title={t('logbooks.title')} meta={meta}>
        {actions}
        <NotificationBell />
        <DropdownMenu modal={false}>
          <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton label={t('nav.more')} data-testid="logbooks-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => onRefresh?.()} data-testid="logbooks-refresh"><RefreshCw />{t('logbooks.refresh')}</DropdownMenuItem>
            {menuItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <PageBody className="pt-5 pb-10 md:pb-28">
        <div className={bodyClassName ?? 'mx-auto flex w-full max-w-[1180px] flex-col gap-4'}>
          {tabs}
          {children}
        </div>
      </PageBody>
    </>
  );
}
