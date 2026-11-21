'use strict';
// The account's devices, one row per device. The server now keeps one key per
// device (`hardware: true`: the app said which device it is), but keys from
// older apps, or made before that, are one per sign-in: the same laptop signed
// in three times, or the same phone linked again, has several. Those are
// matched by kind and name (and platform, when both say one, since the desktop
// app sent none before) and shown once, as their newest key; removing it signs
// out all of them. Two keys that each say which device they are on are always
// two devices, even with the same name. The CodingFleet mobile app does the
// same (src/lib/devices.ts).

const when = (value) => {
  const at = Date.parse(value || '');
  return Number.isFinite(at) ? at : 0;
};

// When the device was last seen: its last use, or its sign-in if never used.
const lastSeen = (device) => Math.max(when(device.last_used_at), when(device.created_at));

const sameName = (device) => String(device.name || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Which key stands for the device: the one in use here, then the one that is
// online, then the one that says which device it is, then the newest.
function better(a, b) {
  if (a.current !== b.current) return a.current ? a : b;
  if (a.online !== b.online) return a.online ? a : b;
  if (Boolean(a.hardware) !== Boolean(b.hardware)) return a.hardware ? a : b;
  return lastSeen(b) > lastSeen(a) ? b : a;
}

// Whether this key can be one more key of the group's device.
function belongs(group, device) {
  if (group.kind !== (device.kind || '') || group.name !== sameName(device)) return false;
  if (group.platform && device.platform && group.platform !== device.platform) return false;
  return !(device.hardware && group.hardware);
}

/**
 * One entry per device, in the order the devices first appear. Each is its
 * chosen key, with `ids` (every key of the device, the chosen one first),
 * `online` if any key is, and the latest `last_used_at` of them all.
 * @param {Array<object>} list
 * @returns {Array<object>}
 */
function uniqueDevices(list) {
  const groups = [];
  for (const device of Array.isArray(list) ? list : []) {
    if (!device) continue;
    const group = groups.find((entry) => belongs(entry, device));
    if (group) {
      group.keys.push(device);
      group.platform = group.platform || device.platform || '';
      group.hardware = group.hardware || Boolean(device.hardware);
    } else {
      groups.push({
        kind: device.kind || '', name: sameName(device), platform: device.platform || '',
        hardware: Boolean(device.hardware), keys: [device],
      });
    }
  }
  return groups.map(({ keys }) => {
    const chosen = keys.reduce(better);
    const used = keys.map((device) => device.last_used_at).filter((value) => when(value))
      .sort((a, b) => when(b) - when(a));
    return {
      ...chosen,
      // A key from before platforms (the desktop app's) takes the one its newer keys say.
      platform: chosen.platform || (keys.find((device) => device.platform) || {}).platform || null,
      online: keys.some((device) => device.online === true),
      last_used_at: used[0] || chosen.last_used_at || null,
      ids: [chosen.id, ...keys.filter((device) => device !== chosen).map((device) => device.id)],
    };
  });
}

module.exports = { uniqueDevices };
