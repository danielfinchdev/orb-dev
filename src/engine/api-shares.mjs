// 3.6: sharing a resource (a project, a bot, a group, an integration) with a person: view, talk or edit. Used by the
// app's API (api.mjs).
import { tr } from '../core/context.mjs';
import { can, rightOn, ownerOf, RIGHTS, audit, AuthzError } from '../core/authz.mjs';
import { fail, str, oneOf } from './api-common.mjs';

export const SHARE_TYPES = ['project', 'bot', 'group', 'integration'];
const SHARE_RANK = { view: 1, talk: 2, edit: 3, own: 4 };
const rank = (r) => SHARE_RANK[r] ?? 0;

export function shareApi({ board, sessions = null, bots = null, log = () => {} }) {
  // 3.6: sharing (shares.set / shares.remove, and a group's people: bots.groups.create, bots.groups.members.*).
  function setShare({ type, id, person, right }, who) {
      const res = { type: oneOf(type, SHARE_TYPES, 'tipo'), id: str(String(id ?? ''), 'id', 200) };
      const r = oneOf(right, RIGHTS, 'permiso');
      const to = str(person, 'persona', 40);
      mayShare(who, res, r, to, 'shares.set');
      const key = shareKey(res);
      board.run(`INSERT INTO shares (resource_type, resource_id, person_id, right, granted_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(resource_type, resource_id, person_id) DO UPDATE SET right = excluded.right, granted_by = excluded.granted_by`, res.type, key, to, r, who?.person ?? board.ownerId(), new Date().toISOString());
      audit(board, who, 'shares.set', res, 'allow', `${to}:${r}`);
      board.changed('shares', { person: to, res });
      board.changed(res.type === 'project' ? 'projects' : res.type === 'bot' || res.type === 'group' ? 'bots' : 'settings', { person: to });
      return { type: res.type, id: key, person: to, right: r };
  }
  function removeShare({ type, id, person }, who) {
      const res = { type: oneOf(type, SHARE_TYPES, 'tipo'), id: str(String(id ?? ''), 'id', 200) };
      const to = str(person, 'persona', 40);
      const key = shareKey(res);
      const row = board.one('SELECT right FROM shares WHERE resource_type = ? AND resource_id = ? AND person_id = ?', res.type, key, to);
      // One may always give up what was shared with them; otherwise the same rule as sharing it.
      if (to !== who?.person) mayShare(who, res, row?.right ?? 'view', to, 'shares.remove');
      board.run('DELETE FROM shares WHERE resource_type = ? AND resource_id = ? AND person_id = ?', res.type, key, to);
      // What that person had open of it stops (their own conversations and tasks stay theirs).
      if (res.type === 'project') if (sessions) for (const s of board.all("SELECT id FROM sessions WHERE person_id = ? AND project = ? COLLATE NOCASE AND status = 'running'", to, key)) { try { sessions?.stop(s.id); } catch { /* gone */ } }
      try { bots?.unshared?.(res, to); } catch (error) { log(`dejar de compartir: ${error.message}`); }
      audit(board, who, 'shares.remove', res, 'allow', to);
      board.changed('shares', { person: to, res });
      board.changed(res.type === 'project' ? 'projects' : res.type === 'bot' || res.type === 'group' ? 'bots' : 'settings', { person: to });
      return { ok: true };
  }
  // Sharing: the canonical id of a resource (a project's name as written, a bot's number) and who may share it.
  function shareKey(res) {
    if (res.type === 'project') return board.one('SELECT name FROM projects WHERE name = ? COLLATE NOCASE', res.id)?.name ?? res.id;
    if (res.type === 'bot') return String(board.one('SELECT id FROM bots WHERE id = ? OR name = ? COLLATE NOCASE', Number(res.id) || -1, res.id)?.id ?? res.id);
    return String(res.id);
  }
  function mayShare(who, res, right, to, method) {
    const deny = (reason) => { audit(board, who, method, res, 'deny', reason); throw new AuthzError(reason === 'notFound' ? 'notFound' : 'right', { method, resource: res }); };
    if (!board.one('SELECT id FROM persons WHERE id = ? AND deleted_at IS NULL', to)) fail(tr('msg.persons.noPerson'));
    if (ownerOf(board, res) == null) deny('notFound');
    if (who?.channel === 'system') return;
    if (res.type === 'integration' && who.role !== 'owner') deny('right');
    const mine = rightOn(board, who.person, res);
    if (!(mine === 'own' || (mine === 'edit' && right !== 'edit'))) deny('right');
    if (to === who?.person) fail(tr('msg.share.notYourself'));
    if (to === ownerOf(board, res)) fail(tr('msg.share.alreadyOwner'));
  }

  const methods = {
    // ---- 3.6: sharing a project (and, with the same rules, a bot, a group or an integration): view, talk or edit.
    // Who may share: the resource's person; someone with «edit» may share it to view or talk. Never to oneself; an
    // integration (Home Assistant, the server) only the owner.
    'shares.list': ({ type, id }, who) => {
      const me = who?.person;
      if (type != null) {
        const res = { type: oneOf(type, SHARE_TYPES, 'tipo'), id: str(String(id ?? ''), 'id', 200) };
        if (who?.channel !== 'system' && !can(board, who, 'view', res)) throw new AuthzError('right', { method: 'shares.list', resource: res });
        const key = shareKey(res);
        const mine = who?.channel === 'system' || rank(rightOn(board, me, res)) >= rank('edit');
        return board.all('SELECT resource_type AS type, resource_id AS id, person_id AS person, right, granted_by, created_at FROM shares WHERE resource_type = ? AND resource_id = ?', res.type, key)
          .filter((s) => mine || s.person === me).map((s) => ({ ...s, name: board.personName(s.person) }));
      }
      // Everything shared with the caller, and everything they shared.
      const withMe = board.all('SELECT resource_type AS type, resource_id AS id, right, granted_by FROM shares WHERE person_id = ? ORDER BY resource_type, resource_id', me).map((s) => ({ ...s, by: board.personName(s.granted_by) }));
      const byMe = board.all('SELECT resource_type AS type, resource_id AS id, person_id AS person, right FROM shares WHERE granted_by = ? ORDER BY resource_type, resource_id', me).map((s) => ({ ...s, name: board.personName(s.person) }));
      return { withMe, byMe };
    },
    'shares.set': (p, who) => setShare(p, who),
    'shares.remove': (p, who) => removeShare(p, who),
  };
  return { setShare, removeShare, methods };
}
