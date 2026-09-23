<#
  Windows Agent Telemetry Collector
#>
param([switch]$Monitor)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$WebhookUrl   = "http://192.168.1.246:3000/heartbeat"
$WebhookToken = "71c1b6e8aabca325c16a623e3eb69ee967ce8764b43966e7585d5e0ac53eb341"
$AgentDir     = "C:\WindowsAgent"
$AgentFile    = "$AgentDir\agent.ps1"

# 1. Tu dong dam bao thu muc va file ton tai
if (-not (Test-Path $AgentDir)) {
    New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null
}

# 2. Thu thap thong tin thiet bi
$hostname = $env:COMPUTERNAME
try { $fqdn = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName } catch { $fqdn = $hostname }
$domain = $env:USERDOMAIN

$currentUser = @{
    username = $env:USERNAME
    domain   = $env:USERDOMAIN
}

# IPv4 (ưu tiên địa chỉ có gateway; gửi đúng chuỗi IP, không lấy ký tự đầu tiên)
$ipv4 = "Unknown"
$ipCandidates = @()
try {
    $adapters = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True" -ErrorAction SilentlyContinue
    foreach ($adapter in @($adapters)) {
        $gateway = if ($adapter.DefaultIPGateway) { [string]$adapter.DefaultIPGateway[0] } else { "" }
        foreach ($addr in @($adapter.IPAddress)) {
            $ip = [string]$addr
            if ($ip -match '^\d{1,3}(\.\d{1,3}){3}$' -and $ip -notmatch '^(127\.|169\.254\.)') {
                $ipCandidates += [pscustomobject]@{ ip=$ip; gateway=$gateway }
            }
        }
    }
    $selected = $ipCandidates | Where-Object { $_.gateway } | Select-Object -First 1
    if (-not $selected) { $selected = $ipCandidates | Select-Object -First 1 }
    if ($selected) { $ipv4 = [string]$selected.ip }
} catch {}

# RAM
$ram = @{ total_gb = 0; free_gb = 0; used_percent = 0 }
try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    if ($os) {
        $totalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
        $freeGB  = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
        $usedPct = [math]::Round((($totalGB - $freeGB) / $totalGB) * 100, 1)
        $ram = @{ total_gb = $totalGB; free_gb = $freeGB; used_percent = $usedPct }
    }
} catch {}

# CPU
$processor = @{ name = "Unknown"; usage_percent = 0 }
try {
    $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cpu) {
        $processor.name = $cpu.Name.Trim()
        $processor.usage_percent = $cpu.LoadPercentage
    }
} catch {}

# Disks
$disks = @()
try {
    $diskList = Get-CimInstance Win32_LogicalDisk -Filter "DriveType = 3" -ErrorAction SilentlyContinue
    foreach ($d in $diskList) {
        if ($d.Size -gt 0) {
            $total = [math]::Round($d.Size / 1GB, 2)
            $free  = [math]::Round($d.FreeSpace / 1GB, 2)
            $used  = [math]::Round($total - $free, 2)
            $pct   = [math]::Round(($used / $total) * 100, 1)
            $disks += @{
                device_id    = $d.DeviceID
                volume_name  = $d.VolumeName
                total_gb     = $total
                free_gb      = $free
                used_gb      = $used
                used_percent = $pct
            }
        }
    }
} catch {}

# Physical Disks (msinfo32-equivalent: model, media type, interface)
$physicalDisks = @()
try {
    $diskList = Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue
    foreach ($disk in @($diskList)) {
        $media = if ($disk.MediaType) { [string]$disk.MediaType } else { "Unknown" }
        $model = if ($disk.Model) { [string]$disk.Model } else { "Unknown" }
        $interface = if ($disk.InterfaceType) { [string]$disk.InterfaceType } else { "Unknown" }
        $physicalDisks += @{
            device_id       = [string]$disk.Index
            model           = $model.Trim()
            manufacturer    = if ($disk.Manufacturer) { ([string]$disk.Manufacturer).Trim() } else { "Unknown" }
            media_type      = $media.Trim()
            interface_type  = $interface.Trim()
            size_gb         = if ($disk.Size) { [math]::Round($disk.Size / 1GB, 2) } else { 0 }
            serial_number   = if ($disk.SerialNumber) { ([string]$disk.SerialNumber).Trim() } else { "Unknown" }
        }
    }
} catch {}

# Peripherals & Connected Devices (Keyboard, Mouse, Printers, Monitors)
$peripherals = @{
    keyboards = @()
    mice      = @()
    printers  = @()
    monitors  = @()
}
try {
            # 1. Bàn phím & Chuột (Đọc BusReportedDeviceDesc / Tên thương mại thật như Settings > Bluetooth & devices)
    try {
        # Cách 1: Sử dụng Get-PnpDevice + Get-PnpDeviceProperty (Chuẩn nhất trên Win 10 / 11)
        if (Get-Command Get-PnpDevice -ErrorAction SilentlyContinue) {
            $allPnp = Get-PnpDevice -PresentOnly -Status OK -ErrorAction SilentlyContinue | Where-Object {
                $_.Class -in @('Keyboard', 'Mouse', 'HIDClass', 'Bluetooth', 'USB')
            }
            foreach ($pnp in $allPnp) {
                $busName = $null
                try {
                    $prop = Get-PnpDeviceProperty -InstanceId $pnp.InstanceId -KeyName 'DEVPKEY_Device_BusReportedDeviceDesc' -ErrorAction SilentlyContinue
                    if ($prop -and $prop.Data) { $busName = [string]$prop.Data }
                } catch {}

                $candName = if ($busName) { $busName.Trim() } elseif ($pnp.FriendlyName) { $pnp.FriendlyName.Trim() } else { $null }
                if (-not $candName) { continue }

                # Lọc bỏ driver chung chung & hệ thống
                if ($candName -match '(?i)^HID Keyboard|^HID-compliant|^Standard PS/2|^USB Input Device|^Virtual|Terminal Server|Remote Desktop|Controller|Hub|Host|Generic') { continue }

                if ($pnp.Class -eq 'Keyboard' -or $candName -match '(?i)Keyboard|EK\d+|E-DRA|Keychron|Akko|Logitech K|RK\d+|Corsair|Razer') {
                    if ($candName -notin $peripherals.keyboards) { $peripherals.keyboards += $candName }
                }
                if ($pnp.Class -eq 'Mouse' -or $candName -match '(?i)Mouse|GamingMouse|TouchPad|Inphic|Logitech G|Razer|Fuhlen|Dareu') {
                    if ($candName -notin $peripherals.mice) { $peripherals.mice += $candName }
                }
            }
        }

        # Cách 2: Quét Registry Enum\USB & Enum\HID để lấy BusReportedDeviceDesc (Dự phòng nếu PnP cmdlet bị chặn)
        if ($peripherals.keyboards.Count -eq 0 -or $peripherals.mice.Count -eq 0) {
            $regBuses = @('HKLM:\SYSTEM\CurrentControlSet\Enum\USB', 'HKLM:\SYSTEM\CurrentControlSet\Enum\HID')
            foreach ($regPath in $regBuses) {
                if (Test-Path $regPath) {
                    Get-ChildItem -Path $regPath -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                        $regItem = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
                        $desc = if ($regItem.BusReportedDeviceDesc) { $regItem.BusReportedDeviceDesc.Trim() } elseif ($regItem.FriendlyName) { $regItem.FriendlyName.Trim() } else { $null }
                        if ($desc -and $desc -notmatch '(?i)^HID |^USB |^Standard |^Virtual|Terminal|Generic|Hub|Controller') {
                            if ($desc -match '(?i)Keyboard|EK\d+|E-DRA|Keychron|Akko' -and $desc -notin $peripherals.keyboards) {
                                $peripherals.keyboards += $desc
                            }
                            if ($desc -match '(?i)Mouse|Gaming|Inphic|TouchPad|Fuhlen' -and $desc -notin $peripherals.mice) {
                                $peripherals.mice += $desc
                            }
                        }
                    }
                }
            }
        }
    } catch {}

    # 3. Máy in (Chỉ lấy máy in kết nối USB thực tế)
    $printerList = Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue
    foreach ($pr in @($printerList)) {
        if ($pr.Name) {
            $port = if ($pr.PortName) { $pr.PortName.Trim() } else { "" }
            $isUsb = ($port -match '(?i)USB|DOT4')
            if ($isUsb) {
                $peripherals.printers += @{
                    name       = $pr.Name.Trim()
                    port       = $port
                    is_default = [bool]$pr.Default
                    is_network = [bool]$pr.Network
                    is_usb     = $true
                }
            }
        }
    }

    # 4. Màn hình (Monitors - Lấy model qua WmiMonitorID hoặc PnPEntity)
    try {
        $monList = Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue
        foreach ($mon in @($monList)) {
            $modelChars = $mon.UserFriendlyName | Where-Object { $_ -ne 0 }
            if ($modelChars) {
                $monName = [System.Text.Encoding]::ASCII.GetString([byte[]]$modelChars).Trim()
                if ($monName -and $monName -notin $peripherals.monitors) {
                    $peripherals.monitors += $monName
                }
            }
        }
    } catch {}
    if ($peripherals.monitors.Count -eq 0) {
        $monPnp = Get-CimInstance Win32_PnPEntity -Filter "PNPClass = 'Monitor'" -ErrorAction SilentlyContinue
        foreach ($mp in @($monPnp)) {
            if ($mp.Name -and $mp.Name -notmatch '(?i)generic pnp' -and $mp.Present -ne $false) {
                $peripherals.monitors += $mp.Name.Trim()
            }
        }
    }
} catch {}

# Security (Antivirus / Defender)
$security = @{ av_name = "Windows Defender"; av_status = "Active"; firewall = "Enabled" }
try {
    $av = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName "AntivirusProduct" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($av) { $security.av_name = $av.displayName }
} catch {}

# Local Admins
$adminCount = 0
try {
    $admins = Get-CimInstance Win32_GroupUser -ErrorAction SilentlyContinue | Where-Object { $_.GroupComponent -match 'Name="Administrators"' -or $_.GroupComponent -match 'Name="Quản trị viên"' }
    if ($admins) { $adminCount = $admins.Count }
} catch {}

# Chassis / Model
$chassisType = "Desktop"
$isLaptop = $false
$isDesktop = $true
$autoModel = "Unknown"
try {
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    if ($cs -and $cs.Model) { $autoModel = $cs.Model.Trim() }
    
    $enc = Get-CimInstance Win32_SystemEnclosure -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($enc -and $enc.ChassisTypes) {
        $typeNum = $enc.ChassisTypes[0]
        # 8,9,10,14,30,31,32 => Laptop / Portable
        if ($typeNum -in @(8, 9, 10, 14, 30, 31, 32)) {
            $chassisType = "Laptop"
            $isLaptop = $true
            $isDesktop = $false
        }
    }
    # Fallback to Battery
    if (-not $isLaptop) {
        $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
        if ($bat) {
            $chassisType = "Laptop"
            $isLaptop = $true
            $isDesktop = $false
        }
    }
} catch {}

# Downloads Scan (Count unclassified files in Downloads - Safe for Kaspersky & System context)
$downloadScan = @{
    total_files        = 0
    supported_files    = 0
    unclassified_files = 0
    scanned_roots      = @()
    access_status      = "OK"
}

try {
    # Scan current user profile or active logged-in user profiles
    $userProfiles = @()
    if ($env:USERPROFILE -and (Test-Path $env:USERPROFILE)) {
        $userProfiles += $env:USERPROFILE
    }
    
    # If running as SYSTEM, attempt to find active user profile under C:\Users
    if ([System.Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) {
        $userDirs = Get-ChildItem -Path "C:\Users" -Directory -ErrorAction SilentlyContinue | Where-Object { 
            $_.Name -notmatch '^(Public|Default|Default User|All Users)$' 
        }
        foreach ($uDir in $userDirs) {
            $uPath = $uDir.FullName
            if ($uPath -notin $userProfiles -and (Test-Path (Join-Path $uPath "Downloads"))) {
                $userProfiles += $uPath
            }
        }
    }

    $docExts = @(
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx', '.csv', '.txt',
        '.jpg', '.jpeg', '.png', '.bmp', '.webp', '.zip', '.rar', '.7z', '.tar', '.gz'
    )

    foreach ($p in $userProfiles) {
        $uDownloads = Join-Path $p "Downloads"
        if (Test-Path $uDownloads -ErrorAction SilentlyContinue) {
            $downloadScan.scanned_roots += $uDownloads
            try {
                $files = Get-ChildItem -Path $uDownloads -File -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
                if ($files) {
                    $downloadScan.total_files += $files.Count
                    foreach ($f in $files) {
                        try {
                            $ext = $f.Extension.ToLower()
                            if ($ext -in $docExts) {
                                $downloadScan.supported_files++
                            }
                            $downloadScan.unclassified_files++
                        } catch {}
                    }
                }
            } catch {
                $downloadScan.access_status = "BLOCKED_BY_AV_OR_PERMISSION"
            }
        }
    }
} catch {
    $downloadScan.access_status = "ERROR"
}

# License Activation (Windows & Office)
$windowsLicense = @{
    status = "Unknown"
    channel = "Unknown"
    # Tên hệ điều hành thực tế: Windows 10 Pro, Windows 11 Pro, Windows Server 2026, ...
    edition = "Unknown"
    os_caption = "Unknown"
    build_number = "Unknown"
    partial_key = "None"
    expiration = "Permanent"
}
try {
    $osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    if ($osInfo.Caption) {
        $actualOsName = ([string]$osInfo.Caption -replace '^Microsoft\s+', '').Trim()
        $windowsLicense.edition = $actualOsName
        $windowsLicense.os_caption = $actualOsName
    }
    if ($osInfo.BuildNumber) { $windowsLicense.build_number = [string]$osInfo.BuildNumber }
} catch {}
try {
    $slmgr = cscript.exe /nologo "$env:windir\System32\slmgr.vbs" /dli 2>&1
    if ($slmgr) {
        $lines = $slmgr -split "`r?`n"
        $statusMatch = $lines | Where-Object { $_ -match "License Status:" }
        $channelMatch = $lines | Where-Object { $_ -match "Description:" }
        $editionMatch = $lines | Where-Object { $_ -match "Name:" }
        try {
            $osWmi = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
            if ($osWmi -and $osWmi.Caption) {
                # Clean up "Microsoft " prefix if desired or keep clean, e.g., "Windows 11 Pro"
                $windowsLicense.edition = ($osWmi.Caption -replace "^Microsoft\s+", "").Trim()
            }
        } catch {}
        $keyMatch = $lines | Where-Object { $_ -match "Partial Product Key:" }

        if ($statusMatch) { $windowsLicense.status = ($statusMatch -split ":")[1].Trim() }
        if ($channelMatch) {
            $desc = ($channelMatch -split ":", 2)[1].Trim()
            if ($desc -match "VOLUME_KMSCLIENT") { $windowsLicense.channel = "KMS" }
            elseif ($desc -match "RETAIL") { $windowsLicense.channel = "Retail" }
            elseif ($desc -match "OEM") { $windowsLicense.channel = "OEM" }
            elseif ($desc -match "VOLUME_MAK") { $windowsLicense.channel = "MAK" }
            else { $windowsLicense.channel = $desc }
        }
        # slmgr /dli thường trả về tên SKU chung (ví dụ: "Windows(R), Professional edition").
        # Giữ Caption từ Win32_OperatingSystem để Dashboard thấy đúng Windows 10/11/Server.
        if ($editionMatch -and $windowsLicense.edition -eq "Unknown") { $windowsLicense.edition = ($editionMatch -split ":")[1].Trim() }
        if ($keyMatch) { $windowsLicense.partial_key = ($keyMatch -split ":")[1].Trim() }
    }
} catch {}

# Windows Expiration calculation
$winExp = "Permanent"
try {
    $xpr = cscript.exe /nologo "$env:windir\System32\slmgr.vbs" /xpr 2>&1
    $xprText = ($xpr -join " ")
    if ($xprText -match "permanently|vĩnh viễn|vinh vien") {
        $winExp = "Permanent"
    } elseif ($xprText -match "expire|hết hạn|het han") {
        $winExp = ($xpr -split "`r?`n" | Where-Object { $_ -match "expire|hết hạn|het han" }) -join " "
    }
} catch {}

try {
    $wmiWin = Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND ApplicationId = '55c92734-d682-4d71-983e-d6ec3f16059f'" -ErrorAction SilentlyContinue | Where-Object { $_.LicenseStatus -eq 1 } | Select-Object -First 1
    if ($wmiWin) {
        if ($wmiWin.GracePeriodRemaining -gt 0 -and $wmiWin.GracePeriodRemaining -lt 43200000) {
            $days = [math]::Round($wmiWin.GracePeriodRemaining / 1440, 1)
            $winExp = "$days days remaining"
        }
    }
} catch {}
$windowsLicense.expiration = $winExp


$officeLicense = @{
    status = "Unknown"
    installed = $false
    edition = "Unknown"
    details = @()
    expiration = "Unknown"
}
try {
    $osppPaths = @(
        "$env:ProgramFiles\Microsoft Office\Office16\ospp.vbs",
        "$env:ProgramFiles\Microsoft Office\root\Office16\ospp.vbs",
        "${env:ProgramFiles(x86)}\Microsoft Office\root\Office16\ospp.vbs",
        "${env:ProgramFiles(x86)}\Microsoft Office\Office16\ospp.vbs",
        "$env:ProgramFiles\Microsoft Office\root\Office15\ospp.vbs",
        "${env:ProgramFiles(x86)}\Microsoft Office\root\Office15\ospp.vbs",
        "$env:ProgramFiles\Microsoft Office\Office15\ospp.vbs",
        "${env:ProgramFiles(x86)}\Microsoft Office\Office15\ospp.vbs",
        "$env:ProgramFiles\Microsoft Office\Office14\ospp.vbs",
        "${env:ProgramFiles(x86)}\Microsoft Office\Office14\ospp.vbs"
    )
    
    $ospp = $null
    foreach ($path in $osppPaths) {
        if (Test-Path $path) {
            $ospp = $path
            break
        }
    }
    
    if (-not $ospp) {
        $c2r = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration" -ErrorAction SilentlyContinue
        if ($c2r -and $c2r.ProductReleaseIDs) {
            $officeLicense.installed = $true
            $officeLicense.status = "Installed (C2R)"
            $officeLicense.expiration = "Office 365 Subscription"
        }
    }
    
    $officeExp = "Permanent"
    if ($ospp) {
        $officeLicense.installed = $true
        $osppOut = cscript.exe /nologo $ospp /dstatus 2>&1
        $currentDetail = $null
        
        foreach ($line in ($osppOut -split "`r?`n")) {
            if ($line -match "SKU ID:\s*(.*)") {
                if ($currentDetail) { $officeLicense.details += $currentDetail }
                $currentDetail = @{ sku = $matches[1].Trim(); name = "Microsoft Office" }
            }
            elseif ($line -match "LICENSE NAME:\s*(.*)") { if ($currentDetail) { $currentDetail.name = $matches[1].Trim() } }
            elseif ($line -match "LICENSE DESCRIPTION:\s*(.*)") { if ($currentDetail) { $currentDetail.description = $matches[1].Trim() } }
            elseif ($line -match "LICENSE STATUS:\s+---(.*)---") { if ($currentDetail) { $currentDetail.status = $matches[1].Trim() } }
            elseif ($line -match "Last 5 characters of installed product key:\s*(.*)") { if ($currentDetail) { $currentDetail.partial_key = $matches[1].Trim() } }
            elseif ($line -match "REMAINING GRACE:\s*(.*)") {
                $graceStr = $matches[1].Trim()
                if ($graceStr -match "(\d+)\s*days") {
                    $officeExp = "$($matches[1]) days remaining"
                } elseif ($graceStr -match "(\d+)\s*minute") {
                    $mins = [int]$matches[1]
                    $d = [math]::Round($mins / 1440, 1)
                    $officeExp = "$d days remaining"
                } else {
                    $officeExp = $graceStr
                }
            }
        }
        if ($currentDetail) { $officeLicense.details += $currentDetail }
        if ($officeLicense.details.Count -gt 0) {
            $firstOffice = $officeLicense.details | Select-Object -First 1
            if ($firstOffice.name) { $officeLicense.edition = [string]$firstOffice.name }
            elseif ($firstOffice.description) { $officeLicense.edition = [string]$firstOffice.description }
        }
        
        $licensedCount = ($officeLicense.details | Where-Object { $_.status -eq "LICENSED" }).Count
        if ($licensedCount -gt 0) {
            $officeLicense.status = "Licensed"
        } elseif ($officeLicense.details.Count -gt 0) {
            $officeLicense.status = "Not Licensed"
        }
    }

    if ($officeLicense.details.Count -eq 0) {
        $wmiOffice = Get-CimInstance SoftwareLicensingProduct -Filter "Name like 'Office%'" -ErrorAction SilentlyContinue | Where-Object { $_.PartialProductKey }
        if ($wmiOffice) {
            $officeLicense.installed = $true
            foreach ($prod in $wmiOffice) {
                $statusStr = switch ($prod.LicenseStatus) {
                    1 { "LICENSED" }
                    2 { "OOB_GRACE" }
                    3 { "OOT_GRACE" }
                    4 { "NON_GENUINE_GRACE" }
                    5 { "NOTIFICATION" }
                    6 { "EXTENDED_GRACE" }
                    default { "UNKNOWN" }
                }
                $officeLicense.details += @{
                    name = $prod.Name
                    description = $prod.Description
                    status = $statusStr
                    partial_key = $prod.PartialProductKey
                }
                if ($officeLicense.edition -eq "Unknown" -and $prod.Name) { $officeLicense.edition = [string]$prod.Name }
                if ($prod.GracePeriodRemaining -gt 0 -and $prod.GracePeriodRemaining -lt 43200000) {
                    $d = [math]::Round($prod.GracePeriodRemaining / 1440, 1)
                    $officeExp = "$d days remaining"
                }
            }
            $licensedWmi = $officeLicense.details | Where-Object { $_.status -eq "LICENSED" }
            if ($licensedWmi.Count -gt 0) {
                $officeLicense.status = "Licensed"
            } else {
                $officeLicense.status = "Not Licensed"
            }
        }
    }

    $officeLicense.expiration = $officeExp
} catch {}

$licenses = @{
    windows = $windowsLicense
    office = $officeLicense
}

# Payload
$payload = @{ 
    device_id        = "windows-agent-$hostname"
    timestamp        = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
    hostname         = $hostname
    fqdn             = $fqdn
    domain           = $domain
    is_domain_joined = ($env:USERDOMAIN -ne $env:COMPUTERNAME)
    current_user     = $currentUser
    ipv4             = $ipv4
    power            = @{
        source           = "AC"
        battery_percent  = $null
        last_boot_event  = "6005"
    }
    security         = $security
    admins           = @{ local_admin_count = $adminCount }
    processor        = $processor
    ram              = $ram
    disks            = $disks
    physical_disks   = $physicalDisks
    peripherals      = $peripherals
    chassis_type     = $chassisType
    is_laptop        = $isLaptop
    is_desktop       = $isDesktop
    model            = $autoModel
    downloads        = $downloadScan
    licenses         = $licenses
} | ConvertTo-Json -Depth 10

# Gui Heartbeat
try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $req = [System.Net.HttpWebRequest]::Create($WebhookUrl)
    $req.Method = "POST"
    $req.ContentType = "application/json; charset=utf-8"
    $req.Headers.Add("Authorization", "Bearer $WebhookToken")
    $req.Timeout = 10000
    
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    
    $res = $req.GetResponse()
    $resStream = $res.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($resStream)
    $resText = $reader.ReadToEnd()
    $reader.Close()
    $res.Close()
    
    Write-Host "[OK] Gui Heartbeat thanh cong ve Dashboard: $resText" -ForegroundColor Green
} catch {
    Write-Host "[CANH BAO] Loi ket noi Server: $_" -ForegroundColor Red
}
