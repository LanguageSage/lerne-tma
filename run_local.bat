@echo off
setlocal
title Lerne - Local database
cd /d "%~dp0"
if not exist "venv\Scripts\python.exe" (
  echo ERROR: Create venv and install requirements-test.txt first. See docs\LOCAL_DEVELOPMENT.md
  exit /b 1
)
"venv\Scripts\python.exe" scripts\local_dev.py start
set "launch_exit=%errorlevel%"
if not "%launch_exit%"=="0" pause
exit /b %launch_exit%
