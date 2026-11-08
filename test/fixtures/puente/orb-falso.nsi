; The «new Orb» of test/puente-electron.e2e.mjs: no window; writes down that it was opened and with what.
Unicode true
Name "Orb (prueba)"
OutFile "${OUT}"
RequestExecutionLevel user
SilentInstall silent

Section
  FileOpen $0 "${MARK}" w
  FileWrite $0 "$CMDLINE"
  FileClose $0
SectionEnd
