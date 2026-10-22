@echo off
setlocal
cd /d "%~dp0"
if not exist "venv\Scripts\python.exe" (
  echo ERROR: Create venv and install requirements-test.txt first. See docs\LOCAL_DEVELOPMENT.md
  exit /b 1
)
"venv\Scripts\python.exe" scripts\local_dev.py start
if errorlevel 1 pause
