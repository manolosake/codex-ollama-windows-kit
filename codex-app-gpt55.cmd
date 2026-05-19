@echo off
title Codex GPT-5.5 Launcher
cd /d "%~dp0"
echo Restoring Codex GPT-5.5 config...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-codex-gpt55.ps1"
echo.
echo Opening Codex Desktop with GPT-5.5...
"%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe" app "%CD%"
pause
