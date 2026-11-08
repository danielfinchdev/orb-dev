; Orb's installer hooks (tauri.conf.json > bundle.windows.nsis.installerHooks): from Orb 3.8.0 (Electron) to 3.8.1 (Tauri)
; without uninstalling anything by hand (docs/ARCHITECTURE.md > Updates).
;  - Before installing: if Orb on Electron is installed for this user, its own uninstaller runs silently and is waited
;    for. It stops a running Orb 3.8.0 and removes its program folder, its shortcuts, its AppUserModelID and its
;    uninstall entry. Never the data: %APPDATA%\Orb.dev (the workspace's location, the copies of the keys, Local State)
;    and the workspace (C:\Orb) stay, because electron-builder's uninstaller keeps the app's data unless it is asked to
;    delete it (--delete-app-data, never passed here). Then a mark for Orb's first start (src-tauri/src/migrate.rs):
;    %APPDATA%\Orb.dev\migrado-desde-electron.json.
;    Only from a folder that is surely Orb 3.8.0's (its uninstaller deletes it whole), with no Orb of this user running
;    (its fallback `taskkill /IM Orb.exe` would end Orb on Tauri too), and only on to the installation when it worked:
;    otherwise the user is told and nothing is installed (Orb 3.8.0 stays as it was).
;  - After installing: when Orb 3.8.0's updater started this installer (electron-updater passes --updated /S --force-run),
;    Orb opens; Tauri's own silent mode only opens it with /R.
; ORB_ELECTRON_UNINSTKEY, ORB_ELECTRON_DEFAULT_DIR and ORB_DATA_DIR may be defined before this file: the bridge test
; (test/puente-electron.e2e.mjs) builds a test installer with these same hooks against a fake 3.8.0 in a temporary
; folder and registry key, and ORB_HOOK_LOG to see what opening Orb returned. The real installer uses the defaults below
; and never defines ORB_HOOK_LOG.

!include LogicLib.nsh
!include FileFunc.nsh
!include WordFunc.nsh

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

; Why the bridge stops (review D9 M3/M4/M5): said to the user (never in silent mode: there it is the exit code) and the
; installation stops before anything is installed. Orb 3.8.0 stays installed and usable.
!macro OrbRefuse TEXT
  DetailPrint "${TEXT}"
  MessageBox MB_OK|MB_ICONEXCLAMATION "${TEXT}" /SD IDOK
  SetErrorLevel 2
  Abort
!macroend

; $R0 = 1 when $R1 is $R2 or inside it (case-insensitive, as Windows' paths), else 0.
Function OrbInside
  Push $R3
  Push $R4
  StrCpy $R0 0
  ${If} $R1 == $R2
    StrCpy $R0 1
  ${Else}
    StrLen $R4 "$R2\"
    StrCpy $R3 $R1 $R4
    ${If} $R3 == "$R2\"
      StrCpy $R0 1
    ${EndIf}
  ${EndIf}
  Pop $R4
  Pop $R3
FunctionEnd

; $R0 = the workspace (ubicacion.json's "home" in Orb's data folder, JSON-escaped backslashes undone), else C:\Orb.
Function OrbWorkspace
  Push $0
  Push $1
  StrCpy $R0 ""
  ClearErrors
  FileOpen $0 "${ORB_DATA_DIR}\ubicacion.json" r
  ${IfNot} ${Errors}
    FileRead $0 $1 4096
    FileClose $0
    ${WordFind2X} $1 '"home":"' '"' "+1" $R0
    ${If} $R0 == $1
      StrCpy $R0 "" ; not found
    ${Else}
      ${WordReplace} $R0 "\\" "\" "+" $R0
    ${EndIf}
  ${EndIf}
  ${If} $R0 == ""
    StrCpy $R0 "C:\Orb"
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

; $R0 = 1 when $OrbElectronDir is a folder 3.8.0's uninstaller may remove whole (its RMDir /r): electron-builder's
; default, or a folder ending in \Orb that holds Orb 3.8.0 (Orb.exe and resources\app.asar); and in no case the
; workspace, a folder holding it or inside it, nor Orb's data folder (or one holding it).
Function OrbSafeToRemove
  Push $R1
  Push $R2
  Push $R5
  StrCpy $R5 0
  ${If} $OrbElectronDir == "${ORB_ELECTRON_DEFAULT_DIR}"
    StrCpy $R5 1
  ${Else}
    StrCpy $R1 $OrbElectronDir "" -4
    ${If} $R1 == "\Orb"
    ${AndIf} ${FileExists} "$OrbElectronDir\Orb.exe"
    ${AndIf} ${FileExists} "$OrbElectronDir\resources\app.asar"
      StrCpy $R5 1
    ${EndIf}
  ${EndIf}
  ${If} $R5 == 1
    Call OrbWorkspace
    StrCpy $R2 $R0
    StrCpy $R1 $OrbElectronDir
    Call OrbInside ; the app's folder is the workspace or inside it
    ${If} $R0 == 1
      StrCpy $R5 0
    ${EndIf}
    StrCpy $R1 $R2
    StrCpy $R2 $OrbElectronDir
    Call OrbInside ; the workspace is inside the app's folder
    ${If} $R0 == 1
      StrCpy $R5 0
    ${EndIf}
    StrCpy $R1 "${ORB_DATA_DIR}"
    Call OrbInside ; Orb's data folder is inside it (or is it)
    ${If} $R0 == 1
      StrCpy $R5 0
    ${EndIf}
  ${EndIf}
  StrCpy $R0 $R5
  Pop $R5
  Pop $R2
  Pop $R1
FunctionEnd

Function OrbRemoveElectron
  Push $0
  Push $1
  Push $R0
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
  ; M4: its uninstaller deletes its whole folder: only one that is surely Orb 3.8.0's.
  Call OrbSafeToRemove
  ${If} $R0 != 1
    !insertmacro OrbRefuse "Orb $OrbElectronVersion está instalado en $OrbElectronDir. El instalador no lo quita solo de esa carpeta: desinstálalo desde Configuración > Aplicaciones (tus datos se quedan) y vuelve a abrir este instalador.$\r$\n$\r$\nOrb $OrbElectronVersion is installed in $OrbElectronDir. The installer will not remove it from that folder by itself: uninstall it from Settings > Apps (your data stays) and open this installer again."
  ${EndIf}
  ; M5: no Orb.exe of this user may be running when 3.8.0's uninstaller runs (if PowerShell fails it falls back to
  ; `taskkill /IM Orb.exe`, which would also end Orb on Tauri: the same name). Orb 3.8.0 closing after «Reiniciar e
  ; instalar» is waited for.
  StrCpy $1 0
  ${Do}
    nsis_tauri_utils::FindProcessCurrentUser "Orb.exe"
    Pop $0
    ${If} $0 != 0
      ${ExitDo}
    ${EndIf}
    ${If} $1 >= 30
      !insertmacro OrbRefuse "Orb sigue abierto. Ciérralo y vuelve a abrir este instalador.$\r$\n$\r$\nOrb is still open. Close it and open this installer again."
    ${EndIf}
    Sleep 500
    IntOp $1 $1 + 1
  ${Loop}
  ; In place (_?=), so it is waited for; without it the uninstaller copies itself to %TEMP% and returns at once.
  ClearErrors
  ExecWait '"$OrbElectronDir\Uninstall Orb.exe" /S /currentuser _?=$OrbElectronDir' $0
  ${If} ${Errors}
    StrCpy $0 "no-se-pudo-abrir"
  ${EndIf}
  ; M3: it failed (Orb 3.8.0 could not be closed, a file in use…) or left Orb 3.8.0 there: nothing more is done and
  ; nothing is installed; 3.8.0 keeps its uninstaller and stays usable.
  ${If} $0 != 0
  ${OrIf} ${FileExists} "$OrbElectronDir\Orb.exe"
    !insertmacro OrbRefuse "No se pudo desinstalar Orb $OrbElectronVersion ($0). Cierra Orb, desinstálalo desde Configuración > Aplicaciones (tus datos se quedan) y vuelve a abrir este instalador.$\r$\n$\r$\nOrb $OrbElectronVersion could not be uninstalled ($0). Close Orb, uninstall it from Settings > Apps (your data stays) and open this installer again."
  ${EndIf}
  ; Run in place it cannot delete itself; its folder goes only if nothing else is left in it.
  Delete "$OrbElectronDir\Uninstall Orb.exe"
  RMDir "$OrbElectronDir"
  CreateDirectory "${ORB_DATA_DIR}"
  ClearErrors
  FileOpen $1 "${ORB_DATA_DIR}\migrado-desde-electron.json" w
  ${IfNot} ${Errors}
    ; B6: only plain values in the mark (a version with quotes would break the JSON).
    ${WordReplace} $OrbElectronVersion '"' "" "+" $OrbElectronVersion
    ${WordReplace} $OrbElectronVersion "\" "" "+" $OrbElectronVersion
    FileWrite $1 '{"from":"electron","version":"$OrbElectronVersion","uninstaller":"$0"}'
    FileClose $1
  ${EndIf}
  done:
  Pop $R0
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
