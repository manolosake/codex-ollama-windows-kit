@echo off
title Codex App Ollama HauhauCS Launcher
cd /d "%~dp0"
echo Starting Codex App Ollama HauhauCS...
echo.
powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0codex-app-ollama-hauhaucs.ps1"
echo.
echo PowerShell finished or failed.
pause
