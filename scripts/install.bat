@echo off
setlocal EnableExtensions
title QuickKit installer

set "ROOT=%~dp0.."
set "DEST=%APPDATA%\Adobe\CEP\extensions\QuickKit"
set "FAILED=0"
set "MISSING=0"

echo.
echo  QuickKit installer
echo  ------------------
echo  Source:     %ROOT%
echo  Install to: %DEST%
echo.

if not exist "%ROOT%\extension\CSXS\manifest.xml" goto :no_source
if not exist "%ROOT%\extension\index.html" goto :no_source
if not exist "%ROOT%\host\quickkit.jsx" goto :no_source
if not exist "%ROOT%\design\tokens.css" goto :no_source

echo  [1/4] Turning on PlayerDebugMode for unsigned development panels...
call :set_debug 9
call :set_debug 10
call :set_debug 11
call :set_debug 12
reg query "HKCU\Software\Adobe\CSXS.13" >nul 2>&1
if not errorlevel 1 call :set_debug 13

echo.
echo  [2/4] Removing the previous copy (if any)...
if exist "%DEST%" rmdir /s /q "%DEST%" >nul 2>&1
if exist "%DEST%" (
  ping -n 3 127.0.0.1 >nul
  rmdir /s /q "%DEST%" >nul 2>&1
)
if exist "%DEST%" (
  echo   [WARN] The old folder itself is locked by another process.
  echo          Clearing its contents and overwriting in place instead.
  del /f /q "%DEST%\*" >nul 2>&1
  for /d %%D in ("%DEST%\*") do rmdir /s /q "%%D" >nul 2>&1
)

echo  [3/4] Copying the panel, design tokens and host script...
mkdir "%DEST%" 2>nul
xcopy "%ROOT%\extension\*" "%DEST%\" /E /I /Y /Q >nul
mkdir "%DEST%\design\fonts" 2>nul
mkdir "%DEST%\design\icons" 2>nul
xcopy "%ROOT%\design\tokens.css" "%DEST%\design\" /I /Y /Q >nul
xcopy "%ROOT%\design\fonts\*.woff2" "%DEST%\design\fonts\" /I /Y /Q >nul
xcopy "%ROOT%\design\fonts\OFL.txt" "%DEST%\design\fonts\" /I /Y /Q >nul
xcopy "%ROOT%\design\icons\*.js" "%DEST%\design\icons\" /I /Y /Q >nul
xcopy "%ROOT%\host\*.jsx" "%DEST%\host\" /I /Y /Q >nul
if exist "%ROOT%\bin\ffmpeg\ffmpeg.exe" (
  mkdir "%DEST%\bin\ffmpeg" 2>nul
  copy /y "%ROOT%\bin\ffmpeg\ffmpeg.exe" "%DEST%\bin\ffmpeg\" >nul
  if exist "%ROOT%\bin\ffmpeg\ffprobe.exe" copy /y "%ROOT%\bin\ffmpeg\ffprobe.exe" "%DEST%\bin\ffmpeg\" >nul
  copy /y "%ROOT%\bin\ffmpeg\NOTICE.txt" "%DEST%\bin\ffmpeg\" >nul
  if exist "%ROOT%\bin\ffmpeg\VERSION.txt" copy /y "%ROOT%\bin\ffmpeg\VERSION.txt" "%DEST%\bin\ffmpeg\" >nul
  echo   [OK]   Bundled ffmpeg copied - the Silence tab will use it.
) else (
  echo   [i]    No bin\ffmpeg\ffmpeg.exe to bundle. The Silence tab will look
  echo          for ffmpeg on PATH instead. See bin\ffmpeg\README.txt.
)

echo  [4/4] Checking the installed files...
if not exist "%DEST%\CSXS\manifest.xml" set "MISSING=1"
if not exist "%DEST%\index.html" set "MISSING=1"
if not exist "%DEST%\css\panel.css" set "MISSING=1"
if not exist "%DEST%\design\tokens.css" set "MISSING=1"
if not exist "%DEST%\design\fonts\inter-latin-400-normal.woff2" set "MISSING=1"
if not exist "%DEST%\design\icons\icons.js" set "MISSING=1"
if not exist "%DEST%\host\quickkit.jsx" set "MISSING=1"
if not exist "%DEST%\js\ffmpeg-node.js" set "MISSING=1"
fc /b "%ROOT%\host\quickkit.jsx" "%DEST%\host\quickkit.jsx" >nul 2>&1
if errorlevel 1 set "MISSING=1"
fc /b "%ROOT%\extension\js\panel.js" "%DEST%\js\panel.js" >nul 2>&1
if errorlevel 1 set "MISSING=1"
fc /b "%ROOT%\extension\index.html" "%DEST%\index.html" >nul 2>&1
if errorlevel 1 set "MISSING=1"
if "%MISSING%"=="1" goto :copy_failed

echo.
echo  Installed Adobe apps found in Program Files:
for /d %%D in ("%ProgramFiles%\Adobe\Adobe After Effects*") do echo   - %%~nxD
for /d %%D in ("%ProgramFiles%\Adobe\Adobe Premiere Pro*") do echo   - %%~nxD

echo.
if "%FAILED%"=="1" (
  echo  WARNING - PlayerDebugMode could not be set for every CSXS version.
  echo            Unsigned QuickKit panels may not load. Check:
  echo            HKCU\Software\Adobe\CSXS.12  value PlayerDebugMode = 1
  echo.
)

echo  SUCCESS - QuickKit is installed.
echo.
echo  Next steps:
echo    1. Close After Effects and Premiere Pro completely.
echo    2. Open the app again.
echo    3. Window ^> Extensions ^> QuickKit
echo.
echo  If the panel does not appear, run install.bat again and read
echo  README.md, section "Troubleshooting".
echo  CEP logs: %TEMP%\CEP12-AEFT.log and %TEMP%\CEP12-PPRO.log
echo.
if /i not "%~1"=="/quiet" pause
exit /b 0

:set_debug
reg add "HKCU\Software\Adobe\CSXS.%~1" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
if errorlevel 1 (
  echo   [WARN] Could not set PlayerDebugMode on CSXS.%~1
  set "FAILED=1"
) else (
  echo   [OK]   PlayerDebugMode=1 on CSXS.%~1
)
goto :eof

:no_source
echo  FAILED - the QuickKit source folders are incomplete.
echo  Expected these next to this script's parent folder:
echo    extension\CSXS\manifest.xml
echo    extension\index.html
echo    design\tokens.css
echo    host\quickkit.jsx
echo  Run install.bat from the QuickKit\scripts folder.
if /i not "%~1"=="/quiet" pause
exit /b 1

:copy_failed
echo  FAILED - the files did not copy correctly.
echo  Close After Effects and Premiere Pro, then run install.bat again.
echo  If it keeps failing, delete this folder by hand and retry:
echo    %DEST%
if /i not "%~1"=="/quiet" pause
exit /b 1

:failed
if /i not "%~1"=="/quiet" pause
exit /b 1
