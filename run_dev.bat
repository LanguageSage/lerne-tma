@echo off
title Lerne TMA Loader
echo Starting Lerne TMA...

:: 1. Check venv
if not exist venv (
    echo ERROR: venv folder not found in %CD%
    pause
    exit /b
)

:: 2. Start API
echo Launching API on port 8001 (LOCAL DB)...
:: Using a more robust path for python
set PYTHON_PATH=%CD%\venv\Scripts\python.exe
start "Lerne-API-Local" cmd /k "echo LOCAL API Window && set FORCE_LOCAL_DB=true && "%PYTHON_PATH%" -m uvicorn api.main:app --reload --port 8001"

:: 3. Start Frontend
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
