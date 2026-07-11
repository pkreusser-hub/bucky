@echo off
REM One-click Bucky mobile preview (phone Chrome + page picker).
REM Double-click this file — no typing needed.
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found on PATH. Install Node, then try again.
  pause
  exit /b 1
)
echo Starting Mobile Preview picker...
node tools\mobile-preview.mjs --picker
if errorlevel 1 (
  echo.
  echo Preview failed. See message above.
  pause
  exit /b 1
)
