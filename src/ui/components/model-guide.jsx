// 2.7: which model is for what, in plain words: for each agent, what Orb uses for a simple, a normal and a complex task
// (with the «ahorro ↔ uso» slider as it is now), and its models by kind. Answers «¿cuál uso?» for whoever does not know
// the names (engine: models.guide → catalog.chooseModel).
import { useEffect, useState } from 'react';
import { ChevronRight, Feather, Scale, Rocket } from 'lucide-react';
import { AgentIcon } from './agent-icon.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/overlay.jsx';
import { useStore, call } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

const LEVELS = [['simple', Feather], ['normal', Scale], ['complejo', Rocket]];
const TIERS = ['light', 'balanced', 'heavy'];

export function ModelGuide({ auto }) {
  const t = useT();
  const version = useStore((s) => s.version);
  const profile = useStore((s) => s.app.config.budget?.profile);
  const [guide, setGuide] = useState(null);
  useEffect(() => { let alive = true; call('models.guide').then((g) => alive && setGuide(g)).catch(() => alive && setGuide([])); return () => { alive = false; }; }, [version, profile]);
  if (!guide?.length) return null;
  return (
    <div className={cn('grid gap-2.5', !auto && 'opacity-60')} data-testid="model-guide">
      <div className="text-sm font-medium">{t('guide.title')}</div>
      <p className="text-muted-foreground -mt-1.5 text-xs leading-snug">{auto ? t('guide.hint') : t('guide.hintOff')}</p>
      {guide.map((a) => (
        <div key={a.id} className="grid gap-2 rounded-xl border p-3" data-testid={`model-guide-${a.id}`}>
          <div className="flex items-center gap-2 text-[13.5px] font-medium"><AgentIcon agent={a.id} className="size-4" />{a.label}</div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {LEVELS.map(([level, Icon]) => {
              const p = a.picks[level];
              return (
                <div key={level} className="bg-muted/50 grid gap-0.5 rounded-lg px-2.5 py-2">
                  <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase"><Icon className="size-3.5" />{t(`guide.level.${level}`)}</span>
                  <span className="truncate text-[13px] font-semibold">{p.label ?? t('guide.agentOwn')}</span>
                  <span className="text-muted-foreground text-[11.5px]">{t('guide.reasoning', { level: t(`guide.r.${p.reasoning ?? 'medium'}`) })}</span>
                </div>
              );
            })}
          </div>
          {/* 3.2.1: read-only tasks (reviews, verifications) may use the light model: said here, so the table is the real rule. */}
          {a.readPicks && LEVELS.some(([level]) => a.readPicks[level]?.label !== a.picks[level]?.label) ? (
            <div className="text-muted-foreground text-[11.5px] leading-snug" data-testid={`model-guide-read-${a.id}`}>
              {t('guide.readOnly', { list: LEVELS.map(([level]) => `${t(`guide.level.${level}`)}: ${a.readPicks[level]?.label ?? t('guide.agentOwn')} (${t('guide.reasoning', { level: t(`guide.r.${a.readPicks[level]?.reasoning ?? 'medium'}`) })})`).join(' · ') })}
            </div>
          ) : null}
          {TIERS.some((tier) => a.tiers[tier]?.length) ? (
            <Collapsible>
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />{t('guide.allModels')}</CollapsibleTrigger>
              <CollapsibleContent className="mt-2 grid gap-1.5">
                {TIERS.filter((tier) => a.tiers[tier]?.length).map((tier) => (
                  <div key={tier} className="grid gap-0.5 text-xs">
                    <span className="font-medium">{t(`guide.tier.${tier}`)} <span className="text-muted-foreground font-normal">· {t(`guide.tierFor.${tier}`)}</span></span>
                    <span className="text-muted-foreground">{a.tiers[tier].join(', ')}</span>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      ))}
    </div>
  );
}
