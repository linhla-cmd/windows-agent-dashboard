const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'windows-agent.sqlite');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  hostname TEXT,
  fqdn TEXT,
  domain TEXT,
  current_user TEXT,
  ipv4 TEXT,
  is_online INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER,
  first_seen INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  code TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  meta_json TEXT,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_device_id ON heartbeats(device_id);
CREATE INDEX IF NOT EXISTS idx_alerts_device_id_created_at ON alerts(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scan_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_tag TEXT NOT NULL,
  scanned_by TEXT,
  scan_source TEXT, -- 'MOBILE_SCAN' or 'MANUAL_INPUT'
  ip_address TEXT,
  device_info TEXT, -- Thông tin máy đang quét (model, os)
  scanned_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'Viewer' CHECK (role IN ('Admin','ITStaff','Auditor','Viewer','Operator')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`);

// Migration bổ sung trường người sử dụng cho các CSDL đã tồn tại.
try { db.exec('ALTER TABLE devices ADD COLUMN asset_user TEXT'); } catch (err) { if (!String(err.message).includes('duplicate column name')) throw err; }

const upsertDeviceStmt = db.prepare(`
INSERT INTO devices (device_id, hostname, fqdn, domain, current_user, ipv4, is_online, last_seen, first_seen, updated_at)
VALUES (@device_id, @hostname, @fqdn, @domain, @current_user, @ipv4, @is_online, @last_seen, COALESCE((SELECT first_seen FROM devices WHERE device_id = @device_id), @first_seen), @updated_at)
ON CONFLICT(device_id) DO UPDATE SET
  hostname=excluded.hostname,
  fqdn=excluded.fqdn,
  domain=excluded.domain,
  current_user=excluded.current_user,
  ipv4=excluded.ipv4,
  is_online=excluded.is_online,
  last_seen=excluded.last_seen,
  updated_at=excluded.updated_at;
`);

const insertHeartbeatStmt = db.prepare(`
INSERT INTO heartbeats (device_id, received_at, payload_json)
VALUES (?, ?, ?)
`);

const insertAlertStmt = db.prepare(`
INSERT INTO alerts (device_id, code, level, message, created_at, meta_json)
VALUES (?, ?, ?, ?, ?, ?)
`);

function saveHeartbeat(payload, alerts = []) {
  const now = Date.now();
  // Accept both the legacy adapter-array format and the current scalar IPv4 format.
  const ipv4 = Array.isArray(payload.ipv4)
    ? JSON.stringify(payload.ipv4)
    : JSON.stringify(payload.ipv4 && typeof payload.ipv4 === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(payload.ipv4)
      ? [{ ip: payload.ipv4, gateway: '' }]
      : []);
  const currentUser = payload.current_user ? JSON.stringify(payload.current_user) : null;

  // Auto-populate model from payload.model if set
  if (payload.model) {
    try {
      db.prepare(`UPDATE devices SET model = COALESCE(model, ?) WHERE device_id = ?`).run(payload.model, payload.device_id);
    } catch(e) {}
  }

  const tx = db.transaction(() => {
    upsertDeviceStmt.run({
      device_id: payload.device_id,
      hostname: payload.hostname || null,
      fqdn: payload.fqdn || null,
      domain: payload.domain || null,
      current_user: currentUser,
      ipv4,
      is_online: 1,
      last_seen: now,
      first_seen: now,
      updated_at: now,
    });

    insertHeartbeatStmt.run(payload.device_id, now, JSON.stringify(payload));

    for (const alert of alerts) {
      insertAlertStmt.run(
        alert.device_id || payload.device_id,
        alert.code,
        alert.level,
        alert.message,
        Date.parse(alert.timestamp) || now,
        alert.meta ? JSON.stringify(alert.meta) : null
      );
    }
  });

  tx();
}

// Xóa thiết bị không gửi heartbeat trong 30 ngày khỏi danh sách tổng quan.
// ON DELETE CASCADE sẽ đồng thời dọn heartbeat và cảnh báo liên quan.
const DEVICE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
function deleteDevicesInactiveFor30Days(now = Date.now()) {
  const cutoff = now - DEVICE_RETENTION_MS;
  return db.prepare(`
    DELETE FROM devices
    WHERE last_seen IS NULL OR last_seen < ?
  `).run(cutoff);
}

function getDevices() {
  // Tự động làm sạch các thiết bị mất kết nối quá 30 ngày (30 * 24 * 3600 * 1000 ms)
  deleteDevicesInactiveFor30Days();

  return db.prepare(`
    SELECT device_id, hostname, fqdn, domain, current_user, ipv4, is_online, last_seen, first_seen, updated_at,
           asset_tag, model, department, monitor, printer, peripherals, asset_user, qr_printed, qr_printed_at
    FROM devices
    ORDER BY updated_at DESC
  `).all().map(row => ({
    ...row,
    current_user: row.current_user ? JSON.parse(row.current_user) : null,
    ipv4: row.ipv4 ? JSON.parse(row.ipv4) : [],
    is_online: !!row.is_online,
  }));
}

function updateDeviceMetadata(deviceId, metadata = {}) {
  return db.prepare(`
    UPDATE devices
    SET asset_tag = @asset_tag,
        model = @model,
        department = @department,
        monitor = @monitor,
        printer = @printer,
        peripherals = @peripherals,
        asset_user = @asset_user,
        updated_at = @updated_at
    WHERE device_id = @device_id
  `).run({
    device_id: deviceId,
    asset_tag: metadata.asset_tag || null,
    model: metadata.model || null,
    department: metadata.department || null,
    monitor: metadata.monitor || null,
    printer: metadata.printer || null,
    peripherals: metadata.peripherals || null,
    asset_user: metadata.asset_user || null,
    updated_at: Date.now()
  });
}

function getDeviceAlerts(deviceId, limit = 50) {
  return db.prepare(`
    SELECT device_id, code, level, message, created_at, meta_json
    FROM alerts
    WHERE device_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(deviceId, limit).map(row => ({
    device_id: row.device_id,
    code: row.code,
    level: row.level,
    message: row.message,
    timestamp: new Date(row.created_at).toISOString(),
    meta: row.meta_json ? JSON.parse(row.meta_json) : {},
  }));
}

function getRecentHeartbeats(limit = 100) {
  return db.prepare(`
    SELECT id, device_id, received_at, payload_json
    FROM heartbeats
    ORDER BY received_at DESC
    LIMIT ?
  `).all(limit).map(row => ({
    id: row.id,
    device_id: row.device_id,
    received_at: row.received_at,
    payload: JSON.parse(row.payload_json),
  }));
}

function getUsers() {
  return db.prepare('SELECT id, username, full_name, role, is_active, created_at, last_login FROM users ORDER BY username').all().map(u => ({ ...u, is_active: !!u.is_active }));
}
function getUserByUsername(username) { return db.prepare('SELECT * FROM users WHERE username = ?').get(username); }
function createUser(username, passwordHash, role = 'Viewer', fullName = '') {
  const now = Date.now();
  return db.prepare('INSERT INTO users (username,password_hash,full_name,role,created_at) VALUES (?,?,?,?,?)').run(username, passwordHash, fullName, role, now).lastInsertRowid;
}
function updateUserStatus(id, active) { return db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active ? 1 : 0, id); }
function deleteUser(id) { return db.prepare('DELETE FROM users WHERE id = ?').run(id); }
function updateUserPassword(id, passwordHash) { return db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id); }
function markLogin(id) { return db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), id); }
function createSession(token, userId, expiresAt) { return db.prepare('INSERT INTO sessions (token,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(token, userId, expiresAt, Date.now()); }
function getSession(token) { return db.prepare('SELECT s.*, u.username, u.full_name, u.role, u.is_active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.is_active=1').get(token, Date.now()); }
function deleteSession(token) { return db.prepare('DELETE FROM sessions WHERE token = ?').run(token); }

function createRefreshToken(tokenHash, userId, expiresAt, userAgent = '') {
  return db.prepare('INSERT INTO refresh_tokens (token_hash, user_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)').run(tokenHash, userId, expiresAt, Date.now(), userAgent);
}
function getRefreshToken(tokenHash) {
  return db.prepare('SELECT r.*, u.username, u.full_name, u.role, u.is_active FROM refresh_tokens r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires_at > ? AND u.is_active = 1').get(tokenHash, Date.now());
}
function deleteRefreshToken(tokenHash) {
  return db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
}
function deleteUserRefreshTokens(userId) {
  return db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
}

function saveScanLog(assetTag, scannedBy, scanSource, ipAddress, deviceInfo) {
  return db.prepare(
    'INSERT INTO scan_logs (asset_tag, scanned_by, scan_source, ip_address, device_info, scanned_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(assetTag, scannedBy || null, scanSource || 'MOBILE_SCAN', ipAddress || null, deviceInfo || null, Date.now());
}

function getScanLogs(limit = 100) {
  return db.prepare('SELECT * FROM scan_logs ORDER BY scanned_at DESC LIMIT ?').all(limit);
}
function deleteExpiredRefreshTokens() {
  return db.prepare('DELETE FROM refresh_tokens WHERE expires_at <= ?').run(Date.now());
}

function updateUserRole(id, role) { return db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id); }

function updateQRPrinted(deviceId, isPrinted = 1, timestamp = Date.now()) {
  return db.prepare(`
    UPDATE devices
    SET qr_printed = ?,
        qr_printed_at = ?,
        updated_at = ?
    WHERE device_id = ?
  `).run(isPrinted ? 1 : 0, isPrinted ? timestamp : null, Date.now(), deviceId);
}

module.exports = { updateQRPrinted, updateUserRole, db, saveHeartbeat, getDevices, deleteDevicesInactiveFor30Days, updateDeviceMetadata, getDeviceAlerts, getRecentHeartbeats, getUsers, getUserByUsername, createUser, updateUserStatus, deleteUser, updateUserPassword, markLogin, createSession, getSession, deleteSession, createRefreshToken, getRefreshToken, deleteRefreshToken, deleteUserRefreshTokens, deleteExpiredRefreshTokens, saveScanLog, getScanLogs, dbPath };