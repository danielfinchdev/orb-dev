# 31. How to rework a feature

Part of [How Orb works](../ARCHITECTURE.md).

1. Find the feature in this document and open only its files.
2. Respect the contracts between layers:
   - the live session interface (`live.mjs`);
   - the API actions (`api.mjs`: name and parameters);
   - the events (`session:item`, `session:delta`, `session:queue`, `approval:changed`, `chat:state`, `board:changed`);
   - the `db.mjs` tables (add columns with `ADDED`, never delete them).
3. Give every new API method its line in `METHODS` (`src/domain/security/permissions.mjs`, section 34): `'remote'` if the phone
   may use it, `'pc'` otherwise.
4. New strings with `t()` in both languages.
5. A test in `test/` with the fake agent (`fake-live.mjs` recognizes keywords like `LIMITE`, `PIDE_PERMISO`,
   `DELEGA`, `DUERME`…).
6. `npm run check` and `npm test` green before pushing.
