@echo off
setlocal
cd /d "%~dp0"
node server\local.mjs --desktop
pause
