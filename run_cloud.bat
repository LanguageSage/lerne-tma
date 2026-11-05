@echo off
setlocal
title Lerne - Cloud database
cd /d "%~dp0"
if not exist "venv\Scripts\python.exe" (
  echo ERROR: Python environment venv is missing.
  pause
  exit /b 1
)
"venv\Scripts\python.exe" scripts\cloud_dev.py
set "launch_exit=%errorlevel%"
if not "%launch_exit%"=="0" pause
exit /b %launch_exit%
