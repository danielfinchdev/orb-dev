// GitHub's side of the projects: the account state (gh) and the contribution squares of the profile.
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, Card, Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { BubbleTip } from '@/components/ui/overlay.jsx';
import { GithubIcon } from '@/components/agent-icon.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { useT, useLocale } from '@/lib/i18n.js';

export function GithubCard() {
  const t = useT();
  const [gh, setGh] = useState(null);
  const load = () => { setGh(null); call('github.status').then(setGh).catch((e) => setGh({ error: e.message })); };
  useEffect(load, []);
  return (
    // in a narrow window the state and its buttons go under the text (the text was left with a word per line).
    <Card className="flex-row flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5">
      <GithubIcon className="size-5 shrink-0" />
      <div className="min-w-[12rem] flex-1">
        <div className="text-body font-medium">GitHub</div>
        <div className="text-muted-foreground text-xs">{t('projects.gh.desc')}</div>
      </div>
      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
        {!gh ? <Spinner /> : !gh.installed ? (<><Badge variant="secondary">{t('projects.gh.notInstalled')}</Badge><Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://cli.github.com/')}>{t('projects.gh.download')}</Button></>)
          : gh.loggedIn ? <Badge variant="success" className="max-w-full truncate">{t('projects.gh.connected', { user: gh.user ?? '?' })}</Badge>
            : (<><Badge variant="destructive">{t('projects.gh.noSession')}</Badge><Button size="sm" onClick={() => act(call('github.login'), t('projects.gh.login.done'))}>{t('projects.gh.login')}</Button></>)}
        <BubbleTip title={t('projects.gh.check')}><Button size="icon-sm" variant="ghost" onClick={load} aria-label={t('projects.gh.check')}><RefreshCw /></Button></BubbleTip>
      </div>
    </Card>
  );
}

// the green squares of the user's GitHub profile (last year), right under the GitHub card. Real data from GitHub;
// the day under the pointer is told below the grid (no browser tooltips).
export function ContributionGraph() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState(undefined);
  const [hover, setHover] = useState(null);
  useEffect(() => { let alive = true; call('github.contributions').then((d) => alive && setData(d)).catch(() => alive && setData(null)); return () => { alive = false; }; }, []);
  if (data === undefined) return null;
  if (!data) return null;
  const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <Card className="gap-2 px-5 py-3.5" data-testid="gh-contributions">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium">{t('projects.gh.contributions', { n: data.total.toLocaleString(locale) })}</span>
        <span className="text-muted-foreground truncate">{hover ? t('projects.gh.day', { n: hover.count, date: fmt(hover.date) }) : `@${data.user}`}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="gh-graph inline-grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: 'repeat(7, 10px)' }} role="img" aria-label={t('projects.gh.contributions', { n: data.total })} onMouseLeave={() => setHover(null)}>
          {data.weeks.flatMap((w, wi) => w.map((d) => <span key={d.date} className="gh-cell size-[10px] rounded-[2px]" data-level={d.level} style={wi === 0 ? { gridRowStart: new Date(`${d.date}T12:00:00`).getDay() + 1 } : undefined} onMouseEnter={() => setHover(d)} />))}
        </div>
      </div>
      <div className="text-muted-foreground flex items-center justify-end gap-1 text-micro">{t('projects.gh.less')}{[0, 1, 2, 3, 4].map((l) => <span key={l} className="gh-cell size-[10px] rounded-[2px]" data-level={l} />)}{t('projects.gh.more')}</div>
    </Card>
  );
}
