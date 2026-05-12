@echo off
title Lerne TMA - Clean Restart
echo ==========================================
echo [1/3] Очистка портов 8001 и 5173...
echo ==========================================

:: Убиваем процесс на порту 8001 (API)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8001 ^| findstr LISTENING') do (
    echo Нашел процесс %%a на порту 8001. Завершаю...
    taskkill /f /pid %%a
)

:: Убиваем процесс на порту 5173 (Vite)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    echo Нашел процесс %%a на порту 5173. Завершаю...
    taskkill /f /pid %%a
)

timeout /t 2 > nul

echo ==========================================
echo [2/3] Запуск API (Порт 8001)...
echo ==========================================
set PYTHON_PATH=%CD%\venv\Scripts\python.exe
start "Lerne-API" cmd /k "echo API Window && "%PYTHON_PATH%" -m uvicorn api.main:app --port 8001"

echo ==========================================
echo [3/3] Запуск Frontend (Порт 5173)...
echo ==========================================
cd app
start "Lerne-Frontend" cmd /k "npm run dev"
cd ..

echo.
echo ==========================================
echo ГОТОВО! Проверьте открывшиеся окна на ошибки.
echo ==========================================
pause
