@echo off
setlocal
cd /d "%~dp0"
if not exist "venv\Scripts\python.exe" (
  echo ERROR: Python venv is missing.
  pause
  exit /b 1
)
"venv\Scripts\python.exe" local\v2_preview.py
if errorlevel 1 pause
