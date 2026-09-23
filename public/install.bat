@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Cai Dat Windows Agent 1-Click
color 0B

echo ================================================================
echo          HE THONG CAI DAT WINDOWS AGENT TU DONG (1-CLICK)
echo ================================================================
echo.

:: 1. Kiem tra quyen Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [THONG BAO] Dang tu dong chuyen sang quyen Administrator...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "AGENT_DIR=C:\WindowsAgent"
set "AGENT_FILE=%AGENT_DIR%\agent.ps1"
set "TASK_NAME=WindowsAgentHeartbeat"

echo [1/3] Tao thu muc %AGENT_DIR%...
if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"

echo.
echo [2/3] Khoi tao file agent.ps1...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('http://192.168.1.246:3000/agent.ps1', '%AGENT_FILE%')"

if not exist "%AGENT_FILE%" (
    echo [!] Khong the tai tu Server, dang tao file agent truc tiep...
    powershell -Command "Invoke-WebRequest -Uri 'http://192.168.1.246:3000/agent.ps1' -OutFile '%AGENT_FILE%'"
)

echo.
echo [3/3] Dang ky Scheduled Task tu dong chay (09:00 va 14:00)...
schtasks /create /tn "%TASK_NAME%" /tr "PowerShell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%AGENT_FILE%\" -Monitor" /sc daily /st 09:00 /ru "SYSTEM" /rl HIGHEST /f >nul 2>&1
schtasks /change /tn "%TASK_NAME%" /ri 300 /du 24:00 >nul 2>&1

echo.
echo ================================================================
echo Dang chay kiem tra ket noi lan dau...
echo ================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%AGENT_FILE%"

echo.
echo ================================================================
echo   HOAN TAT CAI DAT! May tinh da ket noi vao Dashboard.
echo ================================================================
echo.
pause
exit /b 0
