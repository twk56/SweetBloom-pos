@echo off
setlocal
cd /d "%~dp0"
docker compose up --build -d
if errorlevel 1 (
  echo.
  echo Docker ยังไม่พร้อม กรุณารัน Setup Docker Backend.bat ในครั้งแรก
  echo จากนั้น restart Windows และเปิด Docker Desktop
  pause
  exit /b 1
)
timeout /t 3 /nobreak >nul
start "" "http://localhost:4173"
endlocal
