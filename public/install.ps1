# Windows Agent 1-Click Installer via PowerShell
# Run as Administrator from a downloaded file. Avoid piping remote text to IEX,
# which Windows Defender/AMSI commonly blocks as suspicious behavior.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 1. Kiem tra quyen Administrator, neu chua co thi tu dong popup xin quyen
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Dang yeu cau quyen Administrator de cai dat..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$agentDir  = "C:\WindowsAgent"
$agentFile = "$agentDir\agent.ps1"
$agentUrl  = "http://192.168.1.246:3000/agent.ps1"
$taskName  = "WindowsAgentHeartbeat"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "         HE THONG CAI DAT WINDOWS AGENT TU DONG (1-CLICK)       " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# 2. Tao thu muc
if (-not (Test-Path $agentDir)) {
    New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
}

# 3. Tai ban agent moi nhat vao file tam, kiem tra cu phap, roi moi thay the ban cu
Write-Host "[1/3] Dang tai file agent.ps1 moi nhat tu Server..." -ForegroundColor Yellow
$tempAgentFile = Join-Path $agentDir "agent.ps1.download"
$cacheBustUrl = "{0}?v={1}" -f $agentUrl, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
try {
    # Dùng Invoke-WebRequest để tránh PowerShell hiểu sai dấu `?` trong URL thành đường dẫn cục bộ.
    Invoke-WebRequest -Uri $cacheBustUrl -OutFile $tempAgentFile -UseBasicParsing
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($tempAgentFile, [ref]$null, [ref]$parseErrors) | Out-Null
    if ($parseErrors -and $parseErrors.Count -gt 0) {
        throw ("Agent moi co loi cu phap: " + ($parseErrors | Select-Object -First 1 | ForEach-Object Message))
    }
    Move-Item -Path $tempAgentFile -Destination $agentFile -Force
    Write-Host "      Da cap nhat: $agentFile" -ForegroundColor Green
} finally {
    if (Test-Path $tempAgentFile) { Remove-Item $tempAgentFile -Force -ErrorAction SilentlyContinue }
}

# 4. Dang ky Scheduled Task
Write-Host "[2/3] Dang dang ky Scheduled Task chay luc 09:00 va 14:00..." -ForegroundColor Yellow
schtasks /create /tn $taskName /tr "PowerShell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentFile`" -Monitor" /sc daily /st 09:00 /ru "SYSTEM" /rl HIGHEST /f | Out-Null
schtasks /change /tn $taskName /ri 300 /du 24:00 | Out-Null
Write-Host "      Scheduled Task '$taskName' da tao thanh cong!" -ForegroundColor Green

# 5. Chay khoi tao lan dau
Write-Host "[3/3] Dang gui Heartbeat khoi tao len Dashboard..." -ForegroundColor Yellow
try {
    & $agentFile
} catch {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $agentFile
}

Write-Host "================================================================" -ForegroundColor Green
Write-Host "   CHUC MUNG! CAI DAT HOAN TAT THANH CONG 100%!" -ForegroundColor Green
Write-Host "   May tinh da ket noi vao Dashboard http://192.168.1.246:3000" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Start-Sleep -Seconds 3
