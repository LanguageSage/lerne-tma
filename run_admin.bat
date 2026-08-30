@echo off
title Lerne TMA Admin Console
cls
echo ===================================================
echo   Lerne TMA - Local Admin Console
echo ===================================================
echo.
echo Starting FastAPI server at http://127.0.0.1:8050...
echo.

python tools/admin/server.py

pause
