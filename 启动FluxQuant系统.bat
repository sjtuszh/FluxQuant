@echo off
title FluxQuant Startup

cd /d "C:\Users\22320\Desktop\Projects\pyPrograms\FluxQuant"

call "C:\ProgramData\anaconda3\Scripts\activate.bat" ml

for %%P in (8502 8000) do (
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do (
        taskkill /PID %%A /F >nul 2>&1
    )
)

start "FluxQuant Backend" /min python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
start "FluxQuant Frontend" /min python -m http.server 8502 --bind 127.0.0.1 --directory frontend
start "" http://127.0.0.1:8502

exit /b 0
