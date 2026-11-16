# 35. From 3.7 to 3.8 (migration)

Part of [How Orb works](../ARCHITECTURE.md).

`src/domain/data/legacy/migrate-38.mjs`, run once by `openDb` on this home's database (after the older migrations), so before the
engine opens the phone access, and again after a 3.7 backup is restored. Setting `migrated_3_8` marks it done; a new
3.8 database only gets the mark. One process at a time: an exclusive transaction on `core/datos/migracion-3.8.lock.db`
(the system lets it go when the process ends, however it ends; removed once the run is done).

1. **Before anything else**: orb.json as it was, once, in `core/datos/migracion-3.8/orb-3.7.json` (out of the archive
   and the backups: it has other users' keys; the archive and the new orb.json are built from it) and
   `core/datos/orb-pre-3.8.db` (VACUUM INTO a `.tmp`, `PRAGMA quick_check` and the same tables, fsync, rename). An empty
   or broken copy is set aside as `.roto-<date>`; a good one is reused only while the database still matches its
   fingerprint (tables, rows and last rowid of each, settings; kept in `migracion-3.8.json`): a copy of an earlier attempt
   made before Orb 3.7 was used again goes aside as `-intento-<date>` and is deleted when the run is done.
2. **One transaction** (`BEGIN IMMEDIATE`): the readable archive `core/archivo-3.7/` is written and the files are only
   COPIED into it (`LEEME.txt`; `orb-3.7.json` without other users' keys; `bots/`: rows as JSON, the bots'
   conversations, the old `bots/` folder and `bots-borrados`; `usuarios/<name>-<id>/`: each other user's conversations,
   loose chat lines, sessions, tasks (with their settings, run logs, isolated copies without dependencies and undo
   checkpoints), projects, schedules, devices, usage, files and their accounts' names without secrets, by name and by
   value; `usuarios/desconocido/` for accounts of an unknown person; `tablas/`; `orb-json-retirado.json`; the sealed
   `enlaces.json`; the bridge's `%LOCALAPPDATA%\OrbPuente\orb.json`). Then the `home_*` triggers; the bots' and groups'
   conversations and list marks; the other users' rows (their spending too); the owner's rows get `person_id = NULL`
   (the columns go in 3.9) and the list marks the key `'owner'`; devices of kind `orb`/`terminal`; the tables of bots,
   replicas, links and persons and their indexes; the devices' columns `role`, `admin`, `kind_ok`, `approve`, `dev_ok`;
   the old settings. The owner is the active owner, else a deleted owner, else the oldest administrator, else the only
   person; with none and other people's rows, nothing is done. Another user's project shared with the owner, or named by
   the owner's tasks, schedules, sessions or conversations, becomes the owner's; the other ones' folders in the
   categories go to `projects_ignored` (`syncProjects` skips them and drops folders that no longer exist; adding one with
   `board.addProject` lists it again). The same transaction saves the plan of files (`migrated_3_8_files`: originals to
   delete once their copy is in the archive, the other users' sign-in and run folders, the owner's pictures and phone
   uploads to put back in `imagenes/` and `adjuntos-movil/`, renamed «name (3.7).ext» on a clash and the chat lines
   that name them updated), the new orb.json with what it is made of (`migrated_3_8_config`) and `migrated_3_8_at`.
3. **After the COMMIT** (`finish`, also at the next start if the process ended): the plan; orb.json (`bots`, `oce`,
   `monitor`, `role`, `devTarget`, `ui.mode`, `browser.sites` and anyone else's accounts and connectors go; `person`
   leaves the rest; the owner's `userName`, `tz`, language, phone previews and brain from `persons`/`person_settings`),
   written only over the orb.json it came from and made again from the file as it is when that changed meanwhile;
   the original orb.json and the run file are removed and the database is VACUUMed.

A run that fails before the COMMIT leaves the database and the files of 3.7 as they were (only the archive and the copy
are new) and the next one reuses them; a 3.7 database restored after a migration is a new run with a dated archive and
copy (`archivo-3.7-<date>`, `orb-pre-3.8-<date>.db`). While the database is still 3.7, or its files or orb.json are not
finished (`unfinished`: also when orb.json cannot be written), the engine does not start the scheduler, the agents or
the phone access and the MCP server refuses it; the window shows «No se pudieron actualizar tus datos a Orb 3.8», what to
do, the copy («Abrir carpeta»), «Reintentar», «Buscar actualización» (the app's updater) and the reason under «Detalles»
(`app.migrationState`, `app.migrationRetry`, PC only; `committed` says whether going back to 3.7 would need the copy).
3.8.2 (review F2.5b M6): meanwhile, with the phone access turned on, its addresses and port answer one fixed state
(`remote.mjs › startAttention`): every `/api/` request gets 503 `{ attention: 'migration', error }` (with the Android
app's CORS) and a page a short notice; no data, devices or keys are read. A linked phone shows «El PC necesita atención»
instead of «Sin conexión» and keeps retrying (`main.jsx › PcOffline`); a successful «Reintentar» closes it before the
real phone access opens on the same port.
The migration writes only inside the data folder and the bridge's file (`insideData`); `ORB_BRIDGE_DIR` is for tests
only, and under `node --test` without it there is no bridge. The engine tells the owner once («Orb 3.8 ya no tiene bots
ni usuarios…», `data.migrated38`, and to revoke Home Assistant's token when 3.7 had one) and logs what was done. 30 days
after, the copies `orb-pre-3.8*.db` lose 3.7's secrets (PIN hashes, devices' keys, `secret:*`, `remote_keys`, agents'
signatures) and are VACUUMed (`scrubPreCopies`, told once). Ajustes › Datos › «Borrar los datos de Orb 3.7»
(`legacy.status`, `legacy.delete`, PC only) deletes the archives and the copies. Backups include every `archivo-3.7*/`
without sign-in folders. Tests: `test/migracion-38.test.mjs` (3.7 with two users, 3.6 and 3.5.1 databases, the phone
access, backups without other users' keys, a failed transaction that leaves every file in place and its retry, orb.json
that cannot be written, a broken or outdated copy, no owner, two restores, the lock, the owner's clashing pictures,
other users' isolated copies, shared projects, the 30-day scrub, the blocked screen and the blocked engine).
