'use strict';
// How the sidebar lays its sessions out: grouped by folder, by date or not at
// all, and sorted by when they were last used, when they were made, or by name,
// either way round. No DOM and no state: the window loads this before its own
// scripts, the tests require it. The web chat and the phone app keep a copy of
// the same rules, so a person finds their sessions in the same order everywhere.
(function (root) {
  const GROUPS = ['folder', 'date', 'none'];
  const SORTS = ['updated', 'created', 'name'];
  const DEFAULT = Object.freeze({ group: 'folder', sort: 'updated', dir: 'desc' });

  // Each sort's natural way round: the newest first, names from A.
  const naturalDir = (sort) => (sort === 'name' ? 'asc' : 'desc');

  /** A saved choice, made whole: anything missing or unknown is the default. */
  function normalize(prefs) {
    const p = prefs && typeof prefs === 'object' ? prefs : {};
    const group = GROUPS.includes(p.group) ? p.group : DEFAULT.group;
    const sort = SORTS.includes(p.sort) ? p.sort : DEFAULT.sort;
    const dir = p.dir === 'asc' || p.dir === 'desc' ? p.dir : naturalDir(sort);
    return { group, sort, dir };
  }

  /** A choice changed by one field. A new sort starts its natural way round. */
  function choose(prefs, field, value) {
    const now = normalize(prefs);
    if (field === 'sort' && value !== now.sort) return normalize({ ...now, sort: value, dir: naturalDir(value) });
    return normalize({ ...now, [field]: value });
  }

  const BUCKETS = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'Older'];

  /** The day a time falls in, as a person says it, counted from midnight today. */
  function dateBucket(ms, now = Date.now()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const start = today.getTime();
    const day = 86400000;
    if (!Number.isFinite(ms) || ms >= start) return 'Today';
    if (ms >= start - day) return 'Yesterday';
    if (ms >= start - 7 * day) return 'Last 7 days';
    if (ms >= start - 30 * day) return 'Last 30 days';
    return 'Older';
  }

  const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
  const byName = (a, b) => (collator ? collator.compare(a, b) : String(a).localeCompare(String(b)));
  const time = (value) => {
    const n = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(n) ? n : 0;
  };

  /**
   * The groups to draw, in order, each with its sessions in order.
   *
   * `pick` reads a session: { updated, created, name, pinned, folder } where
   * folder(s) is { key, name } -- the key keeps apart two folders of one name.
   * Pinned sessions always come first, in a group of their own.
   *
   * Returns [{ key, name, kind: 'pinned' | 'folder' | 'date' | 'all', items }].
   */
  function arrange(items, prefs, pick, now = Date.now()) {
    const { group, sort, dir } = normalize(prefs);
    const sign = dir === 'asc' ? 1 : -1;
    const updated = (s) => time(pick.updated(s));
    const created = (s) => time(pick.created(s));
    const name = (s) => String(pick.name(s) || '');
    const compare = (a, b) => {
      let d = 0;
      if (sort === 'name') d = byName(name(a), name(b));
      else if (sort === 'created') d = created(a) - created(b);
      else d = updated(a) - updated(b);
      // Equal on the chosen key: the one used last comes first, whatever the order.
      return d * sign || updated(b) - updated(a);
    };
    const sorted = [...items].sort(compare);

    const groups = [];
    const pinned = sorted.filter((s) => pick.pinned(s));
    if (pinned.length) groups.push({ key: 'pinned', name: 'Pinned', kind: 'pinned', items: pinned });
    const rest = sorted.filter((s) => !pick.pinned(s));
    if (!rest.length) return groups;

    if (group === 'none') {
      groups.push({ key: 'all', name: 'Sessions', kind: 'all', items: rest });
      return groups;
    }

    if (group === 'date') {
      // The date the list is sorted by, or the last use when it is sorted by name.
      const at = sort === 'created' ? created : updated;
      const buckets = new Map();
      for (const s of rest) {
        const b = dateBucket(at(s), now);
        if (!buckets.has(b)) buckets.set(b, []);
        buckets.get(b).push(s);
      }
      const order = dir === 'asc' && sort !== 'name' ? [...BUCKETS].reverse() : BUCKETS;
      for (const b of order) {
        if (buckets.has(b)) groups.push({ key: `date:${b}`, name: b, kind: 'date', items: buckets.get(b) });
      }
      return groups;
    }

    // By folder. The sessions were pushed in order, so a folder sits where its
    // first session does: the one used last, made last, or -- sorted by name --
    // the folders themselves go by name.
    const folders = new Map();
    for (const s of rest) {
      const f = pick.folder(s);
      const key = `folder:${f.key}`;
      if (!folders.has(key)) folders.set(key, { key, name: f.name, kind: 'folder', items: [] });
      folders.get(key).items.push(s);
    }
    const list = [...folders.values()];
    if (sort === 'name') list.sort((a, b) => byName(a.name, b.name) * sign);
    return groups.concat(list);
  }

  /** What the order choice is called in the menu, for the sort it applies to. */
  function dirLabels(sort) {
    return sort === 'name'
      ? { asc: 'A to Z', desc: 'Z to A' }
      : { desc: 'Newest first', asc: 'Oldest first' };
  }

  const api = { GROUPS, SORTS, DEFAULT, normalize, choose, dateBucket, arrange, dirLabels, naturalDir };
  root.CF_SESSION_ORDER = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
