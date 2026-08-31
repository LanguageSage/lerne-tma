@echo off
title Lerne TMA Admin Console
cls
echo ===================================================
echo   Lerne TMA - Local Admin Console
echo ===================================================
echo.
echo Starting FastAPI server at http://127.0.0.1:8050...
echo.

:: Strict Virtual Environment Check
if not exist "%~dp0venv\Scripts\python.exe" (
    echo [ERROR] Виртуальное окружение venv не найдено по пути: "%~dp0venv"
    echo Запуск проекта всегда должен выполняться из изолированного venv!
    echo Убедитесь, что папка venv существует и содержит установленные зависимости.
    echo.
    pause
    exit /b 1
)

set "PYTHON_EXE=%~dp0venv\Scripts\python.exe"

"%PYTHON_EXE%" tools/admin/server.py

pause
