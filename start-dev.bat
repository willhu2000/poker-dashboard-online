@echo off
setlocal
cd /d "%~dp0"
echo ===============================================
echo  Poker Dashboard - dev server bootstrap
echo ===============================================
echo.

if exist node_modules (
    echo Removing stale node_modules ^(this can take ~30s^) ...
    powershell -NoProfile -Command "Remove-Item -Recurse -Force '%CD%\node_modules'"
)
if exist package-lock.json (
    echo Removing stale package-lock.json ...
    del /f /q package-lock.json
)

echo Running npm install ...
call npm install
if errorlevel 1 (
    echo.
    echo npm install failed. Check the messages above.
    pause
    exit /b 1
)

echo.
echo Starting Vite dev server (Ctrl+C to stop) ...
echo Open http://localhost:5173/ in your browser.
call npm run dev
pause
