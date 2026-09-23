# Windows Agent Dashboard & Backend

A comprehensive Node.js backend solution for managing Windows agent deployments, asset scanning, and real-time monitoring through a web dashboard.

## 🎯 Features

- **Express.js REST API** - Full-featured backend for agent management
- **Real-time Dashboard** - Web-based UI for monitoring and managing assets
- **Windows Agent Scripts** - PowerShell scripts for automated deployment on Windows machines
- **SQLite Database** - Lightweight persistent storage for asset and scan data
- **Authentication & Authorization** - Role-based access control (Admin, User roles)
- **QR Code Integration** - Support for QR-based asset identification
- **Live Audit Scanning** - Real-time asset inventory tracking

## 📦 Project Structure

```
windows-agent-dashboard/
├── dashboard.js                 # Main Express API server & WebSocket
├── db.js                        # SQLite database management
├── user-auth.js                 # Authentication & JWT/Session handling
├── rule-engine.js               # Alert rules & business logic
├── auth-config.js               # Auth token configuration
├── package.json                 # Node.js dependencies
├── public/                      # Frontend & static assets
│   ├── dashboard.html           # Main web dashboard UI
│   ├── audit-scan.html          # Asset audit interface
│   ├── scan.html                # QR scan interface
│   ├── windows-agent-install.html # Agent installation UI
│   ├── agent.ps1                # Windows agent data collector script
│   ├── install.bat              # Batch installation script
│   ├── install.ps1              # PowerShell installation helper
│   ├── install_standalone.bat   # Standalone installer
│   ├── setup_windows_agent.ps1  # Agent setup automation
│   ├── AGENT_files/             # Additional agent resources
│   └── logo.jpg                 # Branding assets
├── agent-setup/                 # Agent setup scripts
│   ├── install.bat
│   └── setup_windows_agent.ps1
├── config/                      # Configuration directory
│   └── tokens.example.json      # Example token configuration
├── data/                        # SQLite database storage
│   └── windows-agent.sqlite     # Main database (git-ignored)
└── backups/                     # Database backups
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** v14+ and npm
- **Windows Machines** for agent deployment (Windows 7+)
- Basic networking between server and Windows clients

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/linhla-cmd/windows-agent-dashboard.git
   cd windows-agent-dashboard
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure authentication**
   ```bash
   cp config/tokens.example.json config/tokens.json
   # Edit config/tokens.json and add your actual tokens
   ```

4. **Start the server**
   ```bash
   npm start
   ```
   
   Server will run on `http://localhost:3000` by default.

### Systemd Service (Linux/WSL Deployment)

To run as a system service:

```bash
# Create systemd service file
sudo nano /etc/systemd/system/windows-agent-dashboard.service
```

```ini
[Unit]
Description=Windows Agent Dashboard
After=network.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/home/openclaw/collector
ExecStart=/usr/bin/node dashboard.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable windows-agent-dashboard
sudo systemctl start windows-agent-dashboard
sudo systemctl status windows-agent-dashboard
```

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout

### Devices Management
- `GET /api/devices` - List all devices
- `PUT /api/devices/update-user` - Update device user assignment
- `PUT /api/devices/update-ip` - Update device IP address
- `POST /api/devices/metadata` - Get device metadata

### Asset Management
- `GET /api/assets/search` - Search assets
- `POST /api/scan/log` - Log scan data

### QR Code
- `GET /api/qr/:deviceId` - Get QR code for device
- `GET /api/qr/lookup` - Lookup device by QR

### System
- `POST /heartbeat` - Agent heartbeat (keep-alive)

## 📱 Windows Agent Deployment

### One-Line Installation (Recommended)

From a **Windows PowerShell (as Administrator)**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest 'http://YOUR_SERVER_IP:3000/install.bat' -OutFile $env:TEMP\install.bat; & $env:TEMP\install.bat"
```

Replace `YOUR_SERVER_IP` with your server's IP address.

### Manual Installation

1. Download `setup_windows_agent.ps1` from the dashboard
2. Run PowerShell as Administrator
3. Execute: `.\setup_windows_agent.ps1 -ServerUrl http://YOUR_SERVER_IP:3000`

### What the Agent Does

- Collects hardware information (CPU, RAM, Disk, Network)
- Monitors system processes and services
- Reports to the backend via REST API
- Sends heartbeat signals for health monitoring
- Listens for commands from the dashboard

## 🗄️ Database Schema

Main tables:
- `devices` - Registered Windows agents
- `scan_logs` - Asset scan history
- `heartbeats` - Agent connectivity logs
- `alerts` - Generated alerts from rule engine
- `users` - User accounts
- `sessions` - Active user sessions
- `refresh_tokens` - Token refresh records

## 🔐 Security Notes

- Never commit `config/tokens.json` with real tokens
- Use environment variables for sensitive config in production
- HTTPS recommended for production deployments
- Implement firewall rules to restrict API access
- Regularly backup SQLite database (`data/windows-agent.sqlite`)

## 📝 Environment Variables (Optional)

```bash
NODE_ENV=production
PORT=3000
DB_PATH=./data/windows-agent.sqlite
LOG_LEVEL=info
```

## 🐛 Troubleshooting

### Agent fails to connect
- Check firewall rules on both server and Windows machine
- Verify server IP/hostname is correct in installation URL
- Check logs: `tail -f dashboard.log`

### Database locked error
- Ensure only one instance of dashboard.js is running
- Kill orphaned processes: `lsof -i :3000`

### Permission denied on Linux
- Run with proper permissions or use systemd service
- Check user has write access to `data/` directory

## 📚 Documentation

- `BUILD-GUIDE.md` - Detailed build instructions
- `CHANGELOG-QR-ONLY.md` - Version changelog

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Commit changes: `git commit -m "feat: describe your feature"`
3. Push to branch: `git push origin feature/your-feature`
4. Submit a pull request

## 📄 License

MIT License - See LICENSE file for details

## 👨‍💼 Contact & Support

- GitHub: [@linhla-cmd](https://github.com/linhla-cmd)
- Report issues on the [Issues page](https://github.com/linhla-cmd/windows-agent-dashboard/issues)

---

**Last Updated:** 2026-09-23

