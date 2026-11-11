# 30. Tests

Part of [How Orb works](../ARCHITECTURE.md).

| Command | What it covers |
|---|---|
| `npm test` | Every `test/*.test.mjs` (including that the es/en dictionaries match and that the English has no Spanish) of the engine with fake agents (`test/fixtures/fake-live.mjs` via `ORB_FAKE_AGENTS`), the real protocols against fake servers (ACP, codex app-server, Cursor CLI), the guard, sessions, tasks, delegation, Task Review, usage, permissions, the phone access, the master password and migrations |
| `cd src-tauri && cargo test --lib` | The app's Rust: sealing (and Orb 3.8.0's real Electron from the build cache, `ORB_TEST_ELECTRON`), stdio, guards, delete, notices |
| `npm run test:app` | The whole app on the e2e build (`npm run tauri:build:e2e` first), its window hidden, driven over CDP (`test/fixtures/launch-orb.mjs`) |
| `node test/smoke.e2e.mjs` | The packaged app: the e2e build hidden; a release build only in CI (`--visible`), engine and MCP server |
| `node test/tauri-navegador.e2e.mjs` | The agents' browser on real WebView2 (hidden): limits, isolation, a flooding page |
| `node test/tauri-actualizar.e2e.mjs` · `node test/puente-ganchos.e2e.mjs` · `node test/puente-electron.e2e.mjs` | Updates (test key, local feed), the installer's hooks, and the bridge from an installed 3.8.0 (hidden desktop) |
| `node test/tauri-instalar.e2e.mjs` | A real update of an installed Orb: «Reiniciar e instalar», the backup, the passive installer and the new version opening (test builds «OrbPrueba» in a temporary folder) |
| `node scripts/medir.mjs --hidden` | Performance of the e2e build (`--shell electron --exe <copy of 3.8.0>`: the baseline): start, memory, CPU at rest and scrolling (§27, Performance) |
| `node test/explora.e2e.mjs` | Walkthrough with screenshots in `test-results/explora/`: first launch ("Preparing your PC", with the folder dialog mocked), every view and Settings section in day and night, the five themes, narrow window. With `ORB_LANG=en`, the same in English (`explora-en/`). Notes go to `notas.txt` |
| `node test/real.e2e.mjs claude,codex,cursor` | **Real agents**: conversations, assistant task, report, undo, approval, steering, queue, fork, Task Review and scheduled tasks |
| `node test/packaged-live.e2e.mjs` | The packaged app with real Claude (by hand) |
