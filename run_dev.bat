@echo off
CHCP 65001 > NUL
echo [1/2] Запуск бэкенда...
start cmd /k "echo Запуск API... && venv\Scripts\python -m uvicorn api.main:app --reload --port 8001"

echo [2/2] Запуск фронтенда...
cd app
if not exist node_modules (
    echo [!] Папка node_modules не найдена. Устанавливаю зависимости...
    call npm install
)
start cmd /k "echo Запуск Frontend... && npm run dev"

echo.
echo ==========================================
echo Приложение запускается в новых окнах!
echo API: http://localhost:8001/api/decks
echo WEB: Проверьте адрес в окне фронтенда
echo ==========================================
pause
