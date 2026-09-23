@echo off
setlocal
net session >nul 2>&1
if not %errorlevel%==0 (
  echo Requesting Administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Enabling Windows Subsystem for Linux...
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
if errorlevel 1 goto :failed

echo Enabling Virtual Machine Platform...
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
if errorlevel 1 goto :failed

echo.
echo Docker backend is installed. Restart Windows, open Docker Desktop,
echo then run Start SweetBloom.bat.
pause
exit /b 0

:failed
echo.
echo Setup failed. Check that virtualization is enabled in BIOS and Windows is up to date.
pause
exit /b 1
