// The one card of the start-up notices (core missing, data migration, app update, Orb could not start, a screen that
// failed): the mock-up's .aviso. A 48 px mark on the left, the title and the texts beside it, «Detalles» under them and
// the actions on the right of the footer (the main one last). `cover` fills the window (the app has not started: no
// sidebar); without it the card sits in the area it is given (a screen that failed inside the app).
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { StartMark } from './wizard.jsx';

export const startText = 'text-muted-foreground m-0 text-control leading-[1.45]';
export const startHint = 'text-foreground m-0 text-control leading-[1.45]';

export function StartNotice({ icon, mood = 'worried', title, label, children, details, footer, testid, cover = true, role = 'alertdialog', className, ...props }) {
  return (
    <div className={cn('grid min-h-0 flex-1 place-items-center overflow-y-auto p-6', cover && 'bg-background h-full pt-[max(1.5rem,env(safe-area-inset-top))]', className)} data-testid={testid} {...props}>
      <div role={role} aria-label={label ?? title} className="border-border bg-background rounded-card flex w-[520px] max-w-full flex-col overflow-hidden border shadow-[0_30px_80px_-20px_rgb(0_0_0/0.45)]">
        <div className="p-[18px]">
          <div className="flex items-start gap-4">
            <StartMark icon={icon} mood={mood} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h1 className="m-0 font-(family-name:--title) text-dialog leading-[1.45] font-semibold">{title}</h1>
              {children}
            </div>
          </div>
          {details}
        </div>
        {footer ? <div className="border-border flex flex-wrap justify-end gap-2 border-t px-[18px] py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

// «Detalles»: the technical reason, folded.
export function StartDetails({ children }) {
  const t = useT();
  return (
    <details className="mt-4 text-control" data-testid="start-details">
      <summary className="text-muted-foreground cursor-pointer">{t('data.core.details')}</summary>
      <p className="text-muted-foreground mt-2 mb-0 text-caption leading-[1.45] break-words">{children}</p>
    </details>
  );
}

// A line with an icon and a path (the copy of the data), as the mock-up's .path.
export function StartPath({ icon: Icon, children }) {
  return <div className="text-muted-foreground flex items-center gap-2 text-caption">{Icon ? <Icon className="size-3.5 flex-none" aria-hidden="true" /> : null}<span className="min-w-0 break-all">{children}</span></div>;
}

export function StartProgress({ percent }) {
  return (
    <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <i className="bg-primary-text block h-full rounded-full" style={{ width: `${percent}%` }} />
    </div>
  );
}
