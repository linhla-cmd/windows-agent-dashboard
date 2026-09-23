// /home/openclaw/collector/dashboard.js
// Express Dashboard cho Windows Agent tích hợp SQLite

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { RuleEngine } = require('./rule-engine');
const db = require('./db');
const auth = require('./auth-config');
const userAuth = require('./user-auth');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Rule Engine
const ruleEngine = new RuleEngine({
  diskThreshold: 90,  // Warning threshold at 90%
  heartbeatTimeout: 20 * 3600  // 20 hours (hỗ trợ lịch gửi 2 lần/ngày: 09:00 & 14:00)
});

// Initialize default token nếu chưa có
const DEFAULT_TOKEN = auth.initializeDefaultToken();

// Khởi tạo tài khoản admin mặc định
userAuth.initAdminUser();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Middleware parse cookie cơ bản
app.use((req, res, next) => {
  req.cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach(c => {
      const [k, v] = c.trim().split('=');
      if (k && v) req.cookies[k] = decodeURIComponent(v);
    });
  }
  next();
});

// Middleware xác thực token cho endpoint /heartbeat
function verifyAuthToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  
  // Format: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Invalid Authorization format. Use: Bearer <token>' });
  }
  
  const token = parts[1];
  const authResult = auth.verifyToken(token);
  
  if (!authResult.valid) {
    return res.status(403).json({ error: authResult.error });
  }
  
  req.tokenMetadata = authResult.metadata;
  next();
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: db.dbPath
  });
});

// Auth Endpoints cho Web Dashboard
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
  }
  const user = db.getUserByUsername(username);
  if (!user || !user.is_active || !userAuth.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
  }
  db.markLogin(user.id);
  
  const userAgent = req.headers['user-agent'] || '';
  const tokens = userAuth.createAuthTokens(user, userAgent);

  res.cookie('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/api/auth',
    expires: new Date(tokens.refreshExpiresAt)
  });

  res.cookie('access_token', tokens.accessToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: tokens.expiresIn
  });

  res.json({
    status: 'ok',
    token: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role }
  });
});

app.post('/api/auth/refresh', (req, res) => {
  const refreshToken = req.cookies.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ error: 'MissingRefreshToken', message: 'Không tìm thấy refresh token' });
  }

  const userAgent = req.headers['user-agent'] || '';
  const result = userAuth.rotateRefreshToken(refreshToken, userAgent);

  if (!result) {
    res.clearCookie('refresh_token', { path: '/api/auth' });
    return res.status(401).json({ error: 'InvalidRefreshToken', message: 'Phiên làm việc đã hết hạn, vui lòng đăng nhập lại' });
  }

  res.cookie('refresh_token', result.refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/api/auth',
    expires: new Date(result.refreshExpiresAt)
  });

  res.cookie('access_token', result.accessToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: result.expiresIn
  });

  res.json({
    status: 'ok',
    token: result.accessToken,
    expiresIn: result.expiresIn,
    user: result.user
  });
});

app.post('/api/auth/logout', (req, res) => {
  const refreshToken = req.cookies.refresh_token;
  if (refreshToken) {
    userAuth.revokeRefreshToken(refreshToken);
  }
  res.clearCookie('refresh_token', { path: '/api/auth' });
  res.clearCookie('access_token', { path: '/' });
  res.json({ status: 'ok' });
});

app.get('/api/auth/me', userAuth.verifySessionMiddleware, (req, res) => {
  const user = db.getUserByUsername(req.user.username);
  if (user) {
    res.json({
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name || 'Quản trị viên',
        role: user.role || 'Admin',
        is_active: user.is_active,
        created_at: user.created_at
      }
    });
  } else {
    res.json({ user: req.user });
  }
});

// API Đổi mật khẩu người dùng
app.post('/api/auth/change-password', userAuth.verifySessionMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Mật khẩu hiện tại và mật khẩu mới là bắt buộc' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
  }
  const user = db.getUserByUsername(req.user.username);
  if (!user || !userAuth.verifyPassword(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác' });
  }
  const hash = userAuth.hashPassword(newPassword);
  db.updateUserPassword(user.id, hash);
  res.json({ status: 'ok', message: 'Đổi mật khẩu thành công' });
});

// User Management APIs (Admin only)
app.get('/api/users', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin'), (req, res) => {
  res.json({ users: db.getUsers() });
});

app.post('/api/users/create', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin'), (req, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Tên đăng nhập và mật khẩu là bắt buộc' });
  const allowedRoles = ['Admin', 'ITStaff', 'Auditor', 'Viewer'];
  if (!allowedRoles.includes(role || 'Viewer')) return res.status(400).json({ error: 'Vai trò không hợp lệ' });
  if (db.getUserByUsername(username)) return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  const hash = userAuth.hashPassword(password);
  const id = db.createUser(username, hash, role || 'Viewer', full_name || '');
  res.json({ status: 'ok', id });
});

app.post('/api/users/role', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin'), (req, res) => {
  const { id, role } = req.body || {};
  if (!id || !role) return res.status(400).json({ error: 'ID và Vai trò là bắt buộc' });
  const allowedRoles = ['Admin', 'ITStaff', 'Auditor', 'Viewer', 'Operator'];
  if (!allowedRoles.includes(role)) return res.status(400).json({ error: 'Vai trò không hợp lệ' });
  
  if (req.user && req.user.id === Number(id) && role !== 'Admin') {
    return res.status(400).json({ error: 'Không thể tự hạ quyền Admin của chính mình' });
  }

  db.updateUserRole(id, role);
  res.json({ status: 'ok', message: 'Cập nhật vai trò thành công' });
});

app.post('/api/users/status', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin'), (req, res) => {
  const { id, is_active } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  db.updateUserStatus(id, !!is_active);
  res.json({ status: 'ok' });
});

app.post('/api/users/reset-password', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin'), (req, res) => {
  const { id, password } = req.body || {};
  if (!id || !password) return res.status(400).json({ error: 'id và password là bắt buộc' });
  const hash = userAuth.hashPassword(password);
  db.updateUserPassword(id, hash);
  res.json({ status: 'ok' });
});

// Cập nhật thông tin người dùng (full_name, role)
app.post('/api/users/update', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin'), (req, res) => {
  const { id, full_name, role } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id là bắt buộc' });
  
  const allowedRoles = ['Admin', 'ITStaff', 'Auditor', 'Viewer', 'Operator'];
  if (role && !allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Vai trò không hợp lệ' });
  }

  try {
    if (full_name !== undefined && full_name !== '') {
      db.db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(full_name, id);
    }
    if (role) {
      db.updateUserRole(id, role);
    }
    res.json({ success: true, message: 'Cập nhật thành công' });
  } catch (error) {
    console.error('[API] Lỗi cập nhật người dùng:', error);
    res.status(500).json({ success: false, error: 'Lỗi máy chủ: ' + error.message });
  }
});

app.post('/api/users/delete', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin'), (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  if (id === req.user.id) return res.status(400).json({ error: 'Không thể tự xóa tài khoản của chính mình' });
  db.deleteUser(id);
  res.json({ status: 'ok' });
});

// API Cập nhật thông tin tài sản & thiết bị ngoại vi (Ghi nhận thủ công)
app.post('/api/devices/metadata', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin', 'ITStaff', 'Operator'), (req, res) => {
  try {
    const { device_id, asset_tag, model, department, monitor, printer, peripherals, asset_user } = req.body || {};
    if (!device_id) {
      return res.status(400).json({ error: 'device_id required' });
    }
    db.updateDeviceMetadata(device_id, {
      asset_tag,
      model,
      department,
      monitor,
      printer,
      peripherals,
      asset_user
    });
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Heartbeat endpoint - nhận payload từ Windows Agent (yêu cầu xác thực)
app.post('/heartbeat', verifyAuthToken, (req, res) => {
  const payload = req.body;
  if (!payload || !payload.device_id) {
    return res.status(400).json({ error: 'device_id required' });
  }

  // Chạy qua Rule Engine để kiểm tra cảnh báo
  // Lấy dữ liệu lịch sử của thiết bị từ SQLite để Rule Engine so sánh (identity drift)
  const devicesInDb = db.getDevices();
  const existingDevice = devicesInDb.find(d => d.device_id === payload.device_id);
  
  if (existingDevice) {
    // Tái cấu trúc cấu hình cũ để so sánh
    ruleEngine.devices.set(payload.device_id, {
      id: payload.device_id,
      last_seen: existingDevice.last_seen,
      current: existingDevice.last_seen ? {
        hostname: existingDevice.hostname,
        fqdn: existingDevice.fqdn,
        domain: existingDevice.domain,
        current_user: existingDevice.current_user,
        ipv4: existingDevice.ipv4
      } : null
    });
  }

  const alerts = ruleEngine.processHeartbeat(payload);
  
  // Lưu vào SQLite
  try {
    db.saveHeartbeat(payload, alerts);
    res.json({ status: 'ok', alerts_generated: alerts.length, alerts });
  } catch (err) {
    console.error('Lỗi khi lưu vào SQLite:', err);
    res.status(500).json({ error: 'Database error', message: err.message });
  }
});

// Dashboard API - lấy danh sách thiết bị từ SQLite

// ==========================================
// QR CODE ASSET TAG & LOOKUP APIs
// ==========================================

// 1. API sinh mã QR (Định dạng mã hóa: Asset tag-Model-IP)

// API Cập nhật trạng thái in QR Code
app.post('/api/qr/status', userAuth.verifySessionMiddleware, (req, res) => {
  try {
    const { deviceId, printed } = req.body || {};
    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }
    const isPrinted = printed !== false && printed !== 0;
    const timestamp = isPrinted ? Date.now() : null;
    db.updateQRPrinted(deviceId, isPrinted ? 1 : 0, timestamp);
    res.json({ status: 'ok', deviceId, qr_printed: isPrinted ? 1 : 0, qr_printed_at: timestamp });
  } catch (err) {
    console.error('Lỗi cập nhật trạng thái QR:', err);
    res.status(500).json({ error: 'Lỗi server', message: err.message });
  }
});

app.get('/api/qr/:deviceId', userAuth.verifySessionMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = db.getDevices().find(d => d.device_id === deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Không tìm thấy thiết bị' });
    }

    const assetTag = device.asset_tag || 'N/A';
    const model = device.model || 'Unknown';
    let ip = 'Unknown';
    if (device.ipv4) {
      try {
        const ips = JSON.parse(device.ipv4);
        if (Array.isArray(ips) && ips.length > 0) ip = ips[0].ip || 'Unknown';
      } catch (e) {
        ip = device.ipv4;
      }
    }

    // Định dạng mã hóa: chỉ chứa Mã Tài Sản (asset_tag)
    const qrPayload = assetTag;
    
    // Tạo mã QR DataURL (chỉ chứa QR code tinh gọn cho tem in 2x2cm)
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 250,
      margin: 1,
      errorCorrectionLevel: 'M'
    });

    res.json({
      device_id: device.device_id,
      hostname: device.hostname || 'Unknown',
      asset_tag: assetTag,
      model: model,
      ip: ip,
      department: device.department || 'N/A',
      asset_user: device.asset_user || 'N/A',
      monitor: device.monitor || 'N/A',
      qrPayload: qrPayload,
      qrDataUrl: qrDataUrl
    });
  } catch (err) {
    console.error('Lỗi sinh mã QR:', err);
    res.status(500).json({ error: 'Lỗi server khi sinh mã QR', message: err.message });
  }
});

// 2. API Quét / Tra cứu thông tin thiết bị theo mã tài sản (Public / Mobile API)
app.get('/api/assets/search', async (req, res) => {
  try {
    const query = (req.query.q || req.query.asset_code || req.query.asset_tag || '').trim();
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        message: 'Vui lòng cung cấp mã tài sản (tham số ?q= hoặc ?asset_tag=)' 
      });
    }

    const devices = db.getDevices();
    
    // Tìm kiếm thiết bị theo mã tài sản (hoặc hostname/device_id)
    const matched = devices.find(d => 
      (d.asset_tag && d.asset_tag.toLowerCase() === query.toLowerCase()) ||
      (d.device_id && d.device_id.toLowerCase() === query.toLowerCase()) ||
      (d.hostname && d.hostname.toLowerCase() === query.toLowerCase())
    );

    if (!matched) {
      return res.status(404).json({ 
        success: false, 
        message: `Không tìm thấy tài sản với mã "${query}" trên hệ thống` 
      });
    }

    // Xử lý IP LAN chính xác
    let ipDisplay = 'Unknown';
    if (matched.ipv4) {
      try {
        const ips = typeof matched.ipv4 === 'string' ? jsonDecodeSafe(matched.ipv4) : matched.ipv4;
        if (Array.isArray(ips) && ips.length > 0) {
          const validIp = ips.find(item => item && item.ip && !item.ip.startsWith('169.254.') && !item.ip.startsWith('127.'));
          ipDisplay = validIp ? validIp.ip : (ips[0].ip || 'Unknown');
        } else if (typeof matched.ipv4 === 'string') {
          ipDisplay = matched.ipv4;
        }
      } catch (e) {
        ipDisplay = matched.ipv4;
      }
    }

    // Lấy thông tin cấu hình từ Heartbeat gần nhất nếu có
    const recent = db.getRecentHeartbeats(100);
    const lastHb = recent.find(h => h.device_id === matched.device_id);
    const p = lastHb && lastHb.payload ? lastHb.payload : {};

    let processor = 'N/A';
    if (p.processor && p.processor.name) {
      processor = p.processor.name;
    } else if (p.cpu_model) {
      processor = p.cpu_model;
    } else if (p.cpu) {
      processor = `${p.cpu.brand || ''} ${p.cpu.cores ? p.cpu.cores + ' Cores' : ''}`.trim() || 'N/A';
    }

    let ram = 'N/A';
    if (p.ram && (p.ram.total_physical_gb || p.ram.total_gb)) {
      const gb = p.ram.total_physical_gb || p.ram.total_gb;
      ram = `${Math.round(gb)} GB`;
    } else if (p.ram_gb) {
      ram = `${p.ram_gb} GB`;
    } else if (p.memory && p.memory.total) {
      ram = `${Math.round(p.memory.total / (1024*1024*1024))} GB`;
    }

    return res.json({
      success: true,
      data: {
        asset_code: matched.asset_tag || 'N/A',
        machine_name: matched.hostname || 'Unknown',
        current_user: matched.asset_user || matched.current_user || 'Chưa gán',
        ip_address: ipDisplay,
        processor: processor,
        ram: ram,
        department: matched.department || 'Chưa cập nhật',
        model: matched.model || p.model || 'Unknown',
        is_online: (Date.now() - (matched.last_seen || 0)) / 1000 <= ruleEngine.heartbeatTimeout
      }
    });
  } catch (err) {
    console.error('Lỗi API tìm kiếm tài sản:', err);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tra cứu tài sản', error: err.message });
  }
});

// Helper json decode
function jsonDecodeSafe(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

// API Ghi nhận lịch sử quét từ Mobile App (Public - không cần auth)
app.post('/api/scan/log', (req, res) => {
  try {
    const { asset_tag, scanned_by, scan_source, ip_address, device_info } = req.body || {};
    if (!asset_tag) {
      return res.status(400).json({ success: false, error: 'asset_tag bắt buộc' });
    }
    db.saveScanLog(asset_tag, scanned_by, scan_source, ip_address, device_info);
    res.json({ success: true, message: 'Đã ghi nhận lịch sử quét' });
  } catch (err) {
    console.error('Lỗi API ghi log quét:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API Cập nhật người sử dụng từ Mobile App (Yêu cầu xác thực & quyền Admin)
app.put('/api/devices/update-user', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin'), (req, res) => {
  try {
    const { asset_tag, asset_user } = req.body || {};
    if (!asset_tag) {
      return res.status(400).json({ success: false, error: 'asset_tag bắt buộc' });
    }
    const devices = db.getDevices();
    const device = devices.find(d => d.asset_tag && d.asset_tag.toLowerCase() === asset_tag.toLowerCase());
    if (!device) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy thiết bị' });
    }
    db.updateDeviceMetadata(device.device_id, {
      asset_tag: device.asset_tag,
      model: device.model,
      department: device.department,
      monitor: device.monitor,
      printer: device.printer,
      peripherals: device.peripherals,
      asset_user: asset_user
    });
    res.json({ success: true, message: 'Đã cập nhật người sử dụng' });
  } catch (err) {
    console.error('Lỗi API cập nhật user:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API Cập nhật IP thiết bị từ Mobile App (Yêu cầu quyền Admin)
app.put('/api/devices/update-ip', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin'), (req, res) => {
  try {
    const { asset_tag, ip_address } = req.body || {};
    if (!asset_tag) {
      return res.status(400).json({ success: false, error: 'asset_tag bắt buộc' });
    }
    if (!ip_address) {
      return res.status(400).json({ success: false, error: 'ip_address bắt buộc' });
    }
    const devices = db.getDevices();
    const device = devices.find(d => d.asset_tag && d.asset_tag.toLowerCase() === asset_tag.toLowerCase());
    if (!device) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy thiết bị' });
    }
    // Cập nhật IP trong database
    db.db.prepare('UPDATE devices SET ipv4 = ? WHERE device_id = ?').run(ip_address, device.device_id);
    res.json({ success: true, message: 'Đã cập nhật địa chỉ IP' });
  } catch (err) {
    console.error('Lỗi API cập nhật IP:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. API Quét / Tra cứu thông tin thiết bị sau khi Scan QR (Public/Authenticated)
app.get('/api/qr/lookup', async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.status(400).json({ error: 'Vui lòng cung cấp chuỗi QR hoặc mã tài sản' });
    }

    const devices = db.getDevices();
    let matched = null;

    // Tìm kiếm chính xác theo device_id, asset_tag, hostname
    matched = devices.find(d => 
      (d.device_id && d.device_id.toLowerCase() === query.toLowerCase()) ||
      (d.asset_tag && d.asset_tag.toLowerCase() === query.toLowerCase()) ||
      (d.hostname && d.hostname.toLowerCase() === query.toLowerCase())
    );

    // Nếu chuỗi scan có dạng "Asset tag-Model-IP"
    if (!matched && query.includes('-')) {
      const parts = query.split('-');
      const assetTagGuess = parts[0].trim();
      const ipGuess = parts[parts.length - 1].trim();

      matched = devices.find(d => {
        const tagMatch = d.asset_tag && d.asset_tag.toLowerCase() === assetTagGuess.toLowerCase();
        let ipMatch = false;
        if (d.ipv4) {
          try {
            const ips = JSON.parse(d.ipv4);
            ipMatch = Array.isArray(ips) && ips.some(item => item.ip === ipGuess);
          } catch (e) {
            ipMatch = d.ipv4.includes(ipGuess);
          }
        }
        return tagMatch || ipMatch;
      });
    }

    if (!matched) {
      return res.status(404).json({ error: 'Không tìm thấy thông tin thiết bị tương ứng trong cơ sở dữ liệu' });
    }

    // Lấy thông tin màn hình & linh kiện từ heartbeat gần nhất nếu có
    const recent = db.getRecentHeartbeats(100);
    const lastHb = recent.find(h => h.device_id === matched.device_id);
    let monitorDesc = matched.monitor || 'Chưa gán mã';
    if (lastHb && lastHb.payload && lastHb.payload.peripherals && Array.isArray(lastHb.payload.peripherals.monitors) && lastHb.payload.peripherals.monitors.length > 0) {
      monitorDesc += ` (${lastHb.payload.peripherals.monitors.join(', ')})`;
    }

    let ipDisplay = 'Unknown';
    if (matched.ipv4) {
      try {
        const ips = JSON.parse(matched.ipv4);
        if (Array.isArray(ips) && ips.length > 0) ipDisplay = ips[0].ip || 'Unknown';
      } catch (e) {
        ipDisplay = matched.ipv4;
      }
    }

    res.json({
      success: true,
      data: {
        hostname: matched.hostname || 'Unknown',
        asset_tag: matched.asset_tag || 'N/A',
        user_department: `${matched.asset_user || 'Chưa cập nhật'} / ${matched.department || 'Chưa cập nhật'}`,
        user: matched.asset_user || 'Chưa cập nhật',
        department: matched.department || 'Chưa cập nhật',
        model: matched.model || 'Unknown',
        ip: ipDisplay,
        monitor: monitorDesc,
        monitor_asset_tag: matched.monitor || 'N/A',
        is_online: (Date.now() - matched.last_seen) / 1000 <= ruleEngine.heartbeatTimeout
      }
    });
  } catch (err) {
    console.error('Lỗi tra cứu QR:', err);
    res.status(500).json({ error: 'Lỗi tra cứu thiết bị', message: err.message });
  }
});

// 3. Trang hiển thị tra cứu trực quan khi scan QR trên điện thoại
app.get('/qr/scan', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scan.html'));
});

app.get('/api/devices', userAuth.verifySessionMiddleware, (req, res) => {
  try {
    const devicesList = db.getDevices();
    const now = Date.now();

    // Map thêm trạng thái online/offline động & load các alerts gần đây
    const result = devicesList.map(device => {
      const secondsSinceLastSeen = (now - device.last_seen) / 1000;
      const isOnline = secondsSinceLastSeen <= ruleEngine.heartbeatTimeout;
      // Lấy heartbeat gần nhất để tính alert hiện tại
      const recent = db.getRecentHeartbeats(100);
      const lastHb = recent.find(h => h.device_id === device.device_id);

      // Tính alert HIỆN TẠI từ payload cuối cùng (không lấy lịch sử DB)
      const currentAlerts = [];
      if (!isOnline) {
        currentAlerts.push({
          code: 'DEVICE_OFFLINE',
          level: 'CRITICAL',
          message: `Thiết bị offline ${Math.floor(secondsSinceLastSeen)}s`,
          timestamp: new Date().toISOString()
        });
      } else if (lastHb) {
        const p = lastHb.payload;
        if (p.security) {
          if (!p.security.defender) currentAlerts.push({ code: 'DEFENDER_OFF', level: 'WARNING', message: 'Windows Defender is disabled', timestamp: new Date().toISOString() });
          if (!p.security.firewall) currentAlerts.push({ code: 'FIREWALL_OFF', level: 'WARNING', message: 'Windows Firewall is disabled', timestamp: new Date().toISOString() });
        }
        if (p.disks && Array.isArray(p.disks)) {
          for (const disk of p.disks) {
            if (disk.used_percent >= ruleEngine.diskThreshold) {
              currentAlerts.push({ code: 'DISK_FULL', level: 'CRITICAL', message: `Disk ${disk.device_id || disk.mount} at ${disk.used_percent}% (threshold: ${ruleEngine.diskThreshold}%)`, timestamp: new Date().toISOString() });
            }
          }
        }
        if (p.downloads && p.downloads.unclassified_files > 0) {
          currentAlerts.push({ code: 'DOWNLOADS_UNCLASSIFIED', level: 'WARNING', message: `Có ${p.downloads.unclassified_files} file chưa phân loại trong thư mục Downloads`, timestamp: new Date().toISOString() });
        }
      }

      // Sắp xếp theo độ nghiêm trọng (CRITICAL > WARNING > INFO), giữ tất cả
      const levelOrder = { critical: 0, warning: 1, warn: 1, info: 2 };
      currentAlerts.sort((a, b) => (levelOrder[(a.level||'info').toLowerCase()] ?? 9) - (levelOrder[(b.level||'info').toLowerCase()] ?? 9));
      const alerts = currentAlerts;

      return {
        device_id: device.device_id,
        hostname: device.hostname,
        fqdn: device.fqdn,
        domain: device.domain,
        current_user: device.current_user,
        // Thông tin tài sản được quản trị thủ công, tách biệt với heartbeat telemetry.
        asset_tag: device.asset_tag,
        model: device.model || (lastHb && lastHb.payload ? lastHb.payload.model : null),
        chassis_type: lastHb && lastHb.payload ? (lastHb.payload.chassis_type || 0) : 0,
        is_laptop: !!(lastHb && lastHb.payload && lastHb.payload.is_laptop),
        is_desktop: !!(lastHb && lastHb.payload && lastHb.payload.is_desktop),
        department: device.department,
        monitor: device.monitor,
        printer: device.printer,
        peripherals: device.peripherals,
        asset_user: device.asset_user,
        // Chọn IP thực sự của máy tính: ưu tiên IP có gateway, bỏ qua VMware/Virtual/Loopback/APIPA (169.254)
        ipv4: (() => {
          const isValidIp = (ip) => typeof ip === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !ip.startsWith('169.254.') && !ip.startsWith('127.');
          if (Array.isArray(device.ipv4) && device.ipv4.length) {
            const validIps = device.ipv4.filter(item => item && isValidIp(item.ip));
            const withGateway = validIps.find(item => item.gateway && String(item.gateway).trim() !== '');
            if (withGateway) return withGateway.ip;
            const realAdapter = validIps.find(item => {
              const iface = (item.interface || '').toLowerCase();
              return !iface.includes('vmware') && !iface.includes('virtual') && !iface.includes('loopback') && !iface.includes('bluetooth');
            });
            if (realAdapter) return realAdapter.ip;
            if (validIps[0]?.ip) return validIps[0].ip;
          }
          const hbIp = lastHb && lastHb.payload ? lastHb.payload.ipv4 : null;
          if (isValidIp(hbIp)) return hbIp;
          return null;
        })(),
        last_seen: device.last_seen,
        seconds_since_last_seen: secondsSinceLastSeen,
        is_online: isOnline,
        security: lastHb ? lastHb.payload.security : null,
        processor: lastHb ? lastHb.payload.processor : null,
        ram: lastHb ? lastHb.payload.ram : null,
        disks: lastHb ? lastHb.payload.disks : null,
        physical_disks: lastHb ? lastHb.payload.physical_disks : null,
        peripherals: lastHb ? lastHb.payload.peripherals : null,
        downloads: lastHb ? lastHb.payload.downloads : null,
        licenses: lastHb ? lastHb.payload.licenses : null,
        alerts: alerts,
        qr_printed: device.qr_printed,
        qr_printed_at: device.qr_printed_at
      };
    });

    res.json({ devices: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xuất danh sách thiết bị ra Excel, áp dụng bộ lọc tìm kiếm/trạng thái hiện tại.
app.get('/api/devices/export.xlsx', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin', 'ITStaff', 'Auditor', 'Operator'), async (req, res) => {
  try {
    const keyword = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || 'all').toLowerCase();
    const now = Date.now();
    const recent = db.getRecentHeartbeats(100);
    let devices = db.getDevices().map(device => {
      const seconds = (now - device.last_seen) / 1000;
      const heartbeat = recent.find(h => h.device_id === device.device_id);
      return { ...device, seconds_since_last_seen: seconds, is_online: seconds <= ruleEngine.heartbeatTimeout, heartbeat };
    });
    if (status === 'online') devices = devices.filter(d => d.is_online);
    if (status === 'offline') devices = devices.filter(d => !d.is_online);
    if (keyword) devices = devices.filter(d => [d.hostname, d.device_id, d.fqdn, d.domain, d.ipv4, d.asset_tag, d.model, d.department, d.asset_user].some(value => String(value || '').toLowerCase().includes(keyword)));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Windows Agent Dashboard';
    const sheet = workbook.addWorksheet('Danh sách thiết bị');
    sheet.columns = [
      { header: 'Tên máy', key: 'hostname', width: 24 }, { header: 'Mã thiết bị', key: 'device_id', width: 38 },
      { header: 'Trạng thái', key: 'status', width: 14 }, { header: 'Người dùng', key: 'current_user', width: 22 },
      { header: 'IP', key: 'ipv4', width: 18 }, { header: 'FQDN', key: 'fqdn', width: 28 }, { header: 'Domain', key: 'domain', width: 22 },
      { header: 'Asset tag', key: 'asset_tag', width: 18 }, { header: 'Model', key: 'model', width: 22 }, { header: 'Phòng ban', key: 'department', width: 20 },
      { header: 'Người sử dụng tài sản', key: 'asset_user', width: 25 }, { header: 'Màn hình', key: 'monitor', width: 25 }, { header: 'Máy in', key: 'printer', width: 25 },
      { header: 'Thiết bị ngoại vi', key: 'peripherals', width: 30 }, { header: 'Lần cuối', key: 'last_seen', width: 24 }
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    devices.forEach(d => sheet.addRow({ hostname: d.hostname || '', device_id: d.device_id || '', status: d.is_online ? 'Online' : 'Offline', current_user: d.current_user?.username || d.current_user || '', ipv4: Array.isArray(d.ipv4) ? (d.ipv4.find(i => i?.gateway)?.ip || d.ipv4[0]?.ip || '') : (d.ipv4 || ''), fqdn: d.fqdn || '', domain: d.domain || '', asset_tag: d.asset_tag || '', model: d.model || '', department: d.department || '', asset_user: d.asset_user || '', monitor: d.monitor || '', printer: d.printer || '', peripherals: d.peripherals || '', last_seen: d.last_seen ? new Date(d.last_seen).toLocaleString('vi-VN') : '' }));
    sheet.autoFilter = { from: 'A1', to: 'O1' };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="devices-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { console.error('Lỗi xuất Excel:', err); res.status(500).json({ error: err.message }); }
});

// API Summary Disk
app.get('/api/disk-summary', userAuth.verifySessionMiddleware, (req, res) => {
  try {
    const recent = db.getRecentHeartbeats(100);
    const disks = {};

    recent.forEach(hb => {
      const devId = hb.device_id;
      if (!disks[devId] && hb.payload.disks) {
        disks[devId] = hb.payload.disks;
      }
    });

    res.json({ disks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// AUDIT MANAGEMENT API ENDPOINTS (KIỂM KÊ)
// ==========================================

// Serve Mobile Audit Scan Page
app.get('/audit-scan', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'audit-scan.html'));
});

// 1. Tạo phiếu kiểm kê mới
app.post('/api/audit/tickets', (req, res) => {
  try {
    const { title, department, notes, created_by } = req.body;
    if (!title || title.trim() === '') {
      return res.status(400).json({ error: 'Tên phiếu kiểm kê không được để trống' });
    }

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PKK-${todayStr}-`;
    
    // Find count of today's tickets for ID generation
    const countRow = db.db.prepare("SELECT COUNT(*) as count FROM audit_tickets WHERE ticket_id LIKE ?").get(`${prefix}%`);
    const seq = String((countRow ? countRow.count : 0) + 1).padStart(3, '0');
    const ticketId = `${prefix}${seq}`;

    // Get devices matching department filter
    let devices = [];
    if (department && department !== 'all' && department !== 'Tất cả') {
      devices = db.db.prepare("SELECT asset_tag, hostname, department FROM devices WHERE department = ? AND asset_tag IS NOT NULL AND asset_tag != ''").all(department);
    } else {
      devices = db.db.prepare("SELECT asset_tag, hostname, department FROM devices WHERE asset_tag IS NOT NULL AND asset_tag != ''").all();
    }

    const totalItems = devices.length;
    const now = Date.now();

    // Insert ticket
    const insertTicket = db.db.prepare(`
      INSERT INTO audit_tickets (ticket_id, title, department, total_items, scanned_items, status, created_by, created_at, notes)
      VALUES (?, ?, ?, ?, 0, 'IN_PROGRESS', ?, ?, ?)
    `);
    insertTicket.run(ticketId, title.trim(), department || 'Tất cả', totalItems, created_by || 'Admin', now, notes || '');

    // Insert audit items
    const insertItem = db.db.prepare(`
      INSERT INTO audit_items (ticket_id, asset_tag, hostname, expected_department, actual_status)
      VALUES (?, ?, ?, ?, 'PENDING')
    `);

    const insertMany = db.db.transaction((items) => {
      for (const item of items) {
        insertItem.run(ticketId, item.asset_tag, item.hostname || '', item.department || '');
      }
    });

    insertMany(devices);

    res.json({
      success: true,
      ticket_id: ticketId,
      total_items: totalItems,
      message: `Đã tạo phiếu kiểm kê ${ticketId} với ${totalItems} thiết bị`
    });
  } catch (err) {
    console.error('Error creating audit ticket:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Lấy danh sách phiếu kiểm kê
app.get('/api/audit/tickets', (req, res) => {
  try {
    const { status } = req.query;
    let tickets;
    if (status) {
      tickets = db.db.prepare("SELECT * FROM audit_tickets WHERE status = ? ORDER BY created_at DESC").all(status);
    } else {
      tickets = db.db.prepare("SELECT * FROM audit_tickets ORDER BY created_at DESC").all();
    }
    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Chi tiết phiếu + danh sách items
app.get('/api/audit/tickets/:ticketId', (req, res) => {
  try {
    const ticket = db.db.prepare("SELECT * FROM audit_tickets WHERE ticket_id = ?").get(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Không tìm thấy phiếu kiểm kê' });
    }

    const items = db.db.prepare("SELECT * FROM audit_items WHERE ticket_id = ? ORDER BY id ASC").all(req.params.ticketId);
    
    // Thống kê theo trạng thái
    const stats = {
      total: items.length,
      matched: items.filter(i => i.actual_status === 'MATCHED').length,
      pending: items.filter(i => i.actual_status === 'PENDING').length,
      missing: items.filter(i => i.actual_status === 'MISSING').length,
      unexpected: items.filter(i => i.actual_status === 'UNEXPECTED').length,
    };

    res.json({ ticket, items, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3.5. API Tạo phiếu kiểm kê nhanh từ Mobile (Instant Ticket)
app.post('/api/audit/instant', (req, res) => {
  try {
    const { asset_tags } = req.body;

    if (!Array.isArray(asset_tags) || asset_tags.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Danh sách asset_tags không hợp lệ hoặc trống'
      });
    }

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PKK-${todayStr}-INSTANT-`;

    const countRow = db.db.prepare("SELECT COUNT(*) as count FROM audit_tickets WHERE ticket_id LIKE ?").get(`${prefix}%`);
    const seq = String((countRow ? countRow.count : 0) + 1).padStart(3, '0');
    const ticketId = `${prefix}${seq}`;

    const now = Date.now();
    const cleanTags = asset_tags.map(tag => (tag || '').toString().trim().toUpperCase()).filter(tag => tag);

    // Lấy thông tin thiết bị từ DB
    const devices = [];
    for (const tag of cleanTags) {
      const dev = db.db.prepare(
        "SELECT device_id, asset_tag, hostname, model, department FROM devices WHERE UPPER(asset_tag) = ?"
      ).get(tag);
      if (dev) {
        devices.push(dev);
      } else {
        // Thiết bị không có trong DB -> vẫn thêm vào phiếu
        devices.push({ asset_tag: tag, hostname: 'Không rõ', department: 'Khác' });
      }
    }

    // Tạo phiếu kiểm kê
    const title = `Kiểm kê nhanh - ${devices.length} thiết bị`;
    db.db.prepare(`
      INSERT INTO audit_tickets
      (ticket_id, title, department, total_items, scanned_items, status, created_by, created_at, notes)
      VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?)
    `).run(
      ticketId, title, 'Kiểm kê nhanh',
      devices.length, devices.length,
      'Mobile User', now,
      `Tạo từ app mobile - ${devices.length} thiết bị`
    );

    // Thêm audit items - tất cả MATCHED
    const insertItem = db.db.prepare(`
      INSERT INTO audit_items
      (ticket_id, asset_tag, hostname, expected_department, actual_status, scanned_by, scanned_at)
      VALUES (?, ?, ?, ?, 'MATCHED', ?, ?)
    `);

    const insertMany = db.db.transaction((items) => {
      for (const item of items) {
        insertItem.run(
          ticketId,
          item.asset_tag || '',
          item.hostname || '',
          item.department || 'N/A',
          'Mobile User',
          now
        );
      }
    });
    insertMany(devices);

    res.json({
      success: true,
      ticket_id: ticketId,
      total_items: devices.length,
      scanned_items: devices.length,
      status: 'IN_PROGRESS',
      message: `Tạo phiếu kiểm kê nhanh ${ticketId} với ${devices.length} thiết bị thành công`
    });
  } catch (err) {
    console.error('Lỗi tạo phiếu kiểm kê nhanh:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. API cho Mobile / PDA quét QR
app.post('/api/audit/tickets/:ticketId/scan', (req, res) => {
  try {
    const { ticketId } = req.params;
    const { asset_tag, scanned_by, scan_note } = req.body;

    if (!asset_tag || asset_tag.trim() === '') {
      return res.status(400).json({ error: 'Mã Asset Tag không hợp lệ' });
    }

    const cleanTag = asset_tag.trim().toUpperCase();

    const ticket = db.db.prepare("SELECT * FROM audit_tickets WHERE ticket_id = ?").get(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Không tìm thấy phiếu kiểm kê' });
    }

    if (ticket.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: `Phiếu kiểm kê đã ở trạng thái ${ticket.status}, không thể quét thêm` });
    }

    const now = Date.now();

    // Tìm item trong phiếu
    const existingItem = db.db.prepare("SELECT * FROM audit_items WHERE ticket_id = ? AND UPPER(asset_tag) = ?").get(ticketId, cleanTag);

    if (existingItem) {
      if (existingItem.actual_status === 'MATCHED') {
        return res.json({
          status: 'ALREADY_SCANNED',
          message: `Thiết bị ${cleanTag} đã được quét trước đó`,
          item: existingItem
        });
      }

      // Update item thành MATCHED
      db.db.prepare(`
        UPDATE audit_items 
        SET actual_status = 'MATCHED', scanned_by = ?, scanned_at = ?, scan_note = ?
        WHERE id = ?
      `).run(scanned_by || 'Mobile User', now, scan_note || '', existingItem.id);

      // Recount scanned matched items
      const countMatched = db.db.prepare("SELECT COUNT(*) as cnt FROM audit_items WHERE ticket_id = ? AND actual_status = 'MATCHED'").get(ticketId).cnt;
      db.db.prepare("UPDATE audit_tickets SET scanned_items = ? WHERE ticket_id = ?").run(countMatched, ticketId);

      // Lấy thông tin thiết bị
      const dev = db.db.prepare("SELECT hostname, department, current_user FROM devices WHERE UPPER(asset_tag) = ?").get(cleanTag);

      return res.json({
        status: 'MATCHED',
        message: `Quét thành công! Khớp với phiếu kiểm kê (${cleanTag})`,
        device: dev || { hostname: existingItem.hostname, department: existingItem.expected_department }
      });
    } else {
      // Không có trong phiếu -> Cảnh báo UNEXPECTED
      const dev = db.db.prepare("SELECT hostname, department, current_user FROM devices WHERE UPPER(asset_tag) = ?").get(cleanTag);
      
      db.db.prepare(`
        INSERT INTO audit_items (ticket_id, asset_tag, hostname, expected_department, actual_status, scanned_by, scanned_at, scan_note)
        VALUES (?, ?, ?, ?, 'UNEXPECTED', ?, ?, ?)
      `).run(ticketId, cleanTag, dev ? dev.hostname : 'Không rõ', dev ? dev.department : 'Khác', scanned_by || 'Mobile User', now, scan_note || 'Thiết bị ngoài danh sách phiếu');

      return res.json({
        status: 'UNEXPECTED',
        message: `⚠️ Cảnh báo: Mã QR ${cleanTag} không thuộc danh sách kiểm kê của phiếu này!`,
        device: dev || null
      });
    }
  } catch (err) {
    console.error('Error scanning QR for audit:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Duyệt phiếu kiểm kê
app.put('/api/audit/tickets/:ticketId/approve', (req, res) => {
  try {
    const { ticketId } = req.params;
    const { notes } = req.body;

    const ticket = db.db.prepare("SELECT * FROM audit_tickets WHERE ticket_id = ?").get(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Không tìm thấy phiếu kiểm kê' });
    }

    const now = Date.now();

    // Mark remaining PENDING items as MISSING
    db.db.prepare("UPDATE audit_items SET actual_status = 'MISSING' WHERE ticket_id = ? AND actual_status = 'PENDING'").run(ticketId);

    // Update ticket status
    db.db.prepare(`
      UPDATE audit_tickets
      SET status = 'APPROVED', approved_at = ?, notes = CASE WHEN ? != '' THEN ? ELSE notes END
      WHERE ticket_id = ?
    `).run(now, notes || '', notes || '', ticketId);

    res.json({ success: true, message: `Đã duyệt thành công phiếu kiểm kê ${ticketId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Hủy phiếu kiểm kê
app.put('/api/audit/tickets/:ticketId/cancel', (req, res) => {
  try {
    const { ticketId } = req.params;
    db.db.prepare("UPDATE audit_tickets SET status = 'CANCELLED' WHERE ticket_id = ?").run(ticketId);
    res.json({ success: true, message: `Đã hủy phiếu kiểm kê ${ticketId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Xóa vĩnh viễn phiếu kiểm kê (Admin)
app.delete('/api/audit/tickets/:ticketId', (req, res) => {
  try {
    const { ticketId } = req.params;
    db.db.prepare("DELETE FROM audit_items WHERE ticket_id = ?").run(ticketId);
    db.db.prepare("DELETE FROM audit_tickets WHERE ticket_id = ?").run(ticketId);
    res.json({ success: true, message: `Đã xóa vĩnh viễn phiếu kiểm kê ${ticketId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// IT Devices API Endpoints
app.get('/api/it-devices/stats', userAuth.verifySessionMiddleware, (req, res) => {
  try {
    const stats = db.getItDeviceStats();
    res.json({ success: true, ...stats });
  } catch (err) {
    console.error('Error fetching IT device stats:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/it-devices', userAuth.verifySessionMiddleware, (req, res) => {
  try {
    const { type, status, department, search } = req.query;
    const devices = db.getAllItDevices({ type, status, department, search });
    res.json({ success: true, devices });
  } catch (err) {
    console.error('Error fetching IT devices:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/it-devices/:id', userAuth.verifySessionMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const device = db.getItDeviceById(id);
    if (!device) {
      return res.status(404).json({ error: 'Không tìm thấy thiết bị IT' });
    }
    res.json({ success: true, device });
  } catch (err) {
    console.error('Error fetching IT device by ID:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/it-devices', userAuth.verifySessionMiddleware, (req, res) => {
  try {
    const { device_name, device_type } = req.body;
    if (!device_name || !device_type) {
      return res.status(400).json({ error: 'device_name và device_type là bắt buộc' });
    }
    const data = {
      ...req.body,
      created_by: req.user?.username || 'Unknown',
      updated_by: req.user?.username || 'Unknown'
    };
    const id = db.createItDevice(data);
    res.json({ success: true, id, message: 'Đã tạo thiết bị IT thành công' });
  } catch (err) {
    console.error('Error creating IT device:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/it-devices/:id', userAuth.verifySessionMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.getItDeviceById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Không tìm thấy thiết bị IT' });
    }
    const { device_name, device_type } = req.body;
    if (!device_name || !device_type) {
      return res.status(400).json({ error: 'device_name và device_type là bắt buộc' });
    }
    const data = {
      ...existing,
      ...req.body,
      updated_by: req.user?.username || 'Unknown'
    };
    db.updateItDevice(id, data);
    res.json({ success: true, message: 'Đã cập nhật thiết bị IT thành công' });
  } catch (err) {
    console.error('Error updating IT device:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/it-devices/:id', userAuth.verifySessionMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.getItDeviceById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Không tìm thấy thiết bị IT' });
    }
    db.deleteItDevice(id);
    res.json({ success: true, message: 'Đã xóa thiết bị IT thành công' });
  } catch (err) {
    console.error('Error deleting IT device:', err);
    res.status(500).json({ error: err.message });
  }
});


// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Route /portal đã chuyển sang Flutter Native App
// app.get('/portal', (req, res) => { res.sendFile(...) });

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API quản lý token (chỉ dùng cục bộ)
app.get('/api/tokens', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin', 'ITStaff', 'Operator'), (req, res) => {
  const tokens = auth.listTokens();
  res.json({ tokens });
});

app.post('/api/tokens/create', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin', 'ITStaff', 'Operator'), (req, res) => {
  const { name } = req.body;
  const newToken = auth.createToken(name || 'new-agent');
  res.json({ 
    token: newToken,
    message: 'Token created successfully. Copy and use in $WEBHOOK_TOKEN on Windows Agent.' 
  });
});

app.post('/api/tokens/delete', userAuth.verifySessionMiddleware, userAuth.requireRole('Admin', 'ITStaff', 'Operator'), (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'token required' });
  }
  auth.deleteToken(token);
  res.json({ message: 'Token deleted' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n🖥️  Windows Agent Dashboard & SQLite running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard page: http://localhost:${PORT}/dashboard`);
  console.log(`🔌 Heartbeat API: http://localhost:${PORT}/heartbeat`);
  console.log(`🔐 Token config: http://localhost:${PORT}/api/tokens\n`);
  console.log(`📋 Default Token: ${DEFAULT_TOKEN}`);
  console.log(`💡 Use this token in $WEBHOOK_TOKEN variable in monitor-agent.ps1\n`);
});

module.exports = app;