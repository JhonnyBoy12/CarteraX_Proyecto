@echo off
cd /d "%~dp0"
echo Instalando PyInstaller...
python -m pip install pyinstaller
if errorlevel 1 goto error

echo.
echo Generando PhoenixPhoneTest.exe...
python -m PyInstaller --noconfirm --clean --onefile --windowed --name PhoenixPhoneTest phoenix_phone_test.py
if errorlevel 1 goto error

echo.
echo LISTO: %~dp0dist\PhoenixPhoneTest.exe
pause
exit /b 0

:error
echo.
echo Hubo un error al compilar el EXE.
pause
exit /b 1
