@echo off
cd /d "%~dp0"
python phoenix_phone_test.py
if errorlevel 1 (
  echo.
  echo No se pudo ejecutar. Verifica que Python este instalado y agregado al PATH.
  pause
)
