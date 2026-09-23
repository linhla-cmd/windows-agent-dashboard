// Rule Engine for Windows Agent
// Processes heartbeats and evaluates alert rules

class RuleEngine {
  constructor(options = {}) {
    this.diskThreshold = options.diskThreshold || 90; // percent
    this.heartbeatTimeout = options.heartbeatTimeout || 300; // seconds (5 minutes)
    this.devices = new Map(); // device_id -> device state
  }

  // Process incoming heartbeat
  processHeartbeat(payload) {
    const deviceId = payload.device_id;
    const now = Date.now();

    // Get or create device state
    let device = this.devices.get(deviceId);
    if (!device) {
      device = {
        id: deviceId,
        first_seen: now,
        last_seen: now,
        alerts: [],
        previous: null
      };
      this.devices.set(deviceId, device);
    }

    // Check for alerts
    const alerts = this._checkRules(device, payload, now);

    // Update device state
    device.previous = { ...device.current };
    device.current = payload;
    device.last_seen = now;

    // Return alerts to be sent
    return alerts;
  }

  // Check all rules
  _checkRules(device, payload, now) {
    const alerts = [];

    // Rule 1: Offline detection (handled externally by checking last_seen)
    // Rule 2: Defender/Firewall OFF
    if (payload.security) {
      if (!payload.security.defender) {
        alerts.push(this._createAlert('WARNING', 'DEFENDER_OFF', 'Windows Defender is disabled', device, payload));
      }
      if (!payload.security.firewall) {
        alerts.push(this._createAlert('WARNING', 'FIREWALL_OFF', 'Windows Firewall is disabled', device, payload));
      }
    }

    // Rule 3: Disk capacity > threshold
    if (payload.disks && Array.isArray(payload.disks)) {
      for (const disk of payload.disks) {
        if (disk.used_percent >= this.diskThreshold) {
          alerts.push(this._createAlert('CRITICAL', 'DISK_FULL', 
            `Disk ${disk.device_id} at ${disk.used_percent}% (threshold: ${this.diskThreshold}%)`,
            device, payload, { disk }));
        }
      }
    }

    // Rule 4: Identity drift (hostname, IPv4, user/domain changed)
    if (device.previous) {
      const prev = device.previous;

      if (prev.hostname !== payload.hostname) {
        alerts.push(this._createAlert('WARNING', 'HOSTNAME_CHANGED', 
          `Hostname changed from ${prev.hostname} to ${payload.hostname}`, device, payload));
      }

      if (prev.fqdn !== payload.fqdn) {
        alerts.push(this._createAlert('WARNING', 'FQDN_CHANGED', 
          `FQDN changed from ${prev.fqdn} to ${payload.fqdn}`, device, payload));
      }

      if (prev.domain !== payload.domain) {
        alerts.push(this._createAlert('WARNING', 'DOMAIN_CHANGED', 
          `Domain changed from ${prev.domain} to ${payload.domain}`, device, payload));
      }

      // Check IPv4 changes (compare first IPv4)
      const prevIp = prev.ipv4?.[0]?.ip;
      const currIp = payload.ipv4?.[0]?.ip;
      if (prevIp && currIp && prevIp !== currIp) {
        alerts.push(this._createAlert('WARNING', 'IP_CHANGED', 
          `Primary IP changed from ${prevIp} to ${currIp}`, device, payload));
      }

      // Check user/domain changes
      const prevUser = prev.current_user?.username;
      const currUser = payload.current_user?.username;
      const prevUserDomain = prev.current_user?.domain;
      const currUserDomain = payload.current_user?.domain;
      if (prevUser !== currUser || prevUserDomain !== currUserDomain) {
        alerts.push(this._createAlert('INFO', 'USER_CHANGED', 
          `User changed from ${prevUser}@${prevUserDomain} to ${currUser}@${currUserDomain}`, device, payload));
      }
    }

    // Rule 5: Sudden boot/shutdown (if we have boot event data)
    if (payload.power && payload.power.last_boot_event) {
      // Could track unexpected reboots here
    }

    return alerts;
  }

  // Check for offline devices
  checkOfflineDevices() {
    const now = Date.now();
    const offlineDevices = [];

    for (const [deviceId, device] of this.devices.entries()) {
      const secondsSinceLastSeen = (now - device.last_seen) / 1000;
      if (secondsSinceLastSeen > this.heartbeatTimeout) {
        if (!device.is_offline) {
          device.is_offline = true;
          offlineDevices.push({
            deviceId,
            last_seen: device.last_seen,
            seconds_offline: secondsSinceLastSeen,
            alert: this._createAlert('CRITICAL', 'DEVICE_OFFLINE', 
              `Device offline for ${Math.floor(secondsSinceLastSeen)} seconds`, device, device.current)
          });
        }
      } else {
        if (device.is_offline) {
          device.is_offline = false;
          offlineDevices.push({
            deviceId,
            alert: this._createAlert('INFO', 'DEVICE_ONLINE', 
              `Device came back online`, device, device.current)
          });
        }
      }
    }

    return offlineDevices;
  }

  _createAlert(level, code, message, device, payload, meta = {}) {
    return {
      id: `${device.id}-${code}-${Date.now()}`,
      device_id: device.id,
      hostname: payload.hostname,
      level, // INFO, WARNING, CRITICAL
      code,
      message,
      timestamp: new Date().toISOString(),
      meta
    };
  }

  // Get all devices for dashboard
  getAllDevices() {
    const now = Date.now();
    const result = [];
    for (const [deviceId, device] of this.devices.entries()) {
      const secondsSinceLastSeen = (now - device.last_seen) / 1000;
      result.push({
        device_id: deviceId,
        hostname: device.current?.hostname,
        fqdn: device.current?.fqdn,
        domain: device.current?.domain,
        current_user: device.current?.current_user,
        ipv4: device.current?.ipv4?.[0]?.ip,
        last_seen: device.last_seen,
        seconds_since_last_seen: secondsSinceLastSeen,
        is_online: secondsSinceLastSeen <= this.heartbeatTimeout,
        security: device.current?.security,
        disks: device.current?.disks,
        uptime_seconds: device.current?.uptime_seconds
      });
    }
    return result;
  }

  // Get alerts for a device
  getAlerts(deviceId, limit = 50) {
    const device = this.devices.get(deviceId);
    if (!device) return [];
    return device.alerts.slice(-limit);
  }
}

module.exports = { RuleEngine };