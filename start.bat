@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "FRONTEND_DIR=%ROOT_DIR%frontend"
set "VENV_PYTHON=%ROOT_DIR%.venv\Scripts\python.exe"
set "BACKEND_REQUIREMENTS=%BACKEND_DIR%\requirements.txt"

if not exist "%BACKEND_DIR%\" (
    echo start.bat: backend directory not found: "%BACKEND_DIR%"
    exit /b 1
)
if not exist "%FRONTEND_DIR%\" (
    echo start.bat: frontend directory not found: "%FRONTEND_DIR%"
    exit /b 1
)

if exist "%VENV_PYTHON%" (
    set "PYTHON=%VENV_PYTHON%"
) else (
    where python >nul 2>&1
    if errorlevel 1 (
        echo start.bat: Python 3 was not found. Install Python 3 or create "%ROOT_DIR%.venv".
        exit /b 1
    )
    set "PYTHON=python"
)

where npm >nul 2>&1
if errorlevel 1 (
    echo start.bat: npm was not found. Install Node.js and npm.
    exit /b 1
)

if exist "%BACKEND_REQUIREMENTS%" if exist "%VENV_PYTHON%" (
    "%VENV_PYTHON%" -m pip install -r "%BACKEND_REQUIREMENTS%"
    if errorlevel 1 (
        echo start.bat: backend dependency installation failed.
        exit /b 1
    )
)

rem The API module is backend\app.py, imported from the repository root.
start "Parkinson's backend" cmd /k "cd /d ""%ROOT_DIR%"" && set ""FRONTEND_ORIGINS=http://localhost:3001,http://127.0.0.1:3001"" && ""%PYTHON%"" -m uvicorn backend.app:app --host 127.0.0.1 --port 8001 --reload --reload-dir backend --reload-dir scripts"
start "Parkinson's frontend" cmd /k "cd /d ""%FRONTEND_DIR%"" && set NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 && npm run dev -- --hostname 127.0.0.1 --port 3001"

echo Backend: http://127.0.0.1:8001
echo Frontend: http://localhost:3001  (use localhost so Google sign-in works)
