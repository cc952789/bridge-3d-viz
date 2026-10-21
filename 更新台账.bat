@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Bridge site data sync (photos + ledger)
echo ============================================
node scripts\sync-site.mjs
echo.
pause
