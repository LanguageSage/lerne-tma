# Lerne TMA Launcher (PowerShell Version)
$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Lerne TMA: Auto-Setup and Launcher     " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

try {
    # 1. Check Python
    Write-Host "[*] Checking Python..."
    $pythonVersion = python --version 2>&1
    Write-Host "[+] $pythonVersion found."

    # 2. Setup Venv
    if (-not (Test-Path "venv")) {
        Write-Host "[ ] [1/4] Creating virtual environment..."
        python -m venv venv
        Write-Host "[+] Venv created."
    } else {
        Write-Host "[+] [1/4] Venv already exists."
    }

    # 3. Dependencies
    Write-Host "[ ] [2/4] Installing dependencies..."
    & "venv/Scripts/python.exe" -m pip install -r requirements.txt
    Write-Host "[+] Python libraries ready."

    # 4. Frontend
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        if (-not (Test-Path "app/node_modules")) {
            Write-Host "[ ] [3/4] Installing Node modules..."
            Set-Location app
            npm install
            Set-Location ..
            Write-Host "[+] Frontend modules installed."
        } else {
            Write-Host "[+] [3/4] Frontend modules ready."
        }
    } else {
        Write-Host "[!] WARNING: NPM not found. Frontend skipped." -ForegroundColor Yellow
    }

    # 5. Launch
    Write-Host "[ ] [4/4] Starting servers..."
    
    # Launch Backend
    Start-Process cmd.exe -ArgumentList "/c title TMA-API && venv\Scripts\python.exe api\main.py" -WindowStyle Normal
    
    # Launch Frontend
    if (Test-Path "app/package.json") {
        Start-Process cmd.exe -ArgumentList "/c title TMA-Frontend && cd app && npm run dev" -WindowStyle Normal
    }

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "   SUCCESS: Application is starting!      " -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "Backend:  http://localhost:8001"
    Write-Host "Frontend: http://localhost:5173"
    Write-Host ""
    Write-Host "Direct Browser Link (Standalone):" -ForegroundColor Yellow
    Write-Host "http://localhost:5173/?user_id=642478257" -ForegroundColor Cyan
    Write-Host ""
}
catch {
    Write-Host "[!] ERROR occurred: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "Press any key to exit..."
$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") | Out-Null
