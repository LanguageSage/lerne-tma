@echo off
title Lerne TMA [CLOUD MODE]
echo ==========================================
echo Starting Lerne TMA with CLOUD DATABASE
echo ==========================================

:: 1. Force Cloud Mode in this shell
set FORCE_LOCAL_DB=false

:: 2. Check venv
if not exist venv (
    echo ERROR: venv folder not found in %CD%
    pause
    exit /b
)

:: 3. Start API
echo Launching API on port 8001 (Cloud DB)...
set PYTHON_PATH=%CD%\venv\Scripts\python.exe

:: Мы передаем переменную через /V:ON для надежности в раскрытии переменных
start "Lerne-API-Cloud" cmd /v:on /k "echo CLOUD API Window && set FORCE_LOCAL_DB=false && echo Current Mode: FORCE_LOCAL_DB=!FORCE_LOCAL_DB! && "%PYTHON_PATH%" -m uvicorn api.main:app --port 8001"

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
