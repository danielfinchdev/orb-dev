// Ajustes › General › Atajos de teclado: the chat tabs switch and the table of shortcuts with a recorder. The table is
// src/shared/keybindings.mjs; what the user changes is saved by the engine in core/keybindings.json.
import { useEffect, useState } from 'react';
import { Kbd } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Switch } from '@/components/ui/overlay.jsx';
import { useT } from '@/lib/i18n.js';
import { notifyOk } from '@/lib/notify.js';
import { errorText } from '@/lib/utils.js';
import { useKeys, saveKeys } from '@/lib/keys.js';
import { COMMANDS, comboFromEvent, conflictOf, normalizeCombo, withBinding, withoutBinding } from '../../../shared/keybindings.mjs';
import { save, Row, Block, Panel, Stack, CardFoot } from './rows.jsx';
import { quiet } from '@/lib/quiet.js';

export function TabsCard({ c }) {
  const t = useT();
  return <Panel className="mt-0"><Row label={t('tabs.setting')} hint={t('tabs.settingHint')}><Switch checked={c.ui?.tabs !== false} onCheckedChange={(tabs) => save({ ui: { tabs } })} data-testid="tabs-switch" /></Row></Panel>;
}

const parts = (combo) => combo.split(/\+(?=.)/);
function Keys({ combo, t }) {
  if (!combo) return <span className="text-muted-foreground text-control">{t('keys.none')}</span>;
  return <span className="flex flex-wrap items-center gap-0.5">{parts(combo).map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>;
}

export function ShortcutsCard() {
  const t = useT();
  const { rules, table, problems } = useKeys();
  const [rec, setRec] = useState(null); // the command being recorded
  const [msg, setMsg] = useState(null); // { id, text } the clash found
  const clash = (id, r) => t(`keys.clash.${r.reason}`, { other: r.reason === 'system' ? r.with : t(COMMANDS.find((c) => c.id === r.with)?.label ?? 'keys.none') });

  const commit = async (id, key) => {
    const def = COMMANDS.find((c) => c.id === id);
    if (key !== null) {
      const r = conflictOf(table, id, key, table.get(id)?.when ?? def.when);
      if (r) { setMsg({ id, text: r.reason === 'key' ? t('keys.clash.key') : clash(id, r) }); return; }
    }
    try {
      const res = await saveKeys(withBinding(rules, id, key));
      if (res?.saved) { setMsg(null); notifyOk(t('keys.saved')); } else setMsg({ id, text: t('keys.clash.key') });
    } catch (e) { setMsg({ id, text: errorText(e) }); }
  };

  // while recording, every key goes here (before the window's own shortcuts) and nothing else reacts
  useEffect(() => {
    if (!rec) return undefined;
    const on = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRec(null); setMsg(null); return; }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { setRec(null); commit(rec, null); return; }
      const combo = comboFromEvent(e);
      if (!combo) return; // a modifier alone: wait for the key
      if (!normalizeCombo(combo)) { setMsg({ id: rec, text: t('keys.clash.key') }); return; }
      const id = rec; setRec(null); commit(id, combo);
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const bad = problems.filter((p) => p.index >= 0 || p.reason === 'json').length;
  return (
    <Block title={t('keys.title')} note={t('keys.hint')} data-testid="shortcuts-card">
      <Panel>
        {bad ? <Stack><p className="text-warning-ink text-control" role="status">{t('keys.problems', { n: bad })}</p></Stack> : null}
        <ul aria-label={t('keys.title')}>
          {COMMANDS.map((cmd) => {
            const v = table.get(cmd.id);
            const recording = rec === cmd.id;
            return (
              <li key={cmd.id} className="border-border hover:bg-accent/40 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3.5 py-2.5 not-first:border-t" data-testid={`shortcut-${cmd.id}`}>
                <div className="min-w-0">
                  <div className="text-control font-medium">{t(cmd.label)}{cmd.when === 'chat' ? <span className="text-muted-foreground ml-2 text-caption font-normal">{t('keys.chatOnly')}</span> : null}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {recording ? <span className="text-primary-text text-control" role="status">{t('keys.recording')}</span> : <Keys combo={v?.key} t={t} />}
                  {cmd.reserved ? <span className="text-muted-foreground text-caption">{t('keys.fixed')}</span> : (
                    <>
                      <Button size="xs" variant={recording ? 'default' : 'outline'} onClick={() => { setMsg(null); setRec(recording ? null : cmd.id); }} aria-pressed={recording}>{t('keys.record')}</Button>
                      <Button size="xs" variant="ghost" disabled={!v?.custom} onClick={() => { setMsg(null); saveKeys(withoutBinding(rules, cmd.id)).catch((e) => setMsg({ id: cmd.id, text: errorText(e) })); }}>{t('keys.reset')}</Button>
                    </>
                  )}
                </div>
                {msg?.id === cmd.id ? <p className="text-destructive col-span-2 text-control" role="alert">{msg.text}</p> : null}
              </li>
            );
          })}
        </ul>
        {rules.length ? <CardFoot className="justify-start"><Button size="sm" variant="outline" onClick={() => { setMsg(null); saveKeys([]).catch(quiet); }}>{t('keys.resetAll')}</Button></CardFoot> : null}
      </Panel>
    </Block>
  );
}
