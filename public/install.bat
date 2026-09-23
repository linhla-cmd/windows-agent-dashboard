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

:: 2. Xu ly tham so dau vao (Server URL)
set "SERVER_URL=%~1"
if "!SERVER_URL!"=="" (
    set "SERVER_URL=http://192.168.1.246:3000"
    echo [*] Khong tim thay tham so Server URL, su dung mac dinh: !SERVER_URL!
) else (
    echo [*] Dang su dung Server URL: !SERVER_URL!
)

set "AGENT_DIR=C:\WindowsAgent"
set "AGENT_FILE=!AGENT_DIR!\agent.ps1"
set "TASK_NAME=WindowsAgentHeartbeat"

echo.
echo [1/3] Tao thu muc !AGENT_DIR!...
if not exist "!AGENT_DIR!" mkdir "!AGENT_DIR!"

echo.
echo [2/3] Tai xuat file agent.ps1 tu !SERVER_URL!/agent.ps1...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('!SERVER_URL!/agent.ps1', '!AGENT_FILE!')"

if not exist "!AGENT_FILE!" (
    echo [!] Khong the tai tu Server bang WebClient, thi dung Invoke-WebRequest...
    powershell -Command "Invoke-WebRequest -Uri '!SERVER_URL!/agent.ps1' -OutFile '!AGENT_FILE!'"
)

if not exist "!AGENT_FILE!" (
    echo [ERROR] Khong the tai agent.ps1 tu Server. Kiem tra ket noi mang va Server URL.
    echo Server URL da su dung: !SERVER_URL!
    pause
    exit /b 1
)

echo.
echo [3/3] Dang ky Scheduled Task tu dong chay (moi 5 phut)...
schtasks /create /tn "!TASK_NAME!" /tr "PowerShell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"!AGENT_FILE!\" -ServerUrl !SERVER_URL!" /sc onstart /ru "SYSTEM" /rl HIGHEST /f >nul 2>&1

if !ERRORLEVEL! EQU 0 (
    echo [OK] Scheduled Task da duoc tao thanh cong.
) else (
    echo [!] Co the Task da ton tai hoac co loi. Dang cap nhat...
    schtasks /change /tn "!TASK_NAME!" /tr "PowerShell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"!AGENT_FILE!\" -ServerUrl !SERVER_URL!" /f >nul 2>&1
)

echo.
echo ================================================================
echo Dang chay kiem tra ket noi lan dau voi Server: !SERVER_URL!...
echo ================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "!AGENT_FILE!" -ServerUrl !SERVER_URL!

echo.
echo ================================================================
echo   HOAN TAT CAI DAT! May tinh da ket noi vao Dashboard.
echo   Server: !SERVER_URL!
echo ================================================================
echo.
pause
exit /b 0
