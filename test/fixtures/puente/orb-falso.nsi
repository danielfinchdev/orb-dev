; The «new Orb» of test/puente-electron.e2e.mjs: no window; writes down that it was opened and with what.
Unicode true
Name "Orb (prueba)"
OutFile "${OUT}"
RequestExecutionLevel user
; Version information: Windows Defender's machine-learning check has taken a bare test stub for malware.
VIProductVersion "3.8.1.0"
VIAddVersionKey "ProductName" "Orb test fixture"
VIAddVersionKey "CompanyName" "Orb"
VIAddVersionKey "FileDescription" "Orb bridge test fixture (test/puente-ganchos.e2e.mjs)"
VIAddVersionKey "FileVersion" "3.8.1.0"
VIAddVersionKey "LegalCopyright" "MIT"
SilentInstall silent

Section
  FileOpen $0 "${MARK}" w
  FileWrite $0 "$CMDLINE"
  FileClose $0
  ; SLEEP (test/puente-ganchos.e2e.mjs): an Orb.exe that stays running a while.
  !ifdef SLEEP
    Sleep ${SLEEP}
  !endif
SectionEnd
