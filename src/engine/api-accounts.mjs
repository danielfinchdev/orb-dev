// The agents and accounts part of the engine's API (split out of api.mjs in 3.6, unchanged): checking and installing the
// agents, signing in, and several subscriptions of the same agent. (WS3 adds loans and per-person accounts here.)
import fs from 'node:fs';
import path from 'node:path';
import { ctx, saveConfig, checkAccountHome, tr, isHeadless } from '../core/context.mjs';
import { AGENT_IDS } from '../core/home.mjs';
import { MULTI, newAccountId, findAccountFolders, accountsOf, accountDir } from '../core/accounts.mjs';
import { accountInfo as codexAccountInfo } from '../agents/codex.mjs';
import { clearCooldown } from '../core/budget.mjs';
import { oneLine } from '../core/safety.mjs';
import { statusAll, status as agentStatus, openLogin, startAccountLogin, forgetInstalled, executable } from '../agents/index.mjs';
import { sendCode as loginSendCode, cancelLogin, loginInfo, allLogins } from '../agents/login.mjs';
import { translate } from '../core/i18n.mjs';
import { refreshModels, refreshAllModels } from './catalog.mjs';
import * as installer from './installer.mjs';
import { fail, str, oneOf } from './api-common.mjs';

export function accountMethods({ board, emit, log }) {
  return {
    // «Comprobar» / «Comprobar todo» also ask the agents again for their models (in the background).
    'agents.status': ({ refresh }) => {
      if (refresh) {
        forgetInstalled(); refreshAllModels(board, { force: true, log });
        if (!process.env.ORB_FAKE_AGENTS) import('./plans.mjs').then(({ refreshPlans }) => refreshPlans(board, { force: true, log })).catch(() => {});
      }
      return statusAll({ refresh: Boolean(refresh) });
    },
    'agents.check': ({ agent }) => { const a = oneOf(agent, AGENT_IDS, 'agente'); forgetInstalled(); refreshModels(board, a, { force: true, log }); return agentStatus(a, { refresh: true }); },
    // 3.5 «Solo Orb»: Claude Code and Codex sign in without a console: { id, url, code?, opened, needsCode, mode } and
    // 'agents:login' events until it ends (src/agents/login.mjs). console: true opens the old console (Windows only), the
    // way left for a sign-in the CLI cannot do without a terminal. Cursor and the ACP agents keep their console.
    'agents.login': async ({ account: id, agent, mode, console: inConsole }) => {
      const acc = str(id ?? agent, 'cuenta', 40);
      const how = oneOf(mode, ['web', 'device'], 'modo', undefined);
      // A pause because it had no login is lifted: the user is signing in now.
      const liftPause = () => { if ([translate('es', 'msg.budget.noLogin'), translate('en', 'msg.budget.noLogin')].includes(board.setting(`cooldown_reason:${acc}`))) { board.setting(`cooldown:${acc}`, ''); board.setting(`cooldown_reason:${acc}`, ''); } };
      if (inConsole) { if (isHeadless()) fail(tr('msg.login.noConsoleHere')); openLogin(acc); liftPause(); return { console: true, account: acc }; }
      let r;
      try {
        r = await startAccountLogin(acc, { mode: how, emit, onEnd: (l) => {
          if (l.state !== 'hecho') return;
          liftPause(); forgetInstalled();
          const agentId = ctx.config.accounts.find((a) => a.id === acc)?.agent;
          if (agentId) refreshModels(board, agentId, { force: true, log });
          if (!process.env.ORB_FAKE_AGENTS) import('./plans.mjs').then(({ refreshPlans }) => refreshPlans(board, { force: true, log })).catch(() => {});
          emit('config:changed', ctx.config);
        } });
      } catch (error) { fail(error.message); }
      if (r.console) liftPause();
      return r;
    },
    'agents.loginCode': ({ id, code }) => { try { return loginSendCode(str(id, 'inicio de sesión', 80), str(code, 'código', 2000)); } catch (error) { fail(error.message); } },
    'agents.loginCancel': ({ id }) => cancelLogin(str(id, 'inicio de sesión', 80)),
    'agents.loginState': ({ id }) => (id ? loginInfo(str(id, 'inicio de sesión', 80)) : allLogins()),
    // 3.5: install or update Claude Code or Codex with one button, hidden and for this user only (installer.mjs).
    'agents.install': ({ agent }) => {
      const a = oneOf(agent, installer.AGENT_INSTALL, 'agente');
      try {
        return installer.installAgent(a, emit, {
          version: async () => { forgetInstalled(); return (await agentStatus(a, { refresh: true })).version; },
          onDone: (st) => { if (st.state === 'hecho') { refreshModels(board, a, { force: true, log }); emit('config:changed', ctx.config); } }
        });
      } catch (error) { fail(error.message); }
    },
    'agents.installState': ({ agent }) => installer.agentInstallState(oneOf(agent, installer.AGENT_INSTALL, 'agente')),
    // ---- accounts: several subscriptions of the same agent
    'accounts.add': ({ agent, label, home }) => {
      agent = oneOf(agent, AGENT_IDS, 'agente');
      if (!MULTI[agent]) fail(tr('msg.api.oneAccountOnly', { agent }));
      const before = board.all("SELECT run_account AS a FROM tasks WHERE run_account IS NOT NULL UNION SELECT account FROM tasks WHERE account IS NOT NULL UNION SELECT account FROM sessions WHERE account IS NOT NULL").map((r) => r.a);
      const id = newAccountId(agent, before);
      // Without a folder chosen by the user, the account gets its own inside the assistant's folder.
      const dir = str(home, 'carpeta', 1000, { optional: true }) || path.join(ctx.paths.internal, 'cuentas', id);
      if (!path.isAbsolute(dir)) fail(tr('msg.api.accountAbs'));
      try { checkAccountHome(dir, ctx.config, board.projects().map((p) => p.path)); } catch (error) { fail(error.message); }
      // 3.0: the folder of an account this agent already has (also the default one, ~/.codex, through a link or another
      // spelling) would count the same subscription twice: its quota and its parallel runs.
      const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); } };
      if (accountsOf(agent).some((a) => real(accountDir(a)) === real(dir))) fail(tr('msg.ctx.sameHome'));
      fs.mkdirSync(dir, { recursive: true });
      const c = saveConfig({ accounts: [...ctx.config.accounts, { id, agent, label: oneLine(str(label, 'nombre', 60), 60), home: dir, enabled: true }] });
      emit('config:changed', c);
      return c.accounts.find((a) => a.id === id);
    },
    // 2.7: saved logins of this agent elsewhere on the PC that are not accounts yet (only presence is checked).
    'accounts.scan': async ({ agent }) => {
      agent = oneOf(agent, AGENT_IDS, 'agente');
      if (!MULTI[agent]) fail(tr('msg.api.oneAccountOnly', { agent }));
      const found = await findAccountFolders(agent);
      if (agent !== 'codex' || !found.length) return found;
      // Codex says whose account each folder holds: a folder with an account Orb already has, or a copy of another
      // folder found (the most recent is kept), is not offered. Each one gets its plan (Go, Plus, Pro…) for its name.
      let exe = null; try { exe = executable('codex'); } catch { /* not installed: offered as found */ }
      if (!exe) return found;
      // 3.0: three questions at a time (each one starts Codex for a moment), every account and folder compared.
      const limited = async (items, fn, n = 3) => { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } })); return out; };
      const mine = await limited(accountsOf('codex'), (a) => codexAccountInfo(exe, accountDir(a)));
      const theirs = await limited(found, (f) => codexAccountInfo(exe, f.dir));
      const seen = new Set(mine.map((i) => i?.who).filter(Boolean));
      const out = [];
      // A folder Codex could not say about is offered but never added by itself (unchecked: it may be a copy).
      found.forEach((f, i) => { const info = theirs[i]; if (info?.who && seen.has(info.who)) return; if (info?.who) seen.add(info.who); out.push({ ...f, plan: info?.plan ?? null, checked: Boolean(info?.who) }); });
      return out;
    },
    'accounts.update': ({ id, label, enabled }) => {
      const acc = ctx.config.accounts.find((a) => a.id === str(id, 'cuenta', 40)) ?? fail(tr('msg.api.noAccount'));
      const next = ctx.config.accounts.map((a) => (a.id === acc.id ? { ...a, ...(label !== undefined ? { label: oneLine(str(label, 'nombre', 60), 60) } : {}), ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}) } : a));
      const c = saveConfig({ accounts: next }); emit('config:changed', c); return true;
    },
    'accounts.remove': ({ id }) => {
      const acc = ctx.config.accounts.find((a) => a.id === str(id, 'cuenta', 40)) ?? fail(tr('msg.api.noAccount'));
      if (acc.id === acc.agent) fail(tr('msg.api.mainAccount'));
      if (board.one("SELECT COUNT(*) AS n FROM tasks WHERE status = 'running' AND run_account = ?", acc.id).n) fail(tr('msg.api.accountRunning'));
      if (board.one("SELECT COUNT(*) AS n FROM sessions WHERE status = 'running' AND account = ?", acc.id).n) fail(tr('msg.api.accountBusy'));
      if (ctx.config.orchestrator.account === acc.id) fail(tr('msg.api.accountAssistant'));
      // The folder (and its login) stays on disk: removing an account from the app never signs anyone out.
      const c = saveConfig({ accounts: ctx.config.accounts.filter((a) => a.id !== acc.id) }); emit('config:changed', c); return true;
    },
    // 3.2.1: the user lifts an account's usage pause (and its models without usage) by hand.
    'accounts.clearCooldown': ({ account: id }) => {
      const acc = str(id, 'cuenta', 40);
      if (!ctx.config.accounts.some((a) => a.id === acc)) fail(tr('msg.api.noAccount'));
      clearCooldown(board, acc);
      return true;
    },
  };
}
