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
!define ORB_HOOK_QUIET ; a refusal never waits for a click (no one is at a test)
!define ORB_HOOK_ACCOUNT "${ACCOUNT}" ; User, or Admin (an elevated installer: review D9 B5)
!include "${HOOKS}"
Name "Orb (prueba del puente)"
OutFile "${OUT}"
InstallDir "${TARGET}"
RequestExecutionLevel user
; Version information: Windows Defender's machine-learning check has taken a bare test stub for malware.
VIProductVersion "3.8.1.0"
VIAddVersionKey "ProductName" "Orb test fixture"
VIAddVersionKey "CompanyName" "Orb"
VIAddVersionKey "FileDescription" "Orb bridge test fixture (test/puente-ganchos.e2e.mjs)"
VIAddVersionKey "FileVersion" "3.8.1.0"
VIAddVersionKey "LegalCopyright" "MIT"

Section Install
  SetOutPath $INSTDIR
  !insertmacro NSIS_HOOK_PREINSTALL
  FileOpen $0 "${ARGS_LOG}" w
  FileWrite $0 $CMDLINE
  FileClose $0
  File "/oname=Orb.exe" "${FAKE_ORB}"
  !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd
