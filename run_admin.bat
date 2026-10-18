@echo off
chcp 65001 >nul
title Lerne TMA Admin Console
cls
echo ===================================================
echo   Lerne TMA - Local Admin Console
echo ===================================================
echo.

:: Free port 8050 if previously occupied by a stuck process
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8050 ^| findstr LISTENING') do (
    echo [INFO] Порт 8050 занят процессом %%a. Завершаю зависший процесс...
    taskkill /f /pid %%a >nul 2>&1
)

:: Strict Virtual Environment Check / Auto-creation
if not exist "%~dp0venv\Scripts\python.exe" (
    echo [WARN] Виртуальное окружение venv не найдено по пути:
    echo        "%~dp0venv"
    echo.
    echo Попытка автоматически создать venv и установить зависимости...
    where python >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python не найден в системе [PATH].
        echo Пожалуйста, установите Python 3.10+ и добавьте его в PATH.
        echo.
        pause
        exit /b 1
    )
    python -m venv "%~dp0venv"
    if not exist "%~dp0venv\Scripts\python.exe" (
        echo [ERROR] Не удалось создать виртуальное окружение.
        pause
        exit /b 1
    )
    echo Установка зависимостей из api\requirements.txt...
    "%~dp0venv\Scripts\python.exe" -m pip install --upgrade pip
    "%~dp0venv\Scripts\pip" install -r "%~dp0api\requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Ошибка при установке зависимостей.
        pause
        exit /b 1
    )
    echo [SUCCESS] Виртуальное окружение успешно создано и настроено!
    echo.
)

echo Starting FastAPI server at http://127.0.0.1:8050...
echo.

set "PYTHON_EXE=%~dp0venv\Scripts\python.exe"

"%PYTHON_EXE%" tools/admin/server.py

pause
