// Ajustes › Herramientas › «MCP para agentes de fuera»: lets Claude Code in a terminal or Claude Desktop create tasks in Orb
// through a server that listens on 127.0.0.1 only (src/engine/host/mcp-external.mjs). Off by default. One token per client,
// with an expiry and the projects it may use; its tasks always run isolated, at «Preguntar», after your approval.
import { useEffect, useState } from 'react';
import { Copy, Trash2, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Field, Input } from '@/components/ui/basic.jsx';
import { ListRow } from '@/components/ui/primitives.jsx';
import { Switch } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { notifyInfo } from '@/lib/notify.js';
import { useT } from '@/lib/i18n.js';
import { unlockCore } from '@/lib/core-access.js';
import { Block, Panel, Setting, Stack, CardFoot, Hint } from './rows.jsx';

// the project choice of a token (a form body): one check per project of Orb
function Projects({ all, value, set }) {
  const t = useT();
  if (!all.length) return <p className="text-muted-foreground text-sm">{t('mcpext.noProjects')}</p>;
  return (
    <div className="grid max-h-48 gap-1 overflow-auto" data-testid="mcpext-projects">
      {all.map((p) => (
        <label key={p} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(p)} onChange={(e) => set(e.target.checked ? [...value, p] : value.filter((x) => x !== p))} />{p}
        </label>
      ))}
    </div>
  );
}

const when = (ms) => new Date(ms).toLocaleDateString();

export function McpExtCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const load = () => call('mcpExt.state').then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); const off = bridge.on('*', (event) => { if (event === 'mcpext:changed') load(); }); return () => off?.(); }, []);
  if (!st) return null;

  const toggle = async (on) => {
    const unlock = on ? await unlockCore('mcpExt') : null; if (on && !unlock) return;
    const r = await act(call('mcpExt.setEnabled', { enabled: on, unlock })); if (r) setSt(r);
  };
  // the token is shown once, inside the command that connects Claude Code
  const shown = async (made) => {
    const cmd = `claude mcp add --transport http orb ${made.url} --header "Authorization: Bearer ${made.token}"`;
    await form(t('mcpext.created'), {
      description: t('mcpext.createdBody'), initial: {}, ok: t('mcpext.copy'),
      body: () => <pre className="bg-muted overflow-auto rounded-md p-2 text-xs break-all whitespace-pre-wrap" data-testid="mcpext-command">{cmd}</pre>,
      onOk: async () => { try { await navigator.clipboard.writeText(cmd); notifyInfo(t('mcpext.copied')); } catch { /* the text is on screen */ } return true; }
    });
  };
  const create = async () => {
    await form(t('mcpext.new'), {
      description: t('mcpext.newBody'), initial: { name: '', days: String(st.defaultDays), projects: [] },
      body: (v, set) => (
        <div className="grid gap-3">
          <Field label={t('mcpext.name')}><Input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="Claude Code" autoFocus data-testid="mcpext-name" /></Field>
          <Field label={t('mcpext.days')}><Input value={v.days} inputMode="numeric" onChange={(e) => set({ days: e.target.value.replace(/\D/g, '') })} data-testid="mcpext-days" /></Field>
          <Field label={t('mcpext.projects')}><Projects all={st.projects} value={v.projects} set={(projects) => set({ projects })} /></Field>
        </div>
      ),
      ok: t('mcpext.create'),
      onOk: async (v) => {
        const unlock = await unlockCore('mcpExt'); if (!unlock) throw new Error(t('msg.master.needUnlock'));
        const made = await call('mcpExt.createToken', { name: v.name, projects: v.projects, days: Number(v.days) || st.defaultDays, unlock });
        setTimeout(() => shown(made), 0);
        return made;
      }
    });
    load();
  };
  const projectsOf = async (tk) => {
    await form(t('mcpext.projectsOf', { name: tk.name }), {
      initial: { projects: tk.projects }, body: (v, set) => <Projects all={st.projects} value={v.projects} set={(projects) => set({ projects })} />,
      onOk: async (v) => { const unlock = await unlockCore('mcpExt'); if (!unlock) throw new Error(t('msg.master.needUnlock')); return call('mcpExt.setProjects', { id: tk.id, projects: v.projects, unlock }); }
    });
    load();
  };
  const revoke = async (tk) => { if (await confirm(t('mcpext.revoke'), t('mcpext.revokeBody', { name: tk.name }), { ok: t('mcpext.revoke'), danger: true })) { await act(call('mcpExt.revoke', { id: tk.id })); load(); } };
  const remove = async (tk) => { await act(call('mcpExt.remove', { id: tk.id })); load(); };
  const state = (tk) => (tk.revoked ? t('mcpext.revoked') : tk.expired ? t('mcpext.expired') : t('mcpext.until', { date: when(tk.expires) }));

  return (
    <Block title={t('mcpext.title')} note={t('mcpext.desc')} data-testid="mcpext-card">
      <Panel>
        <Setting label={st.enabled ? t('mcpext.on') : t('mcpext.off')} hint={st.running ? <code data-testid="mcpext-url">{st.url}</code> : null}>
          <Switch checked={st.enabled} onCheckedChange={toggle} aria-label={t('mcpext.title')} data-testid="mcpext-switch" />
        </Setting>
        {st.enabled ? (
          <>
            {!st.tokens.length ? <Stack className="border-border border-t"><Hint>{t('mcpext.noTokens')}</Hint></Stack> : st.tokens.map((tk) => (
              <ListRow key={tk.id} className="border-border rounded-none border-t" data-testid="mcpext-token" title={tk.name} meta={`${state(tk)} · ${tk.projects.join(', ')}`}
                trailing={(
                  <div className="flex items-center gap-1.5">
                    {!tk.revoked && !tk.expired ? <Button size="xs" variant="outline" onClick={() => projectsOf(tk)}>{t('mcpext.projectsBtn')}</Button> : null}
                    {!tk.revoked ? <Button size="icon-xs" variant="ghost" onClick={() => revoke(tk)} aria-label={t('mcpext.revoke')}><Ban /></Button> : null}
                    <Button size="icon-xs" variant="ghost" onClick={() => remove(tk)} aria-label={t('mcpext.remove')}><Trash2 /></Button>
                  </div>
                )} />
            ))}
            <CardFoot><Button size="sm" variant="outline" onClick={create} data-testid="mcpext-create"><Copy />{t('mcpext.new')}</Button></CardFoot>
          </>
        ) : null}
      </Panel>
    </Block>
  );
}
