; NSIS Script for Windows Agent Installer v2.1
; Simplified and working version

!define PRODUCT_NAME "Windows Agent"
!define PRODUCT_VERSION "2.1.0"
!define PRODUCT_PUBLISHER "IT Asset Scanner"
!define PRODUCT_DIR "C:\WindowsAgent"

SetCompressor /SOLID lzma
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "WindowsAgentInstaller.exe"
InstallDir "${PRODUCT_DIR}"
RequestExecutionLevel admin

!include "MUI2.nsh"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install Windows Agent" SEC01
    SetOutPath "$INSTDIR"
    SetOverwrite on
    
    DetailPrint "Installing Windows Agent to $INSTDIR"
    
    ; Extract agent.ps1 from installer
    DetailPrint "Extracting agent.ps1..."
    File "agent.ps1"
    
    ; Verify extraction
    IfFileExists "$INSTDIR\agent.ps1" +3 0
        MessageBox MB_ICONSTOP "ERROR: Failed to extract agent.ps1"
        Abort
    
    DetailPrint "Agent script extracted successfully"
    
    ; Create server config
    DetailPrint "Creating server configuration..."
    FileOpen $0 "$INSTDIR\server.config" w
    FileWrite $0 "http://192.168.1.246:3000"
    FileClose $0
    
    ; Create batch wrapper for easier execution
    DetailPrint "Creating run wrapper..."
    FileOpen $1 "$INSTDIR\run_agent.bat" w
    FileWrite $1 "@echo off$\r$\n"
    FileWrite $1 "cd /d $\"$INSTDIR$\"$\r$\n"
    FileWrite $1 "PowerShell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $\"$INSTDIR\agent.ps1$\"$\r$\n"
    FileClose $1
    
    ; Remove existing task if present
    DetailPrint "Removing old scheduled task (if any)..."
    nsExec::ExecToLog 'schtasks /delete /tn "WindowsAgentHeartbeat" /f'
    
    ; Register new Scheduled Task (run on startup, repeat every 5 minutes)
    DetailPrint "Registering scheduled task..."
    nsExec::ExecToStack 'schtasks /create /tn "WindowsAgentHeartbeat" /tr "$INSTDIR\run_agent.bat" /sc onstart /ru "SYSTEM" /rl HIGHEST /f'
    Pop $2
    Pop $3
    
    ${If} $2 == 0
        DetailPrint "Scheduled task registered successfully"
    ${Else}
        DetailPrint "Warning: Task registration returned code $2"
        DetailPrint "Output: $3"
    ${EndIf}
    
    ; Run initial scan to verify connectivity
    DetailPrint "Running initial connectivity test..."
    nsExec::ExecToStack 'PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\agent.ps1"'
    Pop $4
    Pop $5
    
    ${If} $4 == 0
        DetailPrint "Initial scan completed successfully"
        MessageBox MB_ICONINFORMATION "Windows Agent installed successfully!$\r$\n$\r$\nInstalled to: $INSTDIR$\r$\nThe agent will run automatically on system startup."
    ${Else}
        DetailPrint "Initial scan exited with code $4"
        MessageBox MB_ICONEXCLAMATION "Agent installed but initial scan returned exit code $4.$\r$\n$\r$\nPlease check:$\r$\n- Network connectivity to server$\r$\n- Server is running at http://192.168.1.246:3000$\r$\n$\r$\nLog: $INSTDIR\agent.log"
    ${EndIf}
    
    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    
SectionEnd

Section "Uninstall"
    ; Remove Scheduled Task
    DetailPrint "Removing scheduled task..."
    nsExec::Exec 'schtasks /delete /tn "WindowsAgentHeartbeat" /f'
    
    ; Remove files
    Delete "$INSTDIR\agent.ps1"
    Delete "$INSTDIR\server.config"
    Delete "$INSTDIR\run_agent.bat"
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$INSTDIR\*.log"
    
    ; Remove directory
    RMDir "$INSTDIR"
    
    MessageBox MB_ICONINFORMATION "Windows Agent has been uninstalled."
SectionEnd
