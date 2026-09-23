const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./db');

// JWT Secret Key (lưu cố định hoặc sinh ngẫu nhiên)
const JWT_SECRET_PATH = path.join(__dirname, 'data', '.jwt_secret');
let JWT_SECRET;
if (fs.existsSync(JWT_SECRET_PATH)) {
  JWT_SECRET = fs.readFileSync(JWT_SECRET_PATH, 'utf8').trim();
} else {
  JWT_SECRET = crypto.randomBytes(64).toString('hex');
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(JWT_SECRET_PATH, JWT_SECRET, { mode: 0o600 });
  } catch (err) {
    console.error('Không thể ghi JWT_SECRET:', err);
  }
}

// Token Expiration Constants
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const ACCESS_TOKEN_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

// Hash password dùng crypto.scryptSync
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

// Kiểm tra password
function verifyPassword(password, hashStr) {
  if (!hashStr || !hashStr.includes(':')) return false;
  const [salt, key] = hashStr.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

// Khởi tạo tài khoản admin mặc định nếu chưa có người dùng nào
function initAdminUser() {
  const users = db.getUsers();
  if (users.length === 0) {
    const defaultPassword = 'Admin123456@Password';
    const hash = hashPassword(defaultPassword);
    db.createUser('admin', hash, 'Admin', 'admin');
    console.log(`\n======================================================`);
    console.log(`🔑 Đã tạo tài khoản Quản trị ban đầu (Admin):`);
    console.log(`   - Username: admin`);
    console.log(`   - Password: ${defaultPassword}`);
    console.log(`⚠️ Vui lòng đăng nhập và đổi mật khẩu ngay sau khi truy cập!`);
    console.log(`======================================================\n`);
  }
}

// Sinh Access Token (JWT)
function generateAccessToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
}

// Hash Refresh Token để lưu DB an toàn
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Sinh cặp Access Token + Refresh Token khi đăng nhập
function createAuthTokens(user, userAgent = '') {
  const accessToken = generateAccessToken(user);
  
  const rawRefreshToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const expiresAt = Date.now() + REFRESH_TOKEN_MS;

  db.createRefreshToken(tokenHash, user.id, expiresAt, userAgent);

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: ACCESS_TOKEN_MS,
    refreshExpiresAt: expiresAt
  };
}

// Thực hiện Refresh Token Rotation
function rotateRefreshToken(rawRefreshToken, userAgent = '') {
  if (!rawRefreshToken) return null;
  
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const session = db.getRefreshToken(tokenHash);

  if (!session) {
    return null;
  }

  // Thu hồi (xóa) Refresh Token cũ
  db.deleteRefreshToken(tokenHash);

  const user = {
    id: session.user_id,
    username: session.username,
    full_name: session.full_name,
    role: session.role
  };

  // Cấp cặp Token mới
  const newTokens = createAuthTokens(user, userAgent);
  return { ...newTokens, user };
}

// Hủy Refresh Token khi Đăng xuất
function revokeRefreshToken(rawRefreshToken) {
  if (!rawRefreshToken) return;
  const tokenHash = hashRefreshToken(rawRefreshToken);
  db.deleteRefreshToken(tokenHash);
}

// Middleware xác thực Access Token (JWT) cho Web Dashboard
function verifySessionMiddleware(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.access_token) {
    token = req.cookies.access_token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Vui lòng đăng nhập' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'TokenExpired', message: 'Access Token đã hết hạn' });
    }
    return res.status(401).json({ error: 'Unauthorized', message: 'Token không hợp lệ' });
  }
}

// Middleware kiểm tra quyền (RBAC)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Bạn không có quyền thực hiện thao tác này' });
    }
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  initAdminUser,
  generateAccessToken,
  createAuthTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  verifySessionMiddleware,
  requireRole
};
