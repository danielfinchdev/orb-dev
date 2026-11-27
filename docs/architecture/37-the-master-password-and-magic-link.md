# 37. The master password and Magic Link

Part of [How Orb works](../ARCHITECTURE.md).

One password, made once, protects what Orb keeps for itself and the actions that could hurt. Code: `src-tauri/vault`
(the orb-vault crate: the crypto, the files, the waits, the unlock tokens), `src/domain/security/master.mjs` (the engine's client of
it, same API as before), `src/engine/api/master.mjs` (the API and the guard), `src/domain/security/connector-secrets.mjs`,
`src/shared/mobile-crypto.mjs` (linking), `src/ui/views/master.jsx` and `src/ui/lib/core-access.js`.

**Where the secrets live (3.8.1).** In Rust, not in the engine. Orb.exe runs the vault (`src-tauri/src/vault_host.rs`)
and gives each engine process its own named pipe (`ORB_VAULT_PIPE`; first instance, this user's SID only, no remote
clients, only the engine's process id). The data key, this PC's wrap key and every key made from a password stay in
VirtualLock'ed pages and are wiped after use (zeroize); so are the buffers that carried a password or a secret. The
engine asks for concrete operations: open or seal one secret (`get`/`set`), check a password (scrypt runs as a job it
polls), issue or check an unlock token, check a phone's key confirmation (`pairFinish`: the verifier and K never leave
Rust), or a one-time grant of a connector's keys, which its launcher (`src/mcp/launch.mjs`) trades on a second pipe
(`src/mcp/vault-client.mjs`): those keys never pass through the engine. The files on disk are the same as 3.8's. Without
an app (tests, scripts) the engine starts the `orb-vault` binary (`scripts/vault-build.mjs`, run by `npm test`).
This PC's secret is the vault's too (machine.rs): the engine holds only the keys made from it (approvals, backups), from
which this PC's wrap cannot be derived, and the secrets it opens for its own use (this PC's keys for the phones).

**Keys** (`core\secretos\`):
- A random **data key** (32 bytes) encrypts Orb's own secrets: the PC's X25519 and VAPID keys for the phones (the
  database's `remote_keys` in 3.7, in clear), the connectors' keys (the `env` of each MCP server, in orb.json in 3.7) and
  the phones' **verifier** of the password (below). They live in `secretos.json`, one JSON map sealed with
  XChaCha20-Poly1305.
- `maestra.json`: the data key wrapped by a key made from the password with scrypt (N = 2^17, r = 8, p = 1, 16-byte
  salt). The parameters are stored, and only accepted within bounds (N a power of two between 2^15 and 2^20, r = 8,
  p = 1, a 16-byte salt): a file left there can neither make the check cheap nor hang the engine. An HMAC of that key
  checks the password in constant time before the wrap is opened (itself authenticated). The password is never stored.
- `maestra-pc.json`: the same data key wrapped by a key derived (HKDF) from this PC's secret, the one Windows keeps
  sealed (DPAPI, `core\datos\clave2.enc`, opened by the vault at start: `src-tauri/vault/src/machine.rs`). So
  Orb starts and works without asking for the password; it is asked only for guarded actions and to link a phone. It
  also records, authenticated, that a password was made. Without the app (tests) that secret is `clave.bin`, as for approvals.
- **Which key.** Every wrap carries the id of the data key it holds (`keyId`, an HMAC of the key) in its additional
  data. A password only counts when it opens **the** data key: if this PC already has it open, the key from
  `maestra.json` must be the same (compared in constant time); if not (another PC), it must open the `secretos.json`
  that is there. So a `maestra.json` from another workspace, or made by someone else with their own password, opens
  nothing and gives no token; and a `maestra-pc.json` that does not open is never replaced by a new data key in silence.
- **A password is never made twice.** When `maestra.json` is gone but the vault or this PC's wrap say a password was
  made, `master.state` says `lost` and `master.create` refuses (`msg.master.lost`): it comes back from the copy outside
  core or a backup, or through «He olvidado la contraseña» / «Borrar secretos y empezar de cero».
- The data key is made at the first start of 3.8 (new workspace or one of 3.7), wrapped for this PC only; the
  password wraps it when it is made. From then on, the secrets of earlier versions move into the vault
  (`migrateSecrets`): `remote_keys` is deleted from the database with `secure_delete`, then `VACUUM` (older versions of
  the row in free pages go too) and an emptied journal; orb.json keeps a reference (`orb-secret:mcp/<connector>/<NAME>`)
  per connector key. A value is always looked up by its own connector and variable name, never by the reference text.
  The archive of 3.7 and the copies of its database are cleaned at the same time (`scrubVaultedSecrets`, section 36).
- **Connectors' keys are tied to their program**: the vault keeps a hash of each connector's command and arguments
  (`mcpbind/<connector>`), set when its keys are saved (`secrets.saveConnector`, or `config.save` with the window
  unlocked). A connector whose command or arguments changed without the password (orb.json edited by hand or by an
  agent) gets no keys at all (`resolveEnv`).
- `intentos.json`: wrong tries, per channel (`pc`: this PC's window; `pair`: phones linking; `recovery`: the backups'
  recovery code). After five in a row, 30 s of wait, doubled after each new one (15 min at most); kept across restarts
  and in the engine's memory too (the highest count wins); a right one resets the count. **Fail closed**: when the file
  cannot be written (read-only, a folder in its place) no password or code is checked at all (`msg.master.tries`); a
  damaged file counts as the most fails there can be. Every fifth wrong try in a row on a channel puts a notice in the
  window (`msg.master.failsNotice`).
- A copy of `maestra.json`, `maestra-pc.json` and `secretos.json` lives outside the workspace, next to the copy of
  `clave.enc` (`%APPDATA%\Orb.dev\claves\<workspace>-secretos`, passed by `main.mjs` as `keep`). Before the database
  opens, what is missing in core comes back from it. What it brings back proves nothing by itself (the key checks above).
  The agents' guard keeps that folder and the app's `Local State` closed to them, also when a command names them through
  `%APPDATA%`, `$env:APPDATA`, `${env:APPDATA}`, `$APPDATA` or `~` (`guard.mjs › expandEnv`).
- On another PC (or another Windows user) the PC's wrap does not open: the window shows «Escribe tu contraseña maestra»
  (`MasterLocked`), the phone access does not start, and a right password opens the data key and wraps it for this PC.

**Making it** (welcome after the folder; an Orb updated to 3.8 shows the same screen once and cannot skip it): at least
10 characters (12 or more advised, with a strength hint), typed twice, and a box to tick under «Orb no la guarda:
apúntala» with what that means (the recovery code, or starting from scratch). The first screen of the window is decided
by `src/ui/lib/startup.js` (core, the 3.7 migration, the password, a pending welcome, the folders); the welcome keeps
`setupPending` in orb.json until its last step, so one closed halfway resumes where it stopped, and the «updated to
3.8» wording shows only when the data came from 3.7 (`master.state().upgraded`).

**Guarded actions.** `needsUnlock` (`src/domain/security/permissions.mjs`) lists them: restoring a backup, checking one
(`backup.verify`, which would otherwise test recovery codes for free; a code typed there also has the `recovery`
channel's waits), making a new recovery code (`backup.recovery`: the code opens every backup), deleting the data of Orb
3.7, unlinking a phone (`link.revoke`, `remote.revoke`), a connector's keys (`secrets.connector`,
`secrets.saveConnector`), and in `config.save` (compared with the settings in force): choosing the backups' folder,
writing a connector key in clear, changing a connector that has keys (its command, arguments or name, removing it or one
of its keys) and taking an entry off «Elementos protegidos»; 3.8.1: deleting a project with its folder
(`projects.deleteCheck`; its end, `projects.delete` / `projects.deleteAbort`, takes the one-off ticket the check returned). Opening core in the Explorer too (`main.mjs` asks the engine
`master.check` before `app:openPath` on core itself or on `core\secretos`, compared by real path; core's tool folders
open as before; 3.8.1: the engine's `guardedCore`, used by `app.openIn`, `app.runAction` and `app.openTerminal`, guards
everything inside core but `mcp`, `skills`, `preparacion`, `herramientas`, `bitacora` and `copias\aisladas`, so
`core\datos` too). The dispatcher refuses them without a fresh token: `master.unlock` (the password) gives one for 5
minutes, kept in the engine's memory and the window's (`unlockCore`, which asks with a dialog). It ends with
`master.lock`, called by `main.mjs` when Windows locks, the PC sleeps or shuts down; and with the window, which keeps it
in memory only. 3.8.1, **Orb's lock screen** (owner's decision 20): `master.lock` (Windows locked, the PC asleep,
«Bloquear ahora» in Ajustes › Datos, or `ui.lockMinutes` without a key, click, touch, wheel or pointer move in the
window: 15 by default, `src/ui/lib/idle-lock.js`) also sets the engine's `screenLocked` (memory only; `master.state`
says it) and emits `master:locked { screen: true }`: the window shows only the password screen (`MasterLocked`, also
after a reload: `lib/startup.js`) until `master.unlock` (or change, forgot, reset) clears it. The vault stays open:
agents, schedules and the phone keep working. A new start of Orb opens as before (this PC's key). Changing the password
asks for the current one. `backup.now` stays free. Some actions ask for the
password **every time** (`FRESH_UNLOCK` in `permissions.mjs`; 3.8.1: deleting a project): the window asks even with an
unlock in force (`unlockCore` skips it for `FRESH_ACTIONS`), `master.unlock({ purpose })` gives a token for that action
only, for 2 minutes and never kept, and the dispatcher accepts nothing else for it (an unlock of 5 minutes does not open
it, and its token opens nothing else).

**Change, forgot and starting from scratch.**
- `master.change` wraps the same data key with the new password: nothing else is encrypted again and linked phones stay.
- «He olvidado la contraseña» (`master.forgot`, explicit confirmation) needs the **backups' recovery code** of this PC
  (Ajustes › Datos; checked against its sealed copy, with the `recovery` channel's waits). It works where this PC's wrap
  opens the data key: a **new data key** is made, the secrets are encrypted again with it (old copies of `maestra.json`,
  in backups or old folders, no longer open anything current), this PC's keys for the phones are new (`remote_keys`
  dropped, made again when needed) and **every linked phone and browser is unlinked**. Without a recovery code on this
  PC the engine says so (`noRecovery`).
- Without the code (or on a PC that cannot open the secrets): «Borrar secretos y empezar de cero» (`master.reset`,
  explicit confirmation): the three sealed files go (here and in the copy outside core; backups are never touched), a
  new data key and an empty vault start with the new password, every phone is unlinked and the connectors' keys have to
  be typed again. The window says all of this before.
- On another PC, a backup is opened with this PC's key, the master password or the recovery code (section 36); the
  secrets inside stay sealed with the data key.

**Backups** carry `core\secretos` (never `intentos.json`): the database and orb.json no longer hold any secret in clear,
and the vault inside opens with the password (or the PC secret the backup also carries, as before for approvals).

**Magic Link with the password** (protocol 4, `src/shared/link-payload.mjs`). The password never leaves the phone:
- When the password is made (or changed, forgotten, reset) the PC keeps a **verifier** in the vault: the public half of
  an X25519 key whose private half comes from the password (scrypt N = 2^16, r = 8, p = 1 with its own salt, then HKDF:
  `mobile-crypto.mjs › verifierFromSeed`). A password made before the verifier existed gets it the next time it is typed
  on the PC (`msg.link.noVerifier` meanwhile).
- `/api/pair` has two steps (`mobile-crypto.mjs › linkDevice` on the phone, `remote.mjs › pair` on the PC):
  1. `start`: the phone's public key and its proof sealed with the code's key (the QR's one-time code, or the short code
     stretched with scrypt and tied to the PC's key), as before. The PC checks the code, the clock, the protocol, the
     kind of device and the `pair` waits, and answers, sealed with that same code key, a session id and the verifier's
     salt and cost (the phone refuses a cost outside 2^15–2^18, so a fake PC cannot make its attack cheap).
  2. `finish`: both sides derive `K = HKDF(code ‖ ECDH(phone, PC) ‖ ECDH(password key, PC))`, bound to a hash of the
     whole exchange (`pakeTranscript`: the way in, both public keys, the session id, the salt and cost). The phone sends
     `HMAC(K, 'orb-pake:movil')`; the PC compares it in constant time (with the `pair` channel's waits). Right: the device
     is added and the PC answers `HMAC(K, 'orb-pake:pc:<id>')`, which the phone checks before keeping anything (only the
     real PC, with its private key and the verifier, can make it), plus the box sealed with the new session key.
- A wrong password fails at that key confirmation: 403 (`reason: 'password'`, tries left, no MAC of the PC) and does
  **not** use the code up; five wrong ones on one code cancel it (`reason: 'newCode'`); the `pair` channel's waits apply
  to all codes together (429) and the owner gets a notice after five. Each session id gives one try. Without a master
  password on the PC nobody links (`noMaster`).
- **What an observer learns.** A passive observer of the Wi-Fi, even one who photographed the QR (code and PC key),
  sees two public keys, a session id, sealed boxes and a MAC: without the phone's or the PC's private key there is no
  `ECDH(phone, PC)`, so they cannot check a single password guess against it (`test/contrasena-maestra.test.mjs`).
- **Residual risk.** Someone who impersonates the PC (a forged QR, or someone in the middle of a typed short code who
  also breaks that code) gets the phone's MAC: they cannot read the password, but they can try a dictionary against that
  MAC offline, each guess costing one scrypt (2^16). The defences are the length rule, the fingerprint check below and
  the QR itself (it carries the real PC's key). The proper fix is an augmented PAKE with an OPRF (**OPAQUE**, for
  example `@serenity-kit/opaque`, or an OPRF over ristretto255 from `@noble/curves`), where an impostor gets one online
  guess and nothing to attack offline: future work.
- **The fingerprint.** The phone works out the PC's fingerprint from the key it is about to use (never the other side's
  word) and shows it above the password field; with a typed short code it must be confirmed («Coincide con la del PC»)
  before the password can be typed. The PC shows the same one on its Magic Link screen.
- **Never over plain http.** The password is typed only in the Android app, over https (Tailscale) or on the Tailscale
  address / this device (`link-payload.mjs › passwordPageOk`). A browser page that came in plain http over the Wi-Fi
  shows «Por seguridad, la contraseña maestra no se escribe en una página sin cifrar» instead of asking, and the PC
  refuses its pairing anyway (`plainHttpBrowser`; the setting that allowed it before, `mobile.lanHttp`, is gone). The
  password field does not offer to save it (`autocomplete=off`, a random name).
- `PAIR_PROTOCOL = 4`: a pairing without `v >= 4` and the two steps (an app of 3.7, or one that sends the password)
  gets 426 «Actualiza la app» and the code stays. **Phones linked before 3.8** never proved the password: at the first
  start of 3.8 they are all unlinked once (`relink_38`) with the notice «Vuelve a enlazar tu móvil con Magic Link».
- The PC's keys for the phones are read from the vault when first needed (`remote.mjs › own`); `revokeAll` unlinks every
  device and forgets the cached keys (forgot, reset).

**What it does not protect against.** Code that runs as the same Windows user (malware, or an agent's shell bent on it)
can ask DPAPI to open `clave2.enc`, and from there `maestra-pc.json` and every secret: the master password
adds nothing against it. The agents' guard (section 28) keeps their tools away from core, the copies and the app's
`Local State`, but it is not a boundary. Real isolation would run the agents as another Windows user or in an
AppContainer (not done yet). Without the Windows profile (a copy of core, a backup), the barrier is the password's
strength (scrypt over `maestra.json`) or the recovery code.

Tests: `test/contrasena-maestra.test.mjs` (the round trip, `keyId` and a changed file; a planted, foreign or deleted
`maestra.json` and scrypt's bounds; waits that grow, survive a restart and a deleted file, fail closed when they cannot be
written, and the owner's notice; the token's 5 minutes and the lock; the copy outside core; connectors' references tied
to their command; what is guarded; the engine moving 3.7's secrets (with `VACUUM`), refusing guarded calls without a
fresh token, another PC locked until the password, and a backup with nothing in clear; linking: the password never on
the wire, a passive observer unable to check a guess, a wrong password failing at the key confirmation, five per code,
the global wait, an app of 3.7, a fake PC with the code; change, forgot with the recovery code (new data key), start
from scratch; phones of before 3.8 unlinked once; the guard with environment variables), `test/remote.test.mjs`,
`test/android.test.mjs`, `test/seguridad-351.test.mjs` and `test/copias.test.mjs`.

## What 3.8.8 changes on the lock screen and the keys

- **The lock says when and why.** `master.lock` takes a `reason` (`idle`, `hand`, `windows`, `sleep`; `LOCK_REASONS` in
  `src/engine/api/master.mjs`) and, when it turns the screen lock on, keeps the time and the cause in the engine's memory
  (`lockedAt`, `lockReason`). `master.state` returns them only while the screen is locked and only to this PC's window. The
  first lock keeps its time and cause: a second one (Windows locks while Orb already shows the lock screen) does not
  rewrite them. Who sends the reason: the window for `idle` (`watchIdle` in `src/ui/lib/idle-lock.js`, called from `main.jsx`) and «Bloquear ahora» (`hand`), and
  the app for Windows' lock and sleep (`src-tauri/src/power.rs › lock_master`: `windows` or `sleep`). The card
  (`MasterLocked` in `src/ui/views/master.jsx`) turns the cause into its sentence («Locked at 10:32 after being idle»).
- **The real wait.** When a wrong password still has free tries, the vault says how long the wait will be once they are gone:
  `nextWait` (seconds) in its answer (`src-tauri/vault/src/vault.rs`, `Tried::Wrong`; `src/engine/api/master.mjs` passes it
  on, and it is absent from an older vault). The window says that number instead of a generic text; once the wait has
  begun the answer carries `until`.
- **The app is not mounted under the lock.** The lock screen is drawn instead of the app (`phase === 'unlock'` in
  `src/ui/main.jsx`): behind the veil there is `LockBackdrop`, a drawing of the app's outline made of empty shapes, `inert`
  and `aria-hidden`, with no text and no data, never a copy of what was on screen. The shown password hides again on blur,
  on submit, on a new lock, after 30 seconds (`REVEAL_MS`) and when a dialog opens over the card.
- **The recovery code from the lock screen.** The card can switch to the backups' recovery code. It goes through the same
  path as «He olvidado la contraseña» (`master.forgot`): the secrets stay (a new data key), the user sets a new password
  and every linked phone and browser is unlinked; the card says so before it is used.
- **The recovery code when the password is made.** `MasterCreate` asks for the code right after `master.create`: it calls
  `backup.recovery` with the unlock that `master.create` returned (`src/ui/views/master.jsx`), shows the code once, and
  keeps an existing one as it is (`backup.status › recovery`). If it could not be made, the card says so and offers to
  retry, so the warning about forgetting the password is true from the first day.
- **«Empezar con una clave nueva» from Settings › Data.** Before, only the start-up screen offered it, when Windows could not
  open the key. Now `backup.newKey` (`src/engine/api/data.mjs`, this PC's window only) can be asked for with the key opening
  fine. It always asks for the master password (`FRESH_UNLOCK`: a token for this action alone, action `newKey` in
  `src/ui/lib/core-access.js`) and changes nothing now: it writes a one-use signal file, `clave-nueva.json`, in
  `core\datos`, and the window asks to restart Orb. `backup.cancelKey` removes whichever signal is waiting
  (`clave-nueva.json` or `clave-volver.json`, the way back) and needs no password because removing a signal changes no
  key. `backup.status` reports it as `pendingKey` (`'nueva'` or `'volver'`) and `previousKey` says which key a way back
  leads to.
- **What the vault does at the next start** (`src-tauri/vault/src/machine.rs › new_key`): the signal is acted on only when
  this start has a key that opens, no start-up «clave nueva» came first and no way back is waiting (with both signals the
  way back is served, since the user's last wish is not known). The key in use is never deleted: the new key is sealed
  and checked first, then both files (`clave2.enc` and its copy outside the workspace) are copied aside
  (`*.anterior.enc`), then the record `clave-anterior.json` is written, then the files are replaced, then the signal goes.
  The record lists every key set aside so far (the newest first), so the way back still works after several changes. A cut
  at any point loses no key and does not repeat the change: before the replacement the same key and the signal remain and the
  next start repeats it; after it, the record carries the signal's time and the SHA-256 of the file installed (a fingerprint
  of the file, not of the key), so the next start sees the change is done, says so and removes the signal. A step that fails
  restores the previous record, removes the signal and keeps the key in use.
- **Notices.** The engine turns the vault's warnings into notices (`KEY_NOTICES` in `src/engine/engine.mjs`):
  `newKeyDone` («Orb has started with a new key. The old one is kept…») and `newKeyFailed` join the existing
  `previousOpens`, `previousBack`, `previousNew` and `previousFailed`. A recovery code made with the key that is no longer
  in use stops opening backups (`switchedKey`); a notice (`sys.engine.recoveryOtherKey`) says so.

## A phone's fingerprint approves sensitive actions (3.8.10)

What shows, saves or hands out a secret asks for the password, or for the approval of a registered phone. Code:
`src-tauri/vault/src/approve.rs` (the checks), `src/domain/security/approve.mjs` (the text both sides agree on),
`src/engine/api/master.mjs` (`approve.*`, `checkUnlock`) and `android/.../approve/` (the phone).

- **The key.** The phone makes an ECDSA P-256 key in its Keystore that only a strong biometric (class 3, no PIN) can use,
  and only when this PC registers it (Ajustes › Dispositivos, with the password or code typed there and the phone's name in
  sight). Registering is a challenge signed with the new key, so the PC knows it is there. The public half is kept in
  `secretos.json` as `master/approve/<deviceId>`. A new fingerprint kills the key: the phone never makes another by itself.
- **What is signed.** One challenge per approval, drawn in Rust (nonce of 32 bytes, one use, two minutes), over
  `len32(field)` + field for: `"orb-approve-v1"`, action, SHA-256 of the parameters' summary, nonce, orbId, deviceId, this PC's
  public key and the expiry. The phone shows the action from those bytes and checks that the summary it shows hashes to the
  signed hash. A valid signature spends the challenge and gives a one-use token of `mobile` strength whose purpose is
  `approve:<action>:<hash>`, so it opens that call with those parameters and nothing else (`check` takes it only by name).
- **Unlinking** a phone (`link.revoke`, `remote.revoke`, `unlinkAll`), `rotate`, `reset` and `wipe_all` delete its entry.
- **«Lo he olvidado todo»** (no password, no code): Hello's token with the purpose `rebuild-master`, then the registered
  phone signs `master.rebuild`, then a new password and a new generated code are made in one request (`rebuildFinish`). The
  data key stays, so no phone is unlinked. With no registered phone nothing is made.

## Windows Hello, the recovery code and the link code (3.8.10)

- **Windows Hello** (`src-tauri/vault/src/hello.rs`, `windows_hello.rs`, `src/ui/views/hello.jsx`). Hello is a key pair
  made by Windows (`Orb:<account>`, in the TPM when there is one). The vault keeps only its public half in `master/hello`
  and asks it to sign a one-use nonce (two minutes); three failures lock it for 30 seconds. A valid signature gives a token
  weaker than the password's, so Hello opens the lock screen and protected dialogs but never agent secrets: those still
  need the password, a recovery code or an approval from the phone. `fake_hello.rs` is the test double.
- **Recovery code** (`code_ops.rs`, `maestra-codigo.json`). A generated code (never a typed phrase) wraps the data key
  with HKDF over scrypt, with the file header as AAD and the same cost as `maestra.json`. It unlocks the vault on a new PC
  and is the way back when the password is lost. Regenerating it re-keys by default.
- **Link code.** A new phone can be linked without the master password: the vault makes an 8-character code and a 128-bit
  secret for the QR in memory only (new salt per code, five minutes, three failures, one use). The exchange is a PAKE, the
  PC shows its fingerprint and the name the phone gave and asks you to confirm, and the result never lets the phone
  approve actions. API: `link.codeNew`, `link.codeAnswer`, `link.codeWaiting`, `link.codeCancel` (`src/engine/api/master.mjs`).
- Details of the phone approvals and of "I forgot everything" are in the section above.
