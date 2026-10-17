@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  桥梁施工台账一键更新
echo ============================================
node scripts\update-ledger.mjs
echo.
pause
