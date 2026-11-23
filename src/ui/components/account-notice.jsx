// The buttons that go with an account notice in a chat (the engine writes the sentence): wait for the account, use the
// other one just for this chat, or leave the account to Orb. They live only while the message is held.
import { Button } from './ui/button.jsx';
import { useT } from '@/lib/i18n.js';
import { useStore, go } from '@/lib/store.js';

// problem: the notice's own { kind, account, other }; hold: what the engine holds now ({ kind, account, waiting }) or null.
export function AccountActions({ problem, hold, onWait, onUse, onAuto }) {
  const t = useT();
  const accounts = useStore((s) => s.app?.config?.accounts ?? []);
  if (!problem || !hold || hold.account !== problem.account || hold.kind !== problem.kind) return null;
  const other = problem.other ? accounts.find((a) => a.id === problem.other) : null;
  const identity = /^identity/.test(problem.kind);
  return (<>
    {problem.kind === 'limit' && !hold.waiting ? <Button size="xs" variant="soft" onClick={onWait} data-testid="account-hold-wait">{t('acct.holdWait')}</Button> : null}
    {problem.kind === 'limit' && hold.waiting ? <span className="text-faint-foreground" data-testid="account-hold-waiting">{t('acct.waiting')}</span> : null}
    {other ? <Button size="xs" variant="soft" onClick={() => onUse(other.id)} data-testid="account-use-other">{t('acct.useOther', { name: other.label })}</Button> : null}
    {problem.kind === 'nosession' || identity ? <Button size="xs" variant="soft" onClick={() => go('agents')} data-testid="account-open-agents">{problem.kind === 'nosession' ? t('acct.signIn') : t('acct.toAgents')}</Button> : null}
    <Button size="xs" variant="ghost" onClick={onAuto} data-testid="account-to-auto">{t('acct.toAuto')}</Button>
  </>);
}
