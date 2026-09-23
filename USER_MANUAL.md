# USER MANUAL - Windows Agent
## Hướng dẫn Sử dụng Phần mềm Thu thập Thông tin Tài sản Windows

**Phiên bản:** 2.1.0  
**Ngày cập nhật:** 2026-09-23  
**Tác giả:** IT Asset Scanner Team

---

## 📋 Mục lục

1. [Giới thiệu](#1-giới-thiệu)
2. [Yêu cầu hệ thống](#2-yêu-cầu-hệ-thống)
3. [Cài đặt Windows Agent](#3-cài-đặt-windows-agent)
4. [Sử dụng Windows Agent](#4-sử-dụng-windows-agent)
5. [Quản lý và Giám sát](#5-quản-lý-và-giám-sát)
6. [Gỡ cài đặt](#6-gỡ-cài-đặt)
7. [Khắc phục sự cố](#7-khắc-phục-sự-cố)
8. [Câu hỏi thường gặp (FAQ)](#8-câu-hỏi-thường-gặp-faq)

---

## 1. Giới thiệu

### 1.1. Windows Agent là gì?

**Windows Agent** là phần mềm tự động thu thập thông tin tài sản máy tính Windows trong doanh nghiệp, bao gồm:
- Thông tin phần cứng (CPU, RAM, Ổ cứng)
- Thông tin hệ điều hành (Windows version, build number)
- Địa chỉ IP và tên máy (Hostname)
- Thông tin người dùng hiện tại
- Trạng thái kết nối và hoạt động

### 1.2. Lợi ích

- ✅ **Tự động hóa:** Thu thập dữ liệu tự động, không cần can thiệp thủ công
- ✅ **Thời gian thực:** Cập nhật thông tin liên tục, dễ dàng theo dõi
- ✅ **Tập trung:** Quản lý toàn bộ tài sản từ Dashboard Web duy nhất
- ✅ **Nhẹ:** Chiếm ít tài nguyên hệ thống (< 50 MB RAM)
- ✅ **An toàn:** Không thu thập dữ liệu nhạy cảm, không ảnh hưởng hiệu suất

### 1.3. Kiến trúc hệ thống

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Windows Client │ ──────> │  Backend Server  │ <────── │  Web Dashboard  │
│  (Agent.ps1)    │  HTTPS  │  (Node.js API)   │         │  (Quản trị viên)│
└─────────────────┘         └──────────────────┘         └─────────────────┘
       │                             │
       │                             ▼
       └──────────> Gửi heartbeat    SQLite Database
                    mỗi 5 phút       (Lưu trữ dữ liệu)
```

---

## 2. Yêu cầu Hệ thống

### 2.1. Máy Client (Nơi cài Agent)

| Thông số | Yêu cầu tối thiểu | Khuyến nghị |
|----------|-------------------|-------------|
| **Hệ điều hành** | Windows 7 SP1 trở lên | Windows 10/11 |
| **PowerShell** | Version 3.0+ | Version 5.1+ |
| **RAM** | 2 GB | 4 GB trở lên |
| **Ổ cứng trống** | 10 MB | 50 MB |
| **Quyền Admin** | Bắt buộc (cài đặt) | - |
| **Kết nối mạng** | LAN/Internet | Stable network |

### 2.2. Máy Server (Backend)

| Thông số | Yêu cầu |
|----------|---------|
| **Hệ điều hành** | Linux (Ubuntu 20.04+) / Windows Server |
| **Node.js** | Version 14+ |
| **Port mở** | 3000 (hoặc tùy chỉnh) |
| **Database** | SQLite (đã bao gồm) |

### 2.3. Kết nối mạng

- Client phải truy cập được địa chỉ Server qua HTTP/HTTPS
- Port mặc định: `3000`
- Firewall cần mở port cho kết nối từ client đến server

---

## 3. Cài đặt Windows Agent

### 3.1. Phương án 1: Cài đặt bằng File EXE (Khuyên dùng cho End-user)

#### **Bước 1:** Tải file cài đặt

Truy cập trang hướng dẫn của hệ thống:
```
http://[ĐỊA_CHỈ_SERVER]:3000/windows-agent-install.html
```

Ví dụ: `http://192.168.1.246:3000/windows-agent-install.html`

#### **Bước 2:** Tải `WindowsAgentInstaller.exe`

Click vào nút **"Tải WindowsAgentInstaller.exe"** trên trang web.

#### **Bước 3:** Chạy file cài đặt

1. Click phải vào file `WindowsAgentInstaller.exe`
2. Chọn **"Run as Administrator"** (Chạy với quyền Quản trị viên)
3. Cho phép UAC (User Account Control) nếu có yêu cầu
4. Chờ quá trình cài đặt hoàn tất (khoảng 10-30 giây)

#### **Bước 4:** Xác nhận cài đặt thành công

Sau khi cài đặt, màn hình sẽ hiển thị thông báo:
```
✓ Windows Agent installed successfully!

Installed to: C:\WindowsAgent
The agent will run automatically on system startup.
```

---

### 3.2. Phương án 2: Cài đặt qua PowerShell 1-Line

#### **Dành cho:** IT Administrator, Triển khai hàng loạt

#### **Bước 1:** Mở PowerShell với quyền Administrator

- Nhấn `Windows + X`
- Chọn **"Windows PowerShell (Admin)"** hoặc **"Terminal (Admin)"**

#### **Bước 2:** Copy và chạy lệnh sau

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='http://192.168.1.246:3000'; iwr `"$url/install.bat`" -OutFile $env:TEMP\install.bat; & $env:TEMP\install.bat $url"
```

**Lưu ý:** Thay `http://192.168.1.246:3000` bằng địa chỉ Server thực tế của bạn.

#### **Bước 3:** Chờ cài đặt hoàn tất

Script sẽ tự động:
1. Tải file `install.bat`
2. Tải `agent.ps1` từ server
3. Tạo thư mục `C:\WindowsAgent`
4. Đăng ký Scheduled Task
5. Chạy lần đầu và gửi thông tin lên server

---

### 3.3. Phương án 3: Cài đặt thủ công

#### **Bước 1:** Tải file `agent.ps1`

Truy cập: `http://[ĐỊA_CHỈ_SERVER]:3000/agent.ps1` và lưu file về máy.

#### **Bước 2:** Tạo thư mục

```powershell
New-Item -ItemType Directory -Path "C:\WindowsAgent" -Force
```

#### **Bước 3:** Copy file `agent.ps1` vào thư mục

```powershell
Copy-Item ".\agent.ps1" -Destination "C:\WindowsAgent\agent.ps1"
```

#### **Bước 4:** Tạo file cấu hình

```powershell
"http://192.168.1.246:3000" | Out-File "C:\WindowsAgent\server.config" -Encoding UTF8
```

#### **Bước 5:** Đăng ký Scheduled Task

```powershell
schtasks /create /tn "WindowsAgentHeartbeat" /tr "PowerShell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\WindowsAgent\agent.ps1" /sc onstart /ru "SYSTEM" /rl HIGHEST /f
```

#### **Bước 6:** Chạy lần đầu

```powershell
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\WindowsAgent\agent.ps1"
```

---

## 4. Sử dụng Windows Agent

### 4.1. Agent hoạt động như thế nào?

Sau khi cài đặt, **Windows Agent** sẽ tự động:

1. **Chạy khi khởi động Windows:** Scheduled Task đã được đăng ký để chạy tự động
2. **Thu thập thông tin:** Mỗi lần chạy, Agent sẽ quét thông tin hệ thống
3. **Gửi lên Server:** Dữ liệu được gửi qua HTTPS về Backend Server
4. **Lặp lại định kỳ:** Mặc định chạy mỗi 5 phút (có thể cấu hình)

### 4.2. Dữ liệu được thu thập

| Loại dữ liệu | Mô tả | Ví dụ |
|--------------|-------|-------|
| **Hostname** | Tên máy tính | `PC-IT-001` |
| **FQDN** | Tên đầy đủ | `PC-IT-001.company.local` |
| **Domain** | Tên miền | `COMPANY` |
| **Người dùng** | Tài khoản đăng nhập | `nguyenvana` |
| **Địa chỉ IPv4** | IP trong LAN | `192.168.1.100` |
| **CPU** | Tên bộ vi xử lý | `Intel Core i5-10400` |
| **RAM** | Dung lượng RAM | `16 GB (Used: 8 GB)` |
| **Ổ cứng** | Danh sách ổ đĩa | `C:\ - 256 GB SSD` |
| **OS** | Hệ điều hành | `Windows 10 Pro 21H2` |
| **Manufacturer** | Nhà sản xuất | `Dell Inc.` |
| **Model** | Model máy | `OptiPlex 7080` |
| **Last Boot** | Lần khởi động cuối | `2026-09-20 08:30:00` |

### 4.3. Kiểm tra Agent đang hoạt động

#### **Cách 1: Kiểm tra Scheduled Task**

```powershell
schtasks /query /tn "WindowsAgentHeartbeat"
```

**Kết quả mong đợi:**
```
TaskName:      WindowsAgentHeartbeat
Next Run Time: At system startup
Status:        Ready
```

#### **Cách 2: Chạy thủ công để kiểm tra**

```powershell
cd C:\WindowsAgent
.\run_agent.bat
```

**Nếu thành công, bạn sẽ thấy:**
```
[INFO] Using Server URL: http://192.168.1.246:3000
[INFO] Sending heartbeat to: http://192.168.1.246:3000/heartbeat
[SUCCESS] Data sent successfully!
```

#### **Cách 3: Kiểm tra trên Dashboard Web**

1. Truy cập Dashboard: `http://[ĐỊA_CHỈ_SERVER]:3000/dashboard.html`
2. Đăng nhập với tài khoản Admin
3. Tìm kiếm hostname hoặc IP của máy client
4. Kiểm tra cột **"Last Seen"** - nếu hiển thị thời gian gần đây nghĩa là Agent đang hoạt động

---

## 5. Quản lý và Giám sát

### 5.1. Truy cập Web Dashboard

#### **URL mặc định:**
```
http://[ĐỊA_CHỈ_SERVER]:3000/dashboard.html
```

#### **Đăng nhập:**
- Sử dụng tài khoản được cấp bởi Administrator
- Mật khẩu mặc định (lần đầu): Liên hệ quản trị viên

### 5.2. Các chức năng trên Dashboard

#### **A. Xem danh sách tài sản**
- Hiển thị tất cả máy tính đã cài Agent
- Thông tin: Hostname, IP, CPU, RAM, OS, Last Seen

#### **B. Tìm kiếm tài sản**
- Tìm theo Hostname
- Tìm theo IP
- Tìm theo Mã tài sản (Asset Code)

#### **C. Xem chi tiết tài sản**
- Click vào dòng bất kỳ để xem chi tiết đầy đủ
- Xem lịch sử heartbeat (kết nối)
- Xem biểu đồ sử dụng CPU/RAM theo thời gian

#### **D. Cập nhật thông tin**
- Gán người sử dụng cho tài sản
- Cập nhật địa chỉ IP
- Tạo ticket báo hỏng

#### **E. Xuất báo cáo**
- Xuất danh sách tài sản ra Excel
- Xuất báo cáo tổng hợp theo phòng ban

### 5.3. Cảnh báo (Alerts)

Hệ thống tự động cảnh báo khi:
- ✗ Máy client **mất kết nối** quá 30 phút
- ✗ CPU sử dụng **> 90%** liên tục
- ✗ RAM sử dụng **> 95%**
- ✗ Ổ cứng còn **< 5 GB** trống

---

## 6. Gỡ cài đặt

### 6.1. Cách 1: Sử dụng Uninstaller (Khuyên dùng)

#### **Bước 1:** Mở thư mục cài đặt

```
C:\WindowsAgent\
```

#### **Bước 2:** Chạy file `Uninstall.exe`

- Click đúp vào `Uninstall.exe`
- Xác nhận gỡ cài đặt

#### **Kết quả:**
- Xóa Scheduled Task
- Xóa toàn bộ file trong `C:\WindowsAgent`
- Xóa thư mục `C:\WindowsAgent`

---

### 6.2. Cách 2: Gỡ cài đặt thủ công

#### **Bước 1:** Xóa Scheduled Task

```powershell
schtasks /delete /tn "WindowsAgentHeartbeat" /f
```

#### **Bước 2:** Xóa thư mục cài đặt

```powershell
Remove-Item -Path "C:\WindowsAgent" -Recurse -Force
```

#### **Bước 3:** Xác nhận đã gỡ sạch

```powershell
schtasks /query /tn "WindowsAgentHeartbeat"
```

**Kết quả mong đợi:**
```
ERROR: The system cannot find the file specified.
```

---

## 7. Khắc phục Sự cố

### 7.1. Agent không gửi dữ liệu lên Server

#### **Triệu chứng:**
- Máy không xuất hiện trên Dashboard
- Cột "Last Seen" không cập nhật

#### **Nguyên nhân & Giải pháp:**

| Nguyên nhân | Cách kiểm tra | Giải pháp |
|-------------|---------------|-----------|
| **Server không chạy** | Ping địa chỉ server | Khởi động lại service trên server |
| **Firewall chặn** | `Test-NetConnection -ComputerName [IP] -Port 3000` | Mở port 3000 trên Firewall |
| **Sai địa chỉ Server** | Kiểm tra file `C:\WindowsAgent\server.config` | Sửa lại địa chỉ Server đúng |
| **Agent chưa chạy** | `schtasks /query /tn "WindowsAgentHeartbeat"` | Đăng ký lại Scheduled Task |

#### **Lệnh test kết nối thủ công:**

```powershell
cd C:\WindowsAgent
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File ".\agent.ps1"
```

Nếu thành công, bạn sẽ thấy:
```
[SUCCESS] Data sent successfully!
```

---

### 7.2. Lỗi "Execution Policy"

#### **Triệu chứng:**
```
... cannot be loaded because running scripts is disabled on this system.
```

#### **Nguyên nhân:**
PowerShell Execution Policy bị hạn chế.

#### **Giải pháp:**

**Tạm thời (cho lần chạy hiện tại):**
```powershell
PowerShell.exe -ExecutionPolicy Bypass -File "C:\WindowsAgent\agent.ps1"
```

**Vĩnh viễn (cần Admin):**
```powershell
Set-ExecutionPolicy RemoteSigned -Scope LocalMachine -Force
```

---

### 7.3. Agent chạy nhưng dữ liệu không đúng

#### **Vấn đề:** Hostname, IP, hoặc thông tin khác bị sai

#### **Giải pháp:**

1. **Xóa dữ liệu cũ trên Server:**
   - Liên hệ Administrator để xóa bản ghi cũ trong Database

2. **Chạy lại Agent để gửi dữ liệu mới:**
   ```powershell
   cd C:\WindowsAgent
   .\run_agent.bat
   ```

3. **Kiểm tra lại trên Dashboard**

---

### 7.4. Máy chạy chậm sau khi cài Agent

#### **Triệu chứng:**
- CPU hoặc RAM tăng cao
- Máy lag khi khởi động

#### **Nguyên nhân:**
Agent có thể đang chạy quá thường xuyên hoặc bị lỗi vòng lặp.

#### **Giải pháp:**

1. **Kiểm tra Task Scheduler:**
   ```powershell
   schtasks /query /tn "WindowsAgentHeartbeat" /v
   ```

2. **Điều chỉnh tần suất chạy:**
   - Liên hệ Administrator để thay đổi interval từ 5 phút lên 15-30 phút

3. **Kiểm tra log lỗi:**
   ```powershell
   Get-EventLog -LogName Application -Source "PowerShell" -Newest 50
   ```

---

### 7.5. Không tìm thấy file `agent.ps1` sau khi cài

#### **Nguyên nhân:**
Antivirus hoặc Windows Defender đã xóa file nghi ngờ là malware.

#### **Giải pháp:**

1. **Thêm thư mục vào Exclusion (Ngoại lệ):**
   - Mở **Windows Security** → **Virus & threat protection**
   - Click **Manage settings**
   - Scroll xuống **Exclusions** → **Add or remove exclusions**
   - Thêm thư mục: `C:\WindowsAgent`

2. **Cài đặt lại Agent:**
   - Chạy lại `WindowsAgentInstaller.exe`

---

## 8. Câu hỏi Thường gặp (FAQ)

### 8.1. Agent có thu thập mật khẩu hoặc dữ liệu nhạy cảm không?

**Không.** Agent chỉ thu thập:
- Thông tin phần cứng (CPU, RAM, Disk)
- Thông tin hệ điều hành
- Hostname, IP, tên người dùng (không thu thập mật khẩu)

Tất cả mã nguồn có thể được kiểm tra trong file `agent.ps1`.

---

### 8.2. Agent có ảnh hưởng đến hiệu suất máy không?

**Không đáng kể.** Agent:
- Chạy rất nhanh (1-3 giây mỗi lần)
- Chỉ chạy định kỳ (mặc định 5 phút)
- Chiếm < 50 MB RAM khi chạy
- Không chạy liên tục ở background

---

### 8.3. Tôi có thể thay đổi tần suất chạy Agent không?

**Có.** Liên hệ Administrator để điều chỉnh Scheduled Task.

Hoặc tự chỉnh thủ công:
```powershell
schtasks /change /tn "WindowsAgentHeartbeat" /ri 15
```
(Thay `15` bằng số phút mong muốn, ví dụ 10, 30, 60)

---

### 8.4. Tôi có thể cài Agent trên nhiều máy cùng lúc không?

**Có.** Sử dụng:
- **Group Policy (GPO)** trong Active Directory
- **PowerShell Remoting** để cài từ xa
- **Deploy qua SCCM** hoặc công cụ quản lý tương tự

Liên hệ Administrator để được hỗ trợ triển khai hàng loạt.

---

### 8.5. Làm thế nào để biết Agent đang hoạt động?

Kiểm tra nhanh:
```powershell
schtasks /query /tn "WindowsAgentHeartbeat" /fo LIST | findstr "Status"
```

Hoặc kiểm tra trên Dashboard Web - cột **"Last Seen"** sẽ hiển thị thời gian gần đây.

---

### 8.6. Tôi có thể tự sửa file `agent.ps1` không?

**Không khuyến khích.** Sửa đổi có thể làm Agent ngừng hoạt động hoặc gửi dữ liệu sai.

Nếu cần tùy chỉnh, liên hệ Administrator hoặc IT Department.

---

### 8.7. Agent có tự động cập nhật không?

**Hiện tại chưa hỗ trợ tự động cập nhật.**

Khi có phiên bản mới:
1. Gỡ cài đặt phiên bản cũ
2. Cài đặt phiên bản mới

Hoặc chờ Administrator triển khai cập nhật tự động qua GPO.

---

### 8.8. Tôi có thể tắt Agent tạm thời không?

**Có.** Tắt Scheduled Task:

```powershell
schtasks /change /tn "WindowsAgentHeartbeat" /disable
```

Bật lại:
```powershell
schtasks /change /tn "WindowsAgentHeartbeat" /enable
```

**Lưu ý:** Khi tắt, máy sẽ không xuất hiện trên Dashboard và có thể bị cảnh báo mất kết nối.

---

## 9. Liên hệ Hỗ trợ

### 9.1. Thông tin liên hệ

- **IT Helpdesk:** [Email/Phone Number]
- **GitHub Repository:** [https://github.com/linhla-cmd/windows-agent-dashboard](https://github.com/linhla-cmd/windows-agent-dashboard)
- **Issue Tracker:** [GitHub Issues](https://github.com/linhla-cmd/windows-agent-dashboard/issues)

### 9.2. Báo lỗi

Khi báo lỗi, vui lòng cung cấp:
1. Thông tin máy tính (Windows version, hostname)
2. Nội dung lỗi (screenshot hoặc copy text lỗi)
3. File log (nếu có): `C:\WindowsAgent\*.log`
4. Các bước đã thử để khắc phục

---

## 10. Phụ lục

### 10.1. Cấu trúc thư mục cài đặt

```
C:\WindowsAgent\
├── agent.ps1              # Script chính
├── server.config          # Cấu hình địa chỉ Server
├── run_agent.bat          # Wrapper để chạy PowerShell
└── Uninstaller.exe        # Gỡ cài đặt
```

### 10.2. File cấu hình

**File:** `C:\WindowsAgent\server.config`

**Nội dung:**
```
http://192.168.1.246:3000
```

**Chỉnh sửa:**
```powershell
notepad C:\WindowsAgent\server.config
```

Thay đổi URL và lưu lại. Agent sẽ tự động đọc URL mới ở lần chạy tiếp theo.

---

### 10.3. Bảng mã lỗi

| Exit Code | Ý nghĩa | Giải pháp |
|-----------|---------|-----------|
| 0 | Thành công | - |
| 1 | Lỗi kết nối Server | Kiểm tra network và firewall |
| 2 | Lỗi đọc file config | Kiểm tra `server.config` |
| 3 | Lỗi PowerShell Execution Policy | Chạy với `-ExecutionPolicy Bypass` |

---

**Tài liệu này được cập nhật thường xuyên. Vui lòng kiểm tra phiên bản mới nhất trên GitHub Repository.**

---

© 2026 IT Asset Scanner Team. All Rights Reserved.
