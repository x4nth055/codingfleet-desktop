'use strict';
// Which computer this is, for the account's device list: the server keeps one
// key per device, so this laptop signed in again replaces its old key instead
// of being listed twice (codingfleet: assistant/api/device_identity.py).
//
// The id is the operating system's own machine id (Windows: MachineGuid,
// macOS: IOPlatformUUID, Linux: /etc/machine-id), which stays the same across
// reinstalls of the app and across accounts of the computer. What leaves this
// computer is only a hash of it, made for CodingFleet: the machine id itself is
// never sent, and the hash says nothing to anyone else who knows it. With no
// machine id to read, a random id is kept in the app's state instead.
const crypto = require('crypto');
const fs = require('fs');
const { execFile } = require('child_process');

const SALT = 'codingfleet-device-v1';

const hash = (value) => crypto.createHash('sha256').update(`${SALT}\n${value}`).digest('base64url');

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

// The machine id, or '' when it cannot be read.
async function machineId(platform = process.platform) {
  if (platform === 'win32') {
    // reg.exe from System32: never a reg.exe some folder on the PATH holds.
    const reg = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\reg.exe`;
    const out = await run(reg, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
    const match = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{20,})/.exec(out);
    return match ? match[1].toLowerCase() : '';
  }
  if (platform === 'darwin') {
    const out = await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    const match = /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{20,})"/.exec(out);
    return match ? match[1].toLowerCase() : '';
  }
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const text = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{16,}$/i.test(text)) return text.toLowerCase();
    } catch { /* the next one */ }
  }
  return '';
}

/**
 * This computer's device id for the server: 43 URL-safe characters.
 * @param {{ getState: () => object, saveState: () => void, read?: () => Promise<string> }} o
 */
function createDeviceId({ getState, saveState, read = machineId }) {
  let pending = null;
  return function deviceId() {
    if (!pending) {
      pending = (async () => {
        const id = await read().catch(() => '');
        if (id) return hash(`machine:${id}`);
        const state = getState();
        if (typeof state.deviceSeed !== 'string' || !/^[A-Za-z0-9_-]{22,}$/.test(state.deviceSeed)) {
          state.deviceSeed = crypto.randomBytes(24).toString('base64url');
          saveState();
        }
        return hash(`seed:${state.deviceSeed}`);
      })();
    }
    return pending;
  };
}

module.exports = { createDeviceId, machineId, hash };
