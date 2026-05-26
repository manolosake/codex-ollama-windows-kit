@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-setup\scripts\kali-operator.ps1" %*
