@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Bridge pile ledger update
echo ============================================
node scripts\update-ledger.mjs
echo.
pause
