@echo off
chcp 65001 >nul
title Dynamic Island - Update veroeffentlichen
cd /d "%~dp0"
if not exist "%~dp0scripts\update-veroeffentlichen.ps1" (
  echo.
  echo Bitte zuerst die ZIP-Datei ganz entpacken und die Datei im entpackten Ordner starten.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-veroeffentlichen.ps1"
