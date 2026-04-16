@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0run_tma.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [!] Critical Error: PowerShell script failed to start.
    pause
)
