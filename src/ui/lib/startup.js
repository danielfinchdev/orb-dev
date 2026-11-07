// 3.8: which screen the PC's window opens on (main.jsx › Root), asked to the engine in this order and kept apart so it
// can be tested against a real engine (a blocked one, a missing core, a welcome left halfway) without a window.
// call(method): the engine's answer (bridge.call). The phone asks none of it: it opens Orb.
// → { phase, data }:
//   core       core is gone and Orb could not bring it back (data: app.coreState)
//   migration  the data of 3.7 could not be updated (data: app.migrationState); a blocked engine answers only this
//              and app.coreState (null), so the screen with «Reintentar» and «Buscar actualización» is reached
//   unlock     the master password, typed (data: master.state)
//   setup      the welcome was closed before its end (config.setupPending): it goes on where it stopped
//              (data: { step: 'carpetas' | 'maestra' | 'equipo', plan, name })
//   master     the master password, made for the first time on an Orb that was already there (data: master.state)
//   layout     folders of an earlier Orb at the top of the workspace (data: app.layoutPlan)
//   app        Orb
export async function startupPhase(call, { mobile = false } = {}) {
  if (mobile) return { phase: 'app' };
  const core = await call('app.coreState');
  if (core?.missing) return { phase: 'core', data: core };
  const migration = await call('app.migrationState');
  if (migration?.failed) return { phase: 'migration', data: migration };
  const ms = await call('master.state');
  if (ms?.exists && (ms.locked || ms.lost)) return { phase: 'unlock', data: ms };
  const plan = await call('app.layoutPlan');
  const state = await call('app.state');
  if (state?.config?.setupPending === true) return { phase: 'setup', data: { step: plan?.pending ? 'carpetas' : !ms?.exists ? 'maestra' : 'equipo', plan, name: state.config.assistantName ?? null } };
  if (!ms?.exists) return { phase: 'master', data: ms };
  if (plan?.pending) return { phase: 'layout', data: plan };
  return { phase: 'app' };
}
