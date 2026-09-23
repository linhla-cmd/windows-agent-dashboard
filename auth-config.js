// /home/openclaw/collector/auth-config.js
// Quản lý token xác thực cho Collector

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const configDir = path.join(__dirname, 'config');
const tokenFile = path.join(configDir, 'tokens.json');

if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Tạo token ngẫu nhiên (32 bytes = 64 ký tự hex)
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Lấy danh sách token hiện tại
function getTokens() {
  if (!fs.existsSync(tokenFile)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
  } catch (err) {
    return {};
  }
}

// Lưu danh sách token
function saveTokens(tokens) {
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), 'utf-8');
}

// Tạo token mới
function createToken(deviceName = 'default') {
  const token = generateToken();
  const tokens = getTokens();
  
  tokens[token] = {
    name: deviceName,
    created_at: new Date().toISOString(),
    last_used: null,
    request_count: 0
  };
  
  saveTokens(tokens);
  return token;
}

// Xác thực token
function verifyToken(token) {
  const tokens = getTokens();
  
  if (!tokens[token]) {
    return { valid: false, error: 'Token không tồn tại hoặc hết hạn' };
  }
  
  // Update lần sử dụng cuối
  tokens[token].last_used = new Date().toISOString();
  tokens[token].request_count = (tokens[token].request_count || 0) + 1;
  saveTokens(tokens);
  
  return { valid: true, metadata: tokens[token] };
}

// Xóa token
function deleteToken(token) {
  const tokens = getTokens();
  delete tokens[token];
  saveTokens(tokens);
}

// Lấy danh sách tất cả token (không hiển thị token đầy đủ vì bảo mật)
function listTokens() {
  const tokens = getTokens();
  return Object.entries(tokens).map(([token, info]) => ({
    token_preview: token.substring(0, 8) + '...' + token.substring(-8),
    ...info
  }));
}

// Khởi tạo token mặc định nếu chưa có, hoặc lấy token đầu tiên
function initializeDefaultToken() {
  const tokens = getTokens();
  const tokenList = Object.keys(tokens);
  
  if (tokenList.length === 0) {
    // Tạo token mới nếu chưa có
    const defaultToken = createToken('default-agent');
    console.log(`\n✅ Token mặc định được tạo: ${defaultToken}`);
    console.log(`📝 Lưu token này vào biến $WEBHOOK_TOKEN trong script PowerShell\n`);
    return defaultToken;
  } else {
    // Lấy token đầu tiên nếu đã tồn tại
    const firstToken = tokenList[0];
    console.log(`\n✅ Sử dụng token hiện có: ${firstToken}`);
    console.log(`📝 Token này được lưu tại: ${tokenFile}\n`);
    return firstToken;
  }
}

module.exports = {
  generateToken,
  getTokens,
  saveTokens,
  createToken,
  verifyToken,
  deleteToken,
  listTokens,
  initializeDefaultToken
};