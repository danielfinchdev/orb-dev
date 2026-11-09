// 3.8.2 (owner's decisions D1, D2): what a chat may do beyond its permission, given with the master password.
//   «Acceso total al PC»     a chat without a project (3.8.2 D5: and «Acceso total» of a chat with a project, the same way): permission «total» (src/core/guard.mjs: still never core, the
//                            folders kept outside it, Orb's install folder, «Elementos protegidos» or sudo). Claude in
//                            Chrome when the installed Claude Code has it (src/agents/claude.mjs).
//   «Usar mi móvil Android»  any chat: Orb's orb_android_* tools (src/engine/android.mjs). «Acceso total al PC» includes it.
// Both last until the owner takes them back, also across a reload or a new start of Orb, but never past a lock: when Orb
// locks (minutes without use, «Bloquear ahora», Windows' lock screen or the PC sleeping: master.lock; also a new
// password) every one of them goes, the chats go back to «Solo lectura» and adb's server stops. Giving one asks for the
// password every time (src/core/permissions.mjs › FRESH_UNLOCK): only this PC's window, never a phone or an agent.
// Each grant and each take-back is written to the engine's log (motor.log) and shown in the chat.
import { tr } from '../platform/context.mjs';
import { fail, str, oneOf } from './api-common.mjs';

export const GRANTS = ['total', 'android'];

export function grantMethods({ board, sessions, log = () => {}, android = null }) {
  const chat = (id) => {
    const s = sessions.must(str(id, 'conversación', 64));
    if (s.kind !== 'chat') fail(tr('msg.grants.chatOnly'));
    return s;
  };
  const audit = (s, what, why = 'usuario') => {
    log(`acceso: ${what} · chat ${s.id} «${String(s.title ?? '').slice(0, 60)}» · ${why}`);
    try { sessions.addItem(s.id, 'system', 'status', tr(`msg.grants.${what}`)); } catch { /* the chat went */ }
  };
  // 3.8.2 (D5): «total» of a chat with a project follows the same rules; taken back, it returns to the permission it had
  // (kept in settings), or «Editar archivos»; a chat without a project returns to «Solo lectura».
  const holdsTotal = (s) => s.permission === 'total';
  // 3.8.2 (review M3): what the chat is doing goes with what it lost: its running turn stops and its agent process (and
  // every shell it started under it) is closed; the next message starts it again with the new permission.
  const halt = (s) => { try { sessions.stop(s.id); } catch { /* not running */ } try { sessions.closeLive(s.id); } catch { /* not open */ } };
  const before = (s) => { const k = `grant_prev:${s.id}`; const p = board.settingJson(k); board.settingJson(k, null); return s.project ? (['leer', 'probar', 'editar', 'preguntar'].includes(p) ? p : 'editar') : 'leer'; };
  // Every grant of every chat goes (Orb locked). → how many chats lost one.
  async function revokeAll(why = 'bloqueo') {
    const rows = board.all("SELECT id FROM sessions WHERE kind = 'chat' AND (permission = 'total' OR android = 1)");
    for (const { id } of rows) {
      const s = sessions.get(id); if (!s) continue;
      if (holdsTotal(s)) { sessions.update(s.id, { permission: before(s) }); audit(s, 'totalOff', why); }
      if (Number(s.android) === 1) { sessions.update(s.id, { android: 0 }); audit(s, 'androidOff', why); }
      halt(s);
    }
    try { await android?.stopServer(); } catch (error) { log(`android: ${error.message}`); }
    return rows.length;
  }
  return {
    revokeAll,
    methods: {
      // Both guarded (checkUnlock): a token for this action alone, from the password typed right now.
      'sessions.grantTotal': ({ id }) => {
        const s = chat(id);
        if (holdsTotal(s)) return s;
        board.settingJson(`grant_prev:${s.id}`, s.permission);
        const out = sessions.update(s.id, { permission: 'total' });
        audit(s, 'totalOn');
        return out;
      },
      'sessions.grantAndroid': ({ id }) => {
        const s = chat(id);
        if (Number(s.android) === 1) return s;
        const out = sessions.update(s.id, { android: 1 });
        audit(s, 'androidOn');
        return out;
      },
      // Taking one back needs nothing.
      'sessions.revokeGrant': ({ id, grant }) => {
        const s = chat(id); const g = oneOf(grant, GRANTS, 'permiso');
        if (g === 'total' && holdsTotal(s)) { const out = sessions.update(s.id, { permission: before(s) }); audit(s, 'totalOff'); halt(s); return out; }
        if (g === 'android' && Number(s.android) === 1) { const out = sessions.update(s.id, { android: 0 }); audit(s, 'androidOff'); halt(s); return out; }
        return s;
      }
    }
  };
}
