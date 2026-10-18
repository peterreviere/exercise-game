@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 22.12+ from https://nodejs.org then run this again.
 pause
 exit /b 1
)
if not exist node_modules (
 call npm ci
 if errorlevel 1 (pause & exit /b 1)
)
call npm run dev -- --open
pause
