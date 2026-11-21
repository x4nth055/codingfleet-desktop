'use strict';
// The account's devices, one row per device. The server lists keys: every
// sign-in of the same laptop, and every time the same phone is linked again
// (signed out, reinstalled), leaves a key of its own. Keys of the same kind,
// platform and name are one device: it is shown once, as its newest key, and
// removing it signs out all of them. The CodingFleet mobile app does the same
// (src/lib/devices.ts).

const when = (value) => {
  const at = Date.parse(value || '');
  return Number.isFinite(at) ? at : 0;
};

// When the device was last seen: its last use, or its sign-in if never used.
const lastSeen = (device) => Math.max(when(device.last_used_at), when(device.created_at));

const deviceKey = (device) => [
  device.kind || '',
  device.platform || '',
  String(device.name || '').trim().replace(/\s+/g, ' ').toLowerCase(),
].join('\n');

// Which key stands for the device: the one in use here, then the one that is
// online, then the newest.
function better(a, b) {
  if (a.current !== b.current) return a.current ? a : b;
  if (a.online !== b.online) return a.online ? a : b;
  return lastSeen(b) > lastSeen(a) ? b : a;
}

/**
 * One entry per device, in the order the devices first appear. Each is its
 * chosen key, with `ids` (every key of the device, the chosen one first),
 * `online` if any key is, and the latest `last_used_at` of them all.
 * @param {Array<object>} list
 * @returns {Array<object>}
 */
function uniqueDevices(list) {
  const groups = new Map();
  for (const device of Array.isArray(list) ? list : []) {
    if (!device) continue;
    const key = deviceKey(device);
    const group = groups.get(key);
    if (group) group.push(device);
    else groups.set(key, [device]);
  }
  return [...groups.values()].map((keys) => {
    const chosen = keys.reduce(better);
    const used = keys.map((device) => device.last_used_at).filter((value) => when(value))
      .sort((a, b) => when(b) - when(a));
    return {
      ...chosen,
      online: keys.some((device) => device.online === true),
      last_used_at: used[0] || chosen.last_used_at || null,
      ids: [chosen.id, ...keys.filter((device) => device !== chosen).map((device) => device.id)],
    };
  });
}

module.exports = { uniqueDevices, deviceKey };
