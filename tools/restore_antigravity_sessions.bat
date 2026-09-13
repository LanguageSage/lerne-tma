@echo off
chcp 65001 > nul
title Восстановление сессий Antigravity
color 0A

echo ========================================================
echo   Восстановление всех сессий Antigravity (351 сессия)
echo ========================================================
echo.

echo [1/4] Принудительное завершение процессов Antigravity...
taskkill /F /T /IM Antigravity.exe >nul 2>&1
taskkill /F /T /IM language_server.exe >nul 2>&1

:wait_loop
tasklist /FI "IMAGENAME eq language_server.exe" 2>NUL | find /I /N "language_server.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo Ожидание полной остановки language_server.exe...
    timeout /t 1 /nobreak > nul
    goto wait_loop
)

tasklist /FI "IMAGENAME eq Antigravity.exe" 2>NUL | find /I /N "Antigravity.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo Ожидание полной остановки Antigravity.exe...
    timeout /t 1 /nobreak > nul
    goto wait_loop
)

echo [2/4] Все процессы Antigravity полностью остановлены.
timeout /t 1 /nobreak > nul

echo [3/4] Восстановление кэша сессий из базы данных...
if exist "%USERPROFILE%\.gemini\antigravity\all_summaries_restored.pb" (
    copy /Y "%USERPROFILE%\.gemini\antigravity\all_summaries_restored.pb" "%USERPROFILE%\.gemini\antigravity\agyhub_summaries_proto.pb" > nul
    echo Файл кэша успешно перезаписан полным архивом (351 сессия).
) else (
    echo Генерация файла кэша через Python...
    "%~dp0..\venv\Scripts\python.exe" "%~dp0restore_antigravity_sessions.py"
)

echo [4/4] Запуск Antigravity...
start "" "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"

echo.
echo ========================================================
echo   ГОТОВО! Antigravity запущен со всеми восстановленными сессиями.
echo ========================================================
echo.
pause
