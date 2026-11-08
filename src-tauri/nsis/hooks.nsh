; Orb's installer hooks (tauri.conf.json > bundle.windows.nsis.installerHooks): from Orb 3.8.0 (Electron) to 3.8.1 (Tauri)
; without uninstalling anything by hand (docs/ARCHITECTURE.md > Updates).
;  - Before installing: if Orb on Electron is installed for this user, its own uninstaller runs silently and is waited
;    for. It stops a running Orb 3.8.0 and removes its program folder, its shortcuts, its AppUserModelID and its
;    uninstall entry. Never the data: %APPDATA%\Orb.dev (the workspace's location, the copies of the keys, Local State)
;    and the workspace (C:\Orb) stay, because electron-builder's uninstaller keeps the app's data unless it is asked to
;    delete it (--delete-app-data, never passed here). Then a mark for Orb's first start (src-tauri/src/migrate.rs):
;    %APPDATA%\Orb.dev\migrado-desde-electron.json.
;  - After installing: when Orb 3.8.0's updater started this installer (electron-updater passes --updated /S --force-run),
;    Orb opens; Tauri's own silent mode only opens it with /R.
; ORB_ELECTRON_UNINSTKEY, ORB_ELECTRON_DEFAULT_DIR and ORB_DATA_DIR may be defined before this file: the bridge test
; (test/puente-electron.e2e.mjs) builds a test installer with these same hooks against a fake 3.8.0 in a temporary
; folder and registry key, and ORB_HOOK_LOG to see what opening Orb returned. The real installer uses the defaults below
; and never defines ORB_HOOK_LOG.

!include LogicLib.nsh
!include FileFunc.nsh

!ifndef ORB_ELECTRON_UNINSTKEY
  ; electron-builder's per-user uninstall entry for appId dev.orb.app (a UUID v5 of the appId)
  !define ORB_ELECTRON_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\c791290b-4a7b-5a24-9cba-134994a22734"
!endif
!ifndef ORB_ELECTRON_DEFAULT_DIR
  !define ORB_ELECTRON_DEFAULT_DIR "$LOCALAPPDATA\Programs\Orb"
!endif
!ifndef ORB_DATA_DIR
  !define ORB_DATA_DIR "$APPDATA\Orb.dev"
!endif

Var OrbElectronDir
Var OrbElectronVersion

Function OrbRemoveElectron
  Push $0
  Push $1
  ; Where it is: its uninstall entry (the user may have chosen another folder), else electron-builder's default.
  ReadRegStr $OrbElectronDir HKCU "${ORB_ELECTRON_UNINSTKEY}" "InstallLocation"
  ReadRegStr $OrbElectronVersion HKCU "${ORB_ELECTRON_UNINSTKEY}" "DisplayVersion"
  ${If} $OrbElectronDir == ""
    StrCpy $OrbElectronDir "${ORB_ELECTRON_DEFAULT_DIR}"
  ${EndIf}
  ${IfNot} ${FileExists} "$OrbElectronDir\Uninstall Orb.exe"
  ${OrIf} $OrbElectronDir == $INSTDIR
    Goto done
  ${EndIf}
  DetailPrint "Orb $OrbElectronVersion (Electron): $OrbElectronDir"
  ; In place (_?=), so it is waited for; without it the uninstaller copies itself to %TEMP% and returns at once.
  ClearErrors
  ExecWait '"$OrbElectronDir\Uninstall Orb.exe" /S /currentuser _?=$OrbElectronDir' $0
  ${If} ${Errors}
    StrCpy $0 "no-se-pudo-abrir"
  ${EndIf}
  ; Run in place it cannot delete itself; its folder goes only if nothing else is left in it.
  Delete "$OrbElectronDir\Uninstall Orb.exe"
  RMDir "$OrbElectronDir"
  CreateDirectory "${ORB_DATA_DIR}"
  ClearErrors
  FileOpen $1 "${ORB_DATA_DIR}\migrado-desde-electron.json" w
  ${IfNot} ${Errors}
    FileWrite $1 '{"from":"electron","version":"$OrbElectronVersion","uninstaller":"$0"}'
    FileClose $1
  ${EndIf}
  done:
  Pop $1
  Pop $0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  Call OrbRemoveElectron
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--updated" $1
  ${IfNot} ${Errors}
    nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
    Pop $1 ; its result (0: opened)
    !ifdef ORB_HOOK_LOG
      FileOpen $0 "${ORB_HOOK_LOG}" a
      FileWrite $0 "runasuser=$1$\r$\n"
      FileClose $0
    !endif
  ${EndIf}
  Pop $1
  Pop $0
!macroend
