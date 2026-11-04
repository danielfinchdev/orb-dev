// 3.6 «Personas»: every event of the engine goes through here once. The router asks authz.audienceOf who it is for and
// hands it to each sink with that audience: this PC's window (the person sitting at it), the phones' and browsers' live
// streams and their notifications (each device's person), the centre a workshop sends its events to (the person its link
// belongs to here) and the window of a workshop for the centre's bots (centro:*). A sink never decides by itself who
// may see an event: it only asks reaches(audience, its person).
import { audienceOf, reaches } from '../core/authz.mjs';

// hint: an audience the caller already knows (a workshop's events belong to the person of its link; a notice for a
// person and the owner); otherwise the event's rule in src/core/policy.mjs decides.
export function createRouter({ board, log = () => {} } = {}) {
  const sinks = [];
  const router = {
    // sink(event, payload, audience, reachesPerson)
    add(name, fn) { sinks.push({ name, fn }); return router; },
    audience(event, payload, hint = null) {
      if (hint?.persons instanceof Set || hint?.all || hint?.owner) return hint;
      if (hint?.person) return { persons: new Set([String(hint.person)]) };
      return audienceOf(board, event, payload);
    },
    route(event, payload, hint = null) {
      let audience;
      try { audience = router.audience(event, payload, hint); } catch (error) { log(`router: ${event}: ${error.message}`); audience = { owner: true }; }
      const to = (person) => reaches(board, audience, person);
      for (const s of sinks) { try { s.fn(event, payload, audience, to); } catch (error) { log(`router: ${s.name}: ${error.message}`); } }
      return audience;
    },
    // A share was removed or a device changed person: nothing to cut here (each event's audience is worked out when it
    // is sent), but the people affected reload what they may see.
    revoke(persons = []) { for (const p of persons) router.route('board:changed', ['shares'], { person: p }); }
  };
  return router;
}
