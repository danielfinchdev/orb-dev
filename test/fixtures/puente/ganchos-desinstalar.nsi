; A test installer and uninstaller with Orb's real hooks (src-tauri/nsis/hooks.nsh), for test/desinstalar-ganchos.test.mjs and
; test/desinstalar-ganchos.e2e.mjs: Tauri's template order (PREINSTALL, files, POSTINSTALL; PREUNINSTALL, files, POSTUNINSTALL),
; installing a fake Orb into a temporary folder. Every folder the hooks touch (the app's data, the web view's profile, the old
; Electron entry) is a temporary one given with /D, and $Upd stands for Tauri's $UpdateMode. Nothing of the real PC is touched.
Unicode true
!define MAINBINARYNAME "Orb"
!define ORB_ELECTRON_UNINSTKEY "${UNINSTKEY}"
!define ORB_ELECTRON_DEFAULT_DIR "${DEFAULT_DIR}"
!define ORB_DATA_DIR "${DATA_DIR}"
!define ORB_LOCAL_DIR "${LOCAL_DIR}"
!define ORB_HOOK_QUIET
!define ORB_HOOK_ACCOUNT "User"
!define ORB_UPDATE_VAR $Upd
!include LogicLib.nsh
Var Upd
!include "${HOOKS}"
!addplugindir "${TAURI_PLUGINS}"
Name "Orb (prueba de los ganchos de desinstalar)"
OutFile "${OUT}"
InstallDir "${TARGET}"
RequestExecutionLevel user
VIProductVersion "3.8.12.0"
VIAddVersionKey "ProductName" "Orb test fixture"
VIAddVersionKey "CompanyName" "Orb"
VIAddVersionKey "FileDescription" "Orb uninstall hooks test fixture"
VIAddVersionKey "FileVersion" "3.8.12.0"
VIAddVersionKey "LegalCopyright" "MIT"

Function .onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $Upd 1
  ${EndIf}
FunctionEnd

Function un.onInit
  ${un.GetParameters} $0
  ClearErrors
  ${un.GetOptions} $0 "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $Upd 1
  ${EndIf}
FunctionEnd

Section Install
  SetOutPath $INSTDIR
  !insertmacro NSIS_HOOK_PREINSTALL
  FileOpen $0 "$INSTDIR\Orb.exe" w
  FileWrite $0 "fake"
  FileClose $0
  WriteUninstaller "$INSTDIR\uninstall.exe"
  !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd

Section Uninstall
  !insertmacro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\Orb.exe"
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd
