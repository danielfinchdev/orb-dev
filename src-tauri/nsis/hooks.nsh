; Orb's installer hooks (tauri.conf.json > bundle.windows.nsis.installerHooks): from Orb 3.8.0 (Electron) to 3.8.1 (Tauri)
; without uninstalling anything by hand (docs/ARCHITECTURE.md > Updates).
;  - Before installing: if Orb on Electron is installed for this user, its own uninstaller runs silently and is waited
;    for. It stops a running Orb 3.8.0 and removes its program folder, its shortcuts, its AppUserModelID and its
;    uninstall entry. Never the data: %APPDATA%\Orb.dev (the workspace's location, the copies of the keys, Local State)
;    and the workspace (C:\Orb) stay, because electron-builder's uninstaller keeps the app's data unless it is asked to
;    delete it (--delete-app-data, never passed here). Then a mark for Orb's first start (src-tauri/src/migrate.rs):
;    %APPDATA%\Orb.dev\migrado-desde-electron.json.
;    Only from a folder that is surely Orb 3.8.0's (its uninstaller deletes it whole), with no other Orb of this user
;    running (its fallback `taskkill /IM Orb.exe` would end Orb on Tauri too), and only on to the installation when it
;    worked: otherwise the user is told, nothing is installed and Orb 3.8.0 stays as it was (and opens again when its
;    updater had closed it), with %APPDATA%\Orb.dev\puente-fallido.json saying why.
;  - After installing: when Orb 3.8.0's updater started this installer (electron-updater passes --updated /S --force-run),
;    Orb opens; Tauri's own silent mode only opens it with /R.
; ORB_ELECTRON_UNINSTKEY, ORB_ELECTRON_DEFAULT_DIR and ORB_DATA_DIR may be defined before this file: the bridge tests
; (test/puente-electron.e2e.mjs, test/puente-ganchos.e2e.mjs) build test installers with these same hooks against a fake
; 3.8.0 in a temporary folder and registry key, ORB_HOOK_LOG to see what opening Orb returned and ORB_HOOK_QUIET so a
; refusal never waits for a click. The real installer uses the defaults below and defines neither.

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
Var OrbUpdated ; 1 when Orb 3.8.0's updater started this installer (it closed Orb 3.8.0 first)

; Why the bridge stops (reviews D9 M3/M4/M5, D10 M1): nothing is installed and Orb 3.8.0 stays installed and usable.
;  - %APPDATA%\Orb.dev\puente-fallido.json says why (REASON, a plain word), for support and for a later Orb;
;  - the user is told: always when someone is at the installer, and also in silent mode when Orb 3.8.0's updater started
;    it (the user just pressed «Reiniciar e instalar» and is waiting for Orb); a plain silent run only sets the exit code;
;  - Orb 3.8.0 opens again when its updater had closed it (otherwise the user is left with no Orb and no reason);
;  - the empty folder Tauri's template already made for the new Orb goes.
!macro OrbRefuse TEXT REASON
  DetailPrint "${TEXT}"
  CreateDirectory "${ORB_DATA_DIR}"
  ClearErrors
  FileOpen $9 "${ORB_DATA_DIR}\puente-fallido.json" w
  ${IfNot} ${Errors}
    FileWrite $9 '{"from":"electron","version":"$OrbElectronVersion","reason":"${REASON}","updated":$OrbUpdated}'
    FileClose $9
  ${EndIf}
  !ifdef ORB_HOOK_QUIET
    MessageBox MB_OK|MB_ICONEXCLAMATION "${TEXT}" /SD IDOK
  !else
    ${If} $OrbUpdated == 1
      MessageBox MB_OK|MB_ICONEXCLAMATION "${TEXT}"
    ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION "${TEXT}" /SD IDOK
    ${EndIf}
  !endif
  ${If} $OrbUpdated == 1
  ${AndIf} ${FileExists} "$OrbElectronDir\Orb.exe"
    ; Exec, not nsis_tauri_utils::RunAsUser: Tauri's template includes these hooks before its `!addplugindir`, so a
    ; plugin call in a Function (this macro runs in OrbRemoveElectron) does not build, and adding the folder here
    ; makes the template's own one conflict. Orb 3.8.0's updater starts this installer as the user, not elevated.
    ClearErrors
    Exec '"$OrbElectronDir\Orb.exe"'
    StrCpy $9 0
    ${IfThen} ${Errors} ${|} StrCpy $9 1 ${|}
    !ifdef ORB_HOOK_LOG
      FileOpen $8 "${ORB_HOOK_LOG}" a
      FileWrite $8 "reabierta=$9$\r$\n"
      FileClose $8
    !endif
  ${EndIf}
  SetOutPath "$TEMP" ; the working folder cannot be removed
  RMDir "$INSTDIR"
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

; $R0 = the workspace: "home" in ubicacion.json in Orb's data folder, else C:\Orb. The engine writes that file with
; writeJson (src/core/home.mjs: indented, several lines, UTF-8, also in 3.8.0), so the whole file is read byte by byte and
; decoded from UTF-8 (a path with ñ or accents must match), and the JSON string is read with its escapes (review D10 A1).
Function OrbWorkspace
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  StrCpy $R0 ""
  StrCpy $2 "" ; the text
  ClearErrors
  FileOpen $0 "${ORB_DATA_DIR}\ubicacion.json" r
  ${IfNot} ${Errors}
    ${Do}
      ClearErrors
      FileReadByte $0 $1
      ${If} ${Errors}
        ${ExitDo}
      ${EndIf}
      StrCpy $3 ""
      ${If} $1 < 0x80
        ${If} $1 >= 0x20
          IntFmt $3 "%c" $1
        ${EndIf} ; line breaks and tabs are only layout
      ${ElseIf} $1 >= 0xF0
        IntOp $4 $1 & 0x07
        FileReadByte $0 $5
        IntOp $5 $5 & 0x3F
        IntOp $4 $4 << 6
        IntOp $4 $4 | $5
        FileReadByte $0 $5
        IntOp $5 $5 & 0x3F
        IntOp $4 $4 << 6
        IntOp $4 $4 | $5
        FileReadByte $0 $5
        IntOp $5 $5 & 0x3F
        IntOp $4 $4 << 6
        IntOp $4 $4 | $5
        ; outside the BMP: a UTF-16 surrogate pair
        IntOp $4 $4 - 0x10000
        IntOp $5 $4 >> 10
        IntOp $5 $5 + 0xD800
        IntOp $4 $4 & 0x3FF
        IntOp $4 $4 + 0xDC00
        IntFmt $3 "%c" $5
        IntFmt $5 "%c" $4
        StrCpy $3 "$3$5"
      ${ElseIf} $1 >= 0xE0
        IntOp $4 $1 & 0x0F
        FileReadByte $0 $5
        IntOp $5 $5 & 0x3F
        IntOp $4 $4 << 6
        IntOp $4 $4 | $5
        FileReadByte $0 $5
        IntOp $5 $5 & 0x3F
        IntOp $4 $4 << 6
        IntOp $4 $4 | $5
        ${If} $4 != 0xFEFF ; a byte-order mark
          IntFmt $3 "%c" $4
        ${EndIf}
      ${ElseIf} $1 >= 0xC0
        IntOp $4 $1 & 0x1F
        FileReadByte $0 $5
        IntOp $5 $5 & 0x3F
        IntOp $4 $4 << 6
        IntOp $4 $4 | $5
        IntFmt $3 "%c" $4
      ${EndIf} ; a stray continuation byte is skipped
      StrCpy $2 "$2$3"
      StrLen $4 $2
      ${If} $4 > 900
        ${ExitDo} ; far longer than any real ubicacion.json
      ${EndIf}
    ${Loop}
    FileClose $0
    ; "home", then spaces and the colon, then the string up to its closing quote.
    ClearErrors
    ${WordFind} $2 '"home"' "E+1}" $3
    ${IfNot} ${Errors}
      ${Do}
        StrCpy $4 $3 1
        ${If} $4 == " "
        ${OrIf} $4 == ":"
          StrCpy $3 $3 "" 1
        ${Else}
          ${ExitDo}
        ${EndIf}
      ${Loop}
      ${If} $4 == '"'
        StrCpy $3 $3 "" 1
        StrCpy $5 ""
        ${Do}
          StrCpy $4 $3 1
          StrCpy $3 $3 "" 1
          ${If} $4 == ""
            StrCpy $5 "" ; unterminated: not trusted
            ${ExitDo}
          ${ElseIf} $4 == '"'
            ${ExitDo}
          ${ElseIf} $4 == "\"
            StrCpy $4 $3 1 ; \\ \/ \" (Windows paths never hold the other escapes)
            StrCpy $3 $3 "" 1
          ${EndIf}
          StrCpy $5 "$5$4"
        ${Loop}
        StrCpy $R0 $5
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $R0 == ""
    StrCpy $R0 "C:\Orb"
  ${EndIf}
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; $R0 = 1 when $OrbElectronDir holds only what electron-builder puts in Orb 3.8.0's folder (review D10 A1: a defence that
; does not depend on reading ubicacion.json). Anything else there (a project, notes, a workspace) would go with it.
Function OrbOnlyAppFiles
  Push $0
  Push $1
  Push $2
  StrCpy $R0 1
  ClearErrors
  FindFirst $0 $1 "$OrbElectronDir\*"
  ${DoUntil} ${Errors}
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      StrCpy $2 $1 "" -4
      ${If} $1 == "locales"
      ${OrIf} $1 == "resources"
      ${OrIf} $1 == "swiftshader"
      ${OrIf} $1 == "Orb.exe"
      ${OrIf} $1 == "Uninstall Orb.exe"
      ${OrIf} $1 == "LICENSE.electron.txt"
      ${OrIf} $1 == "LICENSES.chromium.html"
      ${OrIf} $1 == "debug.log"
      ${OrIf} $2 == ".dll"
      ${OrIf} $2 == ".pak"
      ${OrIf} $2 == ".bin"
      ${OrIf} $2 == ".dat"
        ; Electron's own
      ${Else}
        StrCpy $2 $1 "" -5
        ${If} $2 != ".json" ; Chromium's (vk_swiftshader_icd.json); Orb's own JSON files are refused before this
          StrCpy $R0 0
          DetailPrint "No es de Orb 3.8.0: $OrbElectronDir\$1"
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ClearErrors
    FindNext $0 $1
  ${Loop}
  FindClose $0
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; $R0 = 1 when $OrbElectronDir is a folder 3.8.0's uninstaller may remove whole (its RMDir /r): electron-builder's
; default, or a folder ending in \Orb that holds Orb 3.8.0 (Orb.exe and resources\app.asar) and nothing else; and in no
; case one holding Orb's data (a workspace's core\ or orb.json, the data folder's ubicacion.json, interfaz.json or
; claves\), the workspace, a folder holding it or inside it, nor Orb's data folder (or one holding it).
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
      Call OrbOnlyAppFiles
      StrCpy $R5 $R0
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$OrbElectronDir\core\*.*"
  ${OrIf} ${FileExists} "$OrbElectronDir\orb.json"
  ${OrIf} ${FileExists} "$OrbElectronDir\ubicacion.json"
  ${OrIf} ${FileExists} "$OrbElectronDir\interfaz.json"
  ${OrIf} ${FileExists} "$OrbElectronDir\claves\*.*"
    DetailPrint "Datos de Orb en $OrbElectronDir"
    StrCpy $R5 0
  ${EndIf}
  ${If} $R5 == 1
    Call OrbWorkspace
    StrCpy $R2 $R0
    DetailPrint "Espacio de trabajo: $R2"
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

; $R0 = which Orb.exe of this user are running after waiting up to 15 s for the ones in $OrbElectronDir (Orb 3.8.0, its
; engine and its MCP helpers closing after «Reiniciar e instalar»): "libre" (none), "suyo" (still only Orb 3.8.0's),
; "otro|<path>" (an Orb.exe from another folder: Orb on Tauri, a copy, another install) or "" when it cannot be told.
; By path (review D10 M1): before, any Orb.exe made the bridge fail. Another user's processes have no readable path and
; are left out, as nsis_tauri_utils::FindProcessCurrentUser did.
Function OrbRunning
  Push $0
  System::Call 'kernel32::SetEnvironmentVariable(t "ORB_E_DIR", t "$OrbElectronDir")'
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = $$env:ORB_E_DIR.TrimEnd([char]92) + [char]92; for ($$i = 0; $$i -lt 30; $$i++) { $$p = @(Get-Process -Name Orb -ErrorAction SilentlyContinue | Where-Object { $$_.Path }); $$o = @($$p | Where-Object { -not $$_.Path.StartsWith($$d, [StringComparison]::OrdinalIgnoreCase) }); if ($$o.Count) { [Console]::Out.Write('otro|' + $$o[0].Path); exit 0 }; if (-not $$p.Count) { [Console]::Out.Write('libre'); exit 0 }; Start-Sleep -Milliseconds 500 }; [Console]::Out.Write('suyo')"`
  Pop $0 ; exit code
  Pop $R0
  ${If} $0 != 0
    StrCpy $R0 ""
  ${EndIf}
  StrCpy $0 $R0 5
  ${If} $R0 != "libre"
  ${AndIf} $R0 != "suyo"
  ${AndIf} $0 != "otro|"
    StrCpy $R0 ""
  ${EndIf}
  Pop $0
FunctionEnd

Function OrbRemoveElectron
  Push $0
  Push $1
  Push $R0
  ; Where it is: its uninstall entry (the user may have chosen another folder), else electron-builder's default.
  ReadRegStr $OrbElectronDir HKCU "${ORB_ELECTRON_UNINSTKEY}" "InstallLocation"
  ReadRegStr $OrbElectronVersion HKCU "${ORB_ELECTRON_UNINSTKEY}" "DisplayVersion"
  ; B6: only plain values in the marks (a version with quotes would break the JSON).
  ${WordReplace} $OrbElectronVersion '"' "" "+" $OrbElectronVersion
  ${WordReplace} $OrbElectronVersion "\" "" "+" $OrbElectronVersion
  ${If} $OrbElectronDir == ""
    StrCpy $OrbElectronDir "${ORB_ELECTRON_DEFAULT_DIR}"
  ${EndIf}
  StrCpy $OrbUpdated 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--updated" $1
  ${IfNot} ${Errors}
    StrCpy $OrbUpdated 1
  ${EndIf}
  ${IfNot} ${FileExists} "$OrbElectronDir\Uninstall Orb.exe"
  ${OrIf} $OrbElectronDir == $INSTDIR
    Goto done
  ${EndIf}
  DetailPrint "Orb $OrbElectronVersion (Electron): $OrbElectronDir"
  ; D9 B5: 3.8.0's uninstaller is a file of this user's folder (anything the user runs may have changed it): an installer
  ; running as administrator never runs it elevated. It says so and stops; opened normally, it goes on.
  !ifdef ORB_HOOK_ACCOUNT
    StrCpy $R0 "${ORB_HOOK_ACCOUNT}" ; the tests' stand-in (a test shell may itself run elevated)
  !else
    UserInfo::GetAccountType
    Pop $R0
  !endif
  ${If} $R0 == "Admin"
    !insertmacro OrbRefuse "Este instalador se ha abierto como administrador y no puede quitar Orb $OrbElectronVersion así. Ábrelo de nuevo con doble clic, sin «Ejecutar como administrador».$\r$\n$\r$\nThis installer was opened as administrator and cannot remove Orb $OrbElectronVersion that way. Open it again with a double click, without «Run as administrator»." "elevado"
  ${EndIf}
  ; M4: its uninstaller deletes its whole folder: only one that is surely Orb 3.8.0's.
  Call OrbSafeToRemove
  ${If} $R0 != 1
    !insertmacro OrbRefuse "Orb $OrbElectronVersion está instalado en $OrbElectronDir, junto a otros archivos o tus datos. El instalador no lo quita solo de esa carpeta: desinstálalo desde Configuración > Aplicaciones (tus datos se quedan) y vuelve a abrir este instalador.$\r$\n$\r$\nOrb $OrbElectronVersion is installed in $OrbElectronDir, next to other files or your data. The installer will not remove it from that folder by itself: uninstall it from Settings > Apps (your data stays) and open this installer again." "carpeta"
  ${EndIf}
  ; M5: no Orb.exe of this user from another folder may be running when 3.8.0's uninstaller runs (if PowerShell fails it
  ; falls back to `taskkill /IM Orb.exe`, which would also end Orb on Tauri: the same name). Orb 3.8.0 closing after
  ; «Reiniciar e instalar» is waited for; whatever of its own is still running then, its uninstaller ends (only Orb.exe
  ; of its folder are left, so its taskkill ends nothing else). Run by hand with Orb 3.8.0 open, the user closes it.
  ${Do}
    Call OrbRunning
    StrCpy $1 $R0 5
    ${If} $R0 == "libre"
      ${ExitDo}
    ${ElseIf} $1 == "otro|"
      StrCpy $1 $R0 "" 5
      !insertmacro OrbRefuse "Hay otro Orb abierto ($1). Ciérralo y vuelve a abrir este instalador.$\r$\n$\r$\nAnother Orb is open ($1). Close it and open this installer again." "otro"
    ${ElseIf} $R0 == "suyo"
      ${If} $OrbUpdated == 1
        ${ExitDo}
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Orb $OrbElectronVersion sigue abierto. Ciérralo y pulsa Reintentar.$\r$\n$\r$\nOrb $OrbElectronVersion is still open. Close it and press Retry." /SD IDCANCEL IDRETRY orb_retry
      !insertmacro OrbRefuse "Orb sigue abierto. Ciérralo y vuelve a abrir este instalador.$\r$\n$\r$\nOrb is still open. Close it and open this installer again." "abierto"
      orb_retry:
    ${Else}
      ; PowerShell could not tell: as before, any Orb.exe of this user for 15 s stops the bridge.
      StrCpy $1 0
      ${Do}
        ; tasklist, not nsis_tauri_utils::FindProcessCurrentUser: no Tauri plugin in these Functions (see OrbRefuse).
        ReadEnvStr $0 USERNAME
        nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq Orb.exe" /FI "USERNAME eq $0" /NH /FO CSV'
        Pop $0 ; exit code
        Pop $0 ; a CSV line per process, or an INFO line when there is none
        StrCpy $0 $0 9
        ${If} $0 != '"Orb.exe"'
          ${ExitDo}
        ${EndIf}
        ${If} $1 >= 30
          !insertmacro OrbRefuse "Orb sigue abierto. Ciérralo y vuelve a abrir este instalador.$\r$\n$\r$\nOrb is still open. Close it and open this installer again." "abierto"
        ${EndIf}
        Sleep 500
        IntOp $1 $1 + 1
      ${Loop}
      ${ExitDo}
    ${EndIf}
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
    !insertmacro OrbRefuse "No se pudo desinstalar Orb $OrbElectronVersion ($0). Cierra Orb, desinstálalo desde Configuración > Aplicaciones (tus datos se quedan) y vuelve a abrir este instalador.$\r$\n$\r$\nOrb $OrbElectronVersion could not be uninstalled ($0). Close Orb, uninstall it from Settings > Apps (your data stays) and open this installer again." "desinstalador"
  ${EndIf}
  ; Run in place it cannot delete itself; its folder goes only if nothing else is left in it.
  Delete "$OrbElectronDir\Uninstall Orb.exe"
  RMDir "$OrbElectronDir"
  CreateDirectory "${ORB_DATA_DIR}"
  Delete "${ORB_DATA_DIR}\puente-fallido.json"
  ClearErrors
  FileOpen $1 "${ORB_DATA_DIR}\migrado-desde-electron.json" w
  ${IfNot} ${Errors}
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
