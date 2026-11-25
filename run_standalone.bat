@echo off
setlocal
cd /d "%~dp0"

set "NO_BROWSER=0"
if /I "%~1"=="--no-browser" set "NO_BROWSER=1"

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not found in PATH.
  if "%NO_BROWSER%"=="0" pause
  exit /b 1
)

if not exist "app\node_modules\vite\bin\vite.js" (
  echo ERROR: app\node_modules is missing. Run "npm --prefix app install" first.
  if "%NO_BROWSER%"=="0" pause
  exit /b 1
)

set "LERNE_MODE="
set "VITE_LERNE_LOCAL="
set "LERNE_V2_PREVIEW="
set "VITE_DEV_API_TARGET="
set "LERNE_ISOLATED_CHECKS="
set "VITE_LERNE_STANDALONE=1"
for /f "delims=0123456789" %%A in ("%LERNE_STANDALONE_PORT%") do set "LERNE_STANDALONE_PORT="
if "%LERNE_STANDALONE_PORT%"=="" set "LERNE_STANDALONE_PORT=5175"
if %LERNE_STANDALONE_PORT% LSS 1 set "LERNE_STANDALONE_PORT=5175"
if %LERNE_STANDALONE_PORT% GTR 65535 set "LERNE_STANDALONE_PORT=5175"
set "STANDALONE_URL=http://127.0.0.1:%LERNE_STANDALONE_PORT%/"

netstat -an | findstr /R /C:"127\.0\.0\.1:%LERNE_STANDALONE_PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo Port %LERNE_STANDALONE_PORT% is already active on 127.0.0.1.
  echo If Lerne Standalone is already running, opening %STANDALONE_URL%...
  if "%NO_BROWSER%"=="0" start "" "%STANDALONE_URL%"
  exit /b 0
)

echo ==========================================
echo Lerne Offline Standalone (Windows Browser)
echo URL: %STANDALONE_URL%
echo IndexedDB: LerneStandaloneDB_900001
echo Keep this window open while studying. Press Ctrl+C to stop.
echo ==========================================

pushd app
if "%NO_BROWSER%"=="1" (
  node "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port %LERNE_STANDALONE_PORT% --strictPort
) else (
  node "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port %LERNE_STANDALONE_PORT% --strictPort --open "%STANDALONE_URL%"
)
set "EXIT_CODE=%ERRORLEVEL%"
popd

if not "%EXIT_CODE%"=="0" (
  echo ERROR: Lerne Standalone exited with code %EXIT_CODE%.
  if "%NO_BROWSER%"=="0" pause
  exit /b %EXIT_CODE%
)
exit /b 0
