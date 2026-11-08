; A stand-in for Orb 3.8.0's uninstaller (electron-builder's), for test/puente-electron.e2e.mjs. The real one cannot run
; in a test: its shortcuts and its uninstall entry have fixed names, so it would remove the real ones. This one does
; what that one does to an install, on the test's fake install only (given when it is built), and writes down how it
; was called.
Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
Name "Uninstall Orb (prueba)"
OutFile "${OUT}"
RequestExecutionLevel user
SilentInstall silent

Section
  ${GetParameters} $0
  FileOpen $1 "${LOG}" w
  FileWrite $1 "$0"
  FileClose $1
  ; EXIT (test/puente-ganchos.e2e.mjs): fails as the real one does when Orb 3.8.0 cannot be closed: nothing removed.
  !ifdef EXIT
    SetErrorLevel ${EXIT}
    Quit
  !endif
  ; Its shortcuts, its uninstall entry and its folder (run in place with _?=, it cannot delete itself).
  Delete "${DESKTOP_LINK}"
  Delete "${START_LINK}"
  DeleteRegKey HKCU "${UNINSTKEY}"
  RMDir /r "$EXEDIR"
SectionEnd
