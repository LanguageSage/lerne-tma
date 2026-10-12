@echo off
title Lerne TMA Loader
echo Starting Lerne TMA...

:: 1. Check venv
if not exist venv (
    echo ERROR: venv folder not found in %CD%
    pause
    exit /b
)

:: 2. Free ports 8001 and 5173 if occupied
echo Checking and freeing ports 8001 and 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8001 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
ping -n 2 127.0.0.1 >nul

:: 3. Start API
echo Launching API on port 8001...
set PYTHON_PATH=%CD%\venv\Scripts\python.exe
start "Lerne-API" cmd /k "echo API Window && set FORCE_LOCAL_DB=true&& "%PYTHON_PATH%" -m uvicorn api.main:app --port 8001"

:: 4. Start Frontend
echo Launching Frontend...
cd app
if not exist node_modules (
    echo Installing node_modules...
    call npm install
)
start "Lerne-Frontend" cmd /k "echo Frontend Window && npm run dev"
cd ..

echo.
echo ==========================================
echo SUCCESS: Both servers are starting.
echo Check the new windows for errors.
echo ==========================================
pause
