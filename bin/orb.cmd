@echo off
rem Orb en la terminal: el cliente "orb" (src\terminal\orb-cli.mjs). Necesita Node 22 o mas nuevo.
setlocal
set "ORB_ROOT=%~dp0.."
set "ORB_NODE_EXE=node"
if exist "%ORB_ROOT%\node\node.exe" set "ORB_NODE_EXE=%ORB_ROOT%\node\node.exe"
"%ORB_NODE_EXE%" "%ORB_ROOT%\src\terminal\orb-cli.mjs" %*
exit /b %ERRORLEVEL%
