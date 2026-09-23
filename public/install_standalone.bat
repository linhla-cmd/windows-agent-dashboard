@echo off
:: Windows Agent Standalone Installer
title Installing Windows Agent...
color 0A

:: 1. Kiem tra quyen Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ========================================================
    echo  LOI: Vui long click chuot phai va chon "Run as Administrator"
    echo ========================================================
    pause
    exit /b 1
)

echo [1/3] Dang khoi tao thu muc C:\WindowsAgent va file agent.ps1...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$dir='C:\WindowsAgent'; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; [System.IO.File]::WriteAllBytes('$dir\agent.ps1', [System.Convert]::FromBase64String('IyBXaW5kb3dzIEFnZW50IE1vbml0b3JpbmcgU2NyaXB0CiRXZWJob29rVXJsICAgPSAnaHR0cDovLzE5Mi4xNjguODYuMTMzOjMwMDAvaGVhcnRiZWF0JwokV2ViaG9va1Rva2VuID0gJzcxYzFiNmU4YWFiY2EzMjVjMTZhNjIzZTNlYjY5ZWU5NjdjZTg3NjRiNDM5NjZlNzU4NWQ1ZTBhYzUzZWIzNDEnCgokaG9zdG5hbWUgPSAkZW52OkNPTVBVVEVSTkFNRQp0cnkgeyAkZnFkbiA9IFtTeXN0ZW0uTmV0LkRuc106OkdldEhvc3RFbnRyeSgkZW52OkNPTVBVVEVSTkFNRSkuSG9zdE5hbWUgfSBjYXRjaCB7ICRmcWRuID0gJGhvc3RuYW1lIH0KJGRvbWFpbiA9ICRlbnY6VVNFUkRPTUFJTgoKJGN1cnJlbnRVc2VyID0gQHsKICAgIHVzZXJuYW1lID0gJGVudjpVU0VSTkFNRQogICAgZG9tYWluICAgPSAkZW52OlVTRVJET01BSU4KfQoKJGlwdjQgPSBAKCkKR2V0LU5ldElQQWRkcmVzcyAtQWRkcmVzc0ZhbWlseSBJUHY0IHwgV2hlcmUtT2JqZWN0IHsgJF8uSW50ZXJmYWNlQWxpYXMgLW5vdGxpa2UgJypMb29wYmFjayonIH0gfCBGb3JFYWNoLU9iamVjdCB7CiAgICAkZ3cgPSAoR2V0LU5ldFJvdXRlIC1JbnRlcmZhY2VBbGlhcyAkXy5JbnRlcmZhY2VBbGlhcyAtRXJyb3JBY3Rpb24gU2lsZW50bHlDb250aW51ZSB8IFdoZXJlLU9iamVjdCB7ICRfLkRlc3RpbmF0aW9uUHJlZml4IC1lcSAnMC4wLjAuMC8wJyB9KS5OZXh0SG9wIC1qb2luICcsJwogICAgJGlwdjQgKz0gQHsKICAgICAgICBpbnRlcmZhY2UgPSAkXy5JbnRlcmZhY2VBbGlhcwogICAgICAgIGlwICAgICAgICA9ICRfLklQQWRkcmVzcwogICAgICAgIHByZWZpeCAgICA9ICRfLlByZWZpeExlbmd0aAogICAgICAgIGdhdGV3YXkgICA9ICRndwogICAgICAgIGRoY3AgICAgICA9ICgkXy5BZGRyZXNzT3JpZ2luIC1lcSAnRGhjcCcpCiAgICB9Cn0KCiRkaXNrcyA9IEAoKQpHZXQtQ2ltSW5zdGFuY2UgV2luMzJfTG9naWNhbERpc2sgLUZpbHRlciAnRHJpdmVUeXBlPTMnIHwgRm9yRWFjaC1PYmplY3QgewogICAgJHNpemVHQiAgICAgID0gW21hdGhdOjpSb3VuZCgkXy5TaXplIC8gMUdCLCAyKQogICAgJGZyZWVHQiAgICAgID0gW21hdGhdOjpSb3VuZCgkXy5GcmVlU3BhY2UgLyAxR0IsIDIpCiAgICAkdXNlZFBlcmNlbnQgPSBpZiAoJF8uU2l6ZSAtZ3QgMCkgeyBbbWF0aF06OlJvdW5kKCgxIC0gKCRfLkZyZWVTcGFjZSAvICRfLlNpemUpKSAqIDEwMCwgMSkgfSBlbHNlIHsgMCB9CiAgICAkZGlza1R5cGUgICAgPSBpZiAoJF8uTWVkaWFUeXBlIC1tYXRjaCAncmVtb3ZhYmxlJykgeyAnUmVtb3ZhYmxlJyB9IGVsc2UgeyAnRml4ZWQnIH0KICAgICRkaXNrcyArPSBAewogICAgICAgIGRldmljZV9pZCAgICA9ICRfLkRldmljZUlECiAgICAgICAgZmlsZXN5c3RlbSAgID0gJF8uRmlsZVN5c3RlbQogICAgICAgIGRpc2tfdHlwZSAgICA9ICRkaXNrVHlwZQogICAgICAgIHNpemVfZ2IgICAgICA9ICRzaXplR0IKICAgICAgICBmcmVlX2diICAgICAgPSAkZnJlZUdCCiAgICAgICAgdXNlZF9wZXJjZW50ID0gJHVzZWRQZXJjZW50CiAgICB9Cn0KCnRyeSB7ICRkZWZlbmRlck9uID0gW2Jvb2xdKEdldC1NcENvbXB1dGVyU3RhdHVzIC1FcnJvckFjdGlvbiBTdG9wKS5BTVNlcnZpY2VFbmFibGVkIH0gY2F0Y2ggeyAkZGVmZW5kZXJPbiA9ICRudWxsIH0KdHJ5IHsKICAgICRmdyA9IEdldC1OZXRGaXJld2FsbFByb2ZpbGUgLUVycm9yQWN0aW9uIFN0b3AKICAgICRmaXJld2FsbE9uID0gKCgkZncgfCBXaGVyZS1PYmplY3QgeyAtbm90ICRfLkVuYWJsZWQgfSkuQ291bnQgLWVxIDApCn0gY2F0Y2ggeyAkZmlyZXdhbGxPbiA9ICRudWxsIH0KCiRzZWN1cml0eSA9IEB7CiAgICBkZWZlbmRlciA9ICRkZWZlbmRlck9uCiAgICBmaXJld2FsbCA9ICRmaXJld2FsbE9uCn0KCnRyeSB7CiAgICAkYWRtaW5NZW1iZXJzID0gKEdldC1Mb2NhbEdyb3VwTWVtYmVyIC1Hcm91cCAnQWRtaW5pc3RyYXRvcnMnIC1FcnJvckFjdGlvbiBTdG9wKS5OYW1lCiAgICAkYWRtaW5Db3VudCAgID0gKEdldC1Mb2NhbFVzZXIgLUVycm9yQWN0aW9uIFN0b3AgfCBXaGVyZS1PYmplY3QgeyAkYWRtaW5NZW1iZXJzIC1jb250YWlucyAkXy5OYW1lIH0pLkNvdW50Cn0gY2F0Y2ggeyAkYWRtaW5Db3VudCA9ICRudWxsIH0KCiRwYXlsb2FkID0gQHsKICAgIGRldmljZV9pZCAgICAgICAgPSAnd2luZG93cy1hZ2VudC0nICsgJGhvc3RuYW1lCiAgICB0aW1lc3RhbXAgICAgICAgID0gR2V0LURhdGUgLUZvcm1hdCAneXl5eS1NTS1kZFRISDptbTpzc3p6eicKICAgIGhvc3RuYW1lICAgICAgICAgPSAkaG9zdG5hbWUKICAgIGZxZG4gICAgICAgICAgICAgPSAkZnFkbgogICAgZG9tYWluICAgICAgICAgICA9ICRkb21haW4KICAgIGlzX2RvbWFpbl9qb2luZWQgPSAoJGVudjpVU0VSRE9NQUlOIC1uZSAkZW52OkNPTVBVVEVSTkFNRSkKICAgIGN1cnJlbnRfdXNlciAgICAgPSAkY3VycmVudFVzZXIKICAgIGlwdjQgICAgICAgICAgICAgPSAkaXB2NAogICAgcG93ZXIgICAgICAgICAgICA9IEB7CiAgICAgICAgc291cmNlICAgICAgICAgICA9ICdBQycKICAgICAgICBiYXR0ZXJ5X3BlcmNlbnQgID0gJG51bGwKICAgICAgICBsYXN0X2Jvb3RfZXZlbnQgID0gJzYwMDUnCiAgICB9CiAgICBzZWN1cml0eSAgICAgICAgID0gJHNlY3VyaXR5CiAgICBhZG1pbnMgICAgICAgICAgID0gQHsgbG9jYWxfYWRtaW5fY291bnQgPSAkYWRtaW5Db3VudCB9CiAgICBkaXNrcyAgICAgICAgICAgID0gJGRpc2tzCn0gfCBDb252ZXJ0VG8tSnNvbiAtRGVwdGggMTAKCnRyeSB7CiAgICAkaGVhZGVycyA9IEB7CiAgICAgICAgJ0F1dGhvcml6YXRpb24nID0gJ0JlYXJlciAnICsgJFdlYmhvb2tUb2tlbgogICAgICAgICdDb250ZW50LVR5cGUnICA9ICdhcHBsaWNhdGlvbi9qc29uJwogICAgfQogICAgSW52b2tlLVJlc3RNZXRob2QgLVVyaSAkV2ViaG9va1VybCAtTWV0aG9kIFBvc3QgLUJvZHkgJHBheWxvYWQgLUhlYWRlcnMgJGhlYWRlcnMgLUVycm9yQWN0aW9uIFN0b3AKfSBjYXRjaCB7fQo='))"

echo [2/3] Dang tao Scheduled Task "WindowsAgentHeartbeat" (Chay ngam moi 5 phut)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$taskName='WindowsAgentHeartbeat'; $filePath='C:\WindowsAgent\agent.ps1'; $action=New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'C:\WindowsAgent\agent.ps1'"'; $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 9999); $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; $principal=New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest; Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null"

echo [3/3] Dang chay gui Heartbeat dau tien...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\WindowsAgent\agent.ps1"

echo.
echo ========================================================
echo  HOAN TAT CAI DAT!
echo  - File: C:\WindowsAgent\agent.ps1
echo  - Scheduled Task: WindowsAgentHeartbeat (Chay ngam 5 phut)
echo  - Dashboard: http://192.168.1.246:3000/dashboard
echo ========================================================
echo.
pause
exit /b 0
