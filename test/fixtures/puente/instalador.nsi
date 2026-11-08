; A test installer with Orb's real installer hooks (src-tauri/nsis/hooks.nsh), for test/puente-electron.e2e.mjs: the
; same order as Tauri's template (PREINSTALL, the files, POSTINSTALL), but installing a fake Orb into a temporary folder
; and pointed at a fake Orb 3.8.0 (a temporary folder and a test registry key), so nothing of the real PC is touched.
Unicode true
!addplugindir "${TAURI_PLUGINS}"
!define MAINBINARYNAME "Orb"
!define ORB_ELECTRON_UNINSTKEY "${UNINSTKEY}"
!define ORB_ELECTRON_DEFAULT_DIR "${DEFAULT_DIR}"
!define ORB_DATA_DIR "${DATA_DIR}"
!define ORB_HOOK_LOG "${HOOK_LOG}"
!include "${HOOKS}"
Name "Orb (prueba del puente)"
OutFile "${OUT}"
InstallDir "${TARGET}"
RequestExecutionLevel user

Section Install
  SetOutPath $INSTDIR
  !insertmacro NSIS_HOOK_PREINSTALL
  FileOpen $0 "${ARGS_LOG}" w
  FileWrite $0 $CMDLINE
  FileClose $0
  File "/oname=Orb.exe" "${FAKE_ORB}"
  !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd
