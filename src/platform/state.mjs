// Orb's internal state in the settings table of orb.db (not the user's settings: those are orb.json). The keys used
// across modules are named here.

// 3.8: the folders of other users' projects of 3.7 that stay in the categories, which Orb no longer lists (JSON list of
// folderKey; the 3.8 migration writes it, adding one of them by hand takes it out).
export const IGNORED_PROJECTS = 'projects_ignored';
// 3.8.1: the projects the user finished (src/domain/projects/project-close.mjs): their folders stay, Orb no longer lists them.
export const FINISHED_PROJECTS = 'projects_finished';
// 3.8.1: the projects being deleted (between the engine's check and the end of the Recycle Bin: project-close.mjs).
export const DELETING_PROJECTS = 'projects_deleting';

// Every key of the settings table the code uses, by exact name or by prefix (the part after it names a task, an
// account or agent, a session, a conversation or a project). A key that is not here is a mistake: test/estado-claves.test.mjs
// reads the sources and fails on one. The table's format does not change: these are the keys already on disk.
export const STATE_KEYS = Object.freeze({
  exact: Object.freeze([
    'active_project', 'paused', 'agents_available', 'android_devices', 'backup_daily_day', 'backup_daily_try', 'backup_last',
    'games_suggested', 'models_rev', 'msg_delivered', 'notices_migrated', 'conversations_migrated', 'opti_retired', 'opti_session',
    'opti_pending', 'orchestrator_key_hash', 'orchestrator_pending', 'relink_38', 'remote_keys', 'sidebar_completed', 'sidebar_kept',
    'extension_requests', 'extension_edits', 'connector_rebinds', 'pending_questions', 'projects_ignored', 'projects_finished',
    'projects_deleting', 'migrated_3_8', 'migrated_3_8_at', 'migrated_3_8_notice', 'migrated_3_8_scrubbed', 'migrated_3_8_files',
    'migrated_3_8_config',
  ]),
  prefixes: Object.freeze({
    // a task's (by its id)
    'accepted:': 'task', 'auto_retry:': 'task', 'budget_ok:': 'task', 'checkpoint:': 'task', 'followup:': 'task', 'integrate:': 'task',
    'integrate_error:': 'task', 'integrate_error_at:': 'task', 'isolated:': 'task', 'join_task:': 'task', 'leftovers_pending:': 'task',
    'orphan_copy:': 'task', 'pause_offer:': 'task', 'progress:': 'task', 'quiet_notice:': 'task', 'readonly_bitacora:': 'task',
    'resumed_run:': 'task', 'review:': 'task', 'unblock_asked:': 'task', 'undone:': 'task', 'wait_notice:': 'task',
    // an account's or an agent's
    'cooldown:': 'account', 'cooldown_at:': 'account', 'cooldown_reason:': 'account', 'models:': 'account', 'models_at:': 'account',
    'models_try:': 'account', 'model_limit:': 'account', 'model_limit_at:': 'account', 'plan:': 'account', 'plan_try:': 'account',
    'rate:': 'account', 'rates:': 'account',
    // a session's (a direct conversation with an agent or a task's run)
    'fork_pending:': 'session', 'fork_summary:': 'session', 'grant_prev:': 'session',
    // a conversation's with the assistant
    'pending_questions:': 'conversation', 'report_queue:': 'conversation', 'inbox_since:': 'conversation',
    // a project's
    'actions:': 'project', 'wb_seen:': 'project',
    // older versions' (deleted when the engine starts or by the 3.8 migration)
    'orchestrator_conv:': 'legacy', 'agent_id:': 'legacy', 'secret:': 'legacy',
  }),
});
export const isStateKey = (key) => STATE_KEYS.exact.includes(key) || Object.keys(STATE_KEYS.prefixes).some((p) => String(key).startsWith(p));
