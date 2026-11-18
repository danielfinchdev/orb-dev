// The first-run welcome's frame (views/setup.jsx, views/layout.jsx): the row of steps over a 640 px column, as the mock-up
// draws it, and the 48 px mark that opens a step (the robot's head in the Orb theme, an icon tile in the others).
import { Check } from 'lucide-react';
import { Robot } from './robot.jsx';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { useSkin, robotSkin } from '@/lib/store.js';

// datos → tema → carpetas (only when an earlier Orb left folders: dashed) → maestra → equipo
export const WIZARD_STEPS = ['datos', 'tema', 'carpetas', 'maestra', 'equipo'];
const OPTIONAL = new Set(['carpetas']);
const LABEL = { datos: 'setup.step.welcome', tema: 'setup.step.theme', carpetas: 'setup.step.folders', maestra: 'setup.step.master', equipo: 'setup.step.equipo' };

export function WizardSteps({ current }) {
  const t = useT();
  const at = WIZARD_STEPS.indexOf(current);
  return (
    <ol className="text-faint-foreground m-0 flex list-none items-center gap-3 p-0 text-control" aria-label={t('setup.stepsLabel')} data-testid="wizard-steps">
      {WIZARD_STEPS.map((id, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'next';
        return (
          <li key={id} className="contents">
            {i ? <span className="bg-border h-px w-8" aria-hidden="true" /> : null}
            <span className={cn('flex items-center gap-2 font-medium', state === 'done' && 'text-muted-foreground', state === 'now' && 'text-foreground')} aria-current={state === 'now' ? 'step' : undefined}>
              <span className={cn('rounded-full text-caption grid size-6 flex-none place-items-center border font-semibold',
                OPTIONAL.has(id) && state === 'next' && 'border-dashed',
                state === 'next' && 'border-border text-muted-foreground',
                state === 'done' && 'bg-primary-soft text-primary-text border-transparent',
                state === 'now' && 'bg-primary text-primary-foreground border-transparent')}>
                {state === 'done' ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              {t(LABEL[id])}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// The window of a step: the steps on top, the column under them. The invisible strip that moves the window covers the first
// 56 px (main.jsx), so the content starts below it; what does not fit scrolls (the agents' install).
export function WizardPage({ step, children, ...props }) {
  return (
    <div className="bg-background flex h-full flex-col overflow-y-auto px-6 pt-16 pb-8" {...props}>
      <div className="m-auto flex w-full flex-col items-center gap-6">
        {step ? <WizardSteps current={step} /> : null}
        {children}
      </div>
    </div>
  );
}

// The 640 px column of a step. kick: «Paso N».
export function WizardCard({ kick, className, children, as: Tag = 'div', ...props }) {
  return (
    <Tag className={cn('flex w-[640px] max-w-full flex-col gap-4', className)} {...props}>
      {kick ? <span className="text-faint-foreground text-micro font-semibold tracking-[0.06em] uppercase">{kick}</span> : null}
      {children}
    </Tag>
  );
}

export const WizardFoot = ({ className, ...props }) => <div className={cn('mt-2 flex flex-wrap justify-end gap-2', className)} {...props} />;
export const WizardText = ({ className, ...props }) => <p className={cn('text-muted-foreground m-0 text-control leading-[1.45]', className)} {...props} />;
export const WizardTitle = ({ className, ...props }) => <h1 className={cn('m-0 font-(family-name:--title) text-display leading-[1.45] font-semibold', className)} {...props} />;

// The 48 px mark of a screen: the robot's head in the Orb theme, an icon tile in the others (the mock-up's .solo-orb / .solo-icon).
export function StartMark({ icon: Icon, mood = 'idle', title = 'Orb', className }) {
  const robot = robotSkin(useSkin());
  if (robot) return <span className={cn('grid size-12 flex-none place-items-center', className)}><Robot size={48} mood={mood} title={title} /></span>;
  return <span className={cn('rounded-big bg-primary-soft text-primary-text grid size-12 flex-none place-items-center', className)} aria-hidden="true">{Icon ? <Icon className="size-6" /> : null}</span>;
}
