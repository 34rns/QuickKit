@echo off
setlocal EnableExtensions
title QuickKit uninstaller

set "DEST=%APPDATA%\Adobe\CEP\extensions\QuickKit"

echo.
echo  QuickKit uninstaller
echo  --------------------
echo  Remove: %DEST%
echo.

if not exist "%DEST%" (
  echo  Nothing to do - QuickKit is not installed in that folder.
  echo  If it still shows up in the app, close the app and check:
  echo    %DEST%
  echo.
  if /i not "%~1"=="/quiet" pause
  exit /b 0
)

rmdir /s /q "%DEST%"
if exist "%DEST%" (
  ping -n 3 127.0.0.1 >nul
  rmdir /s /q "%DEST%"
)
if exist "%DEST%" (
  echo  FAILED - the folder could not be removed.
  echo  Something is still using it. Close After Effects and Premiere Pro, close
  echo  any Explorer window showing this folder, then run uninstall.bat again.
  echo  If it still fails, delete this folder by hand:
  echo    %DEST%
  echo.
  if /i not "%~1"=="/quiet" pause
  exit /b 1
)

echo  SUCCESS - the QuickKit panel was removed.
echo.
echo  Left in place on purpose: the PlayerDebugMode registry values under
echo    HKCU\Software\Adobe\CSXS.9  ...  CSXS.12
echo  Other unsigned development panels may rely on them. To remove them by
echo  hand (only if you know nothing else needs them):
echo    reg delete "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /f
echo.
echo  Restart After Effects or Premiere Pro to clear the panel from the menu.
echo.
if /i not "%~1"=="/quiet" pause
exit /b 0
