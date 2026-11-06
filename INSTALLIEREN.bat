@echo off
chcp 65001 >nul
title Dynamic Island - Installation
cd /d "%~dp0"
if not exist "%~dp0scripts\installieren.ps1" (
  echo.
  echo Bitte zuerst die ZIP-Datei ganz entpacken:
  echo Rechtsklick auf die ZIP-Datei, "Alle extrahieren", dann im neuen Ordner
  echo INSTALLIEREN.bat doppelklicken.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\installieren.ps1"
