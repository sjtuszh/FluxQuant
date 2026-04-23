@echo off
title FluxQuant Shutdown

for %%P in (8501 8000) do (
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do (
        taskkill /PID %%A /F >nul 2>&1
    )
)

exit /b 0
