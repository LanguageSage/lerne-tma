@echo off
title Lerne TMA [CLOUD MODE]
echo ==========================================
echo Starting Lerne TMA with CLOUD DATABASE
echo ==========================================

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
echo Launching API on port 8001 (Cloud DB)...
set PYTHON_PATH=%CD%\venv\Scripts\python.exe

start "Lerne-API-Cloud" cmd /k "echo CLOUD API Window && "%PYTHON_PATH%" -m uvicorn api.main:app --port 8001"

:: 4. Start Frontend
echo Launching Frontend...
cd app
start "Lerne-Frontend" cmd /k "echo Frontend Window && npm run dev"
cd ..

echo.
echo Check the "Lerne-API-Cloud" window for:
echo "DATABASE: Connected to Cloud Postgres successfully"
echo.
pause
