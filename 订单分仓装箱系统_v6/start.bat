@echo off

:: =========================================
:: Order Allocation System - Startup Script
:: =========================================

set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo.
echo  =========================================
echo   Order Allocation System
echo  =========================================
echo.

:: -- Check Python --
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.9+
    echo Download: https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo [OK] Python %PY_VER%

:: -- Check and install dependencies --
echo Checking dependencies...
set NEED_INSTALL=0

python -c "import flask" >nul 2>&1
if errorlevel 1 (
    set NEED_INSTALL=1
    echo [MISSING] flask
) else (
    echo [OK] flask
)

python -c "import openpyxl" >nul 2>&1
if errorlevel 1 (
    set NEED_INSTALL=1
    echo [MISSING] openpyxl
) else (
    echo [OK] openpyxl
)

if "%NEED_INSTALL%"=="1" (
    echo.
    echo Installing missing packages, please wait...
    python -m pip install flask openpyxl
    if errorlevel 1 (
        echo.
        echo [ERROR] Install failed. Run manually:
        echo   python -m pip install flask openpyxl
        pause
        exit /b 1
    )
    echo [OK] Packages installed
)

:: -- Check port --
set PORT=5050
netstat -ano 2>nul | findstr ":5050 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 5050 in use, using 5051
    set PORT=5051
)

echo.
echo  -----------------------------------------
echo   Browser:  http://localhost:%PORT%
echo   Archives: archives\
echo   Stop:     Ctrl+C or close this window
echo  -----------------------------------------
echo.

:: -- Start server (opens browser automatically via --open flag) --
python server.py --port %PORT% --open
pause
