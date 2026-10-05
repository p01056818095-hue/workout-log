// 핸드폰 저장소 (설계 2026-10-05 5.2, 7.2): 연결 정보, 루틴 사본, 서버 사본, 보낼 목록.
// localStorage에 JSON으로 둔다. 망가진 값은 빈 값으로 보고, 저장 공간이 꽉 차면 false를 돌려준다.

const KEYS = { config: "wl.config", routine: "wl.routine", mirror: "wl.mirror", outbox: "wl.outbox", last: "wl.lastSync" };
const MIRROR_LIMIT = 3_000_000; // 넘으면 90일보다 오래된 날짜를 핸드폰 사본에서 뺀다
const KEEP_DAYS = 90;

export function createStore(storage, Merge) {
  const read = (key, fallback) => {
    try {
      const text = storage.getItem(key);
      if (text === null) return fallback;
      const value = JSON.parse(text);
      return value === null || typeof value !== "object" ? fallback : value;
    } catch (e) {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  };

  const getMirror = () => {
    const m = read(KEYS.mirror, null);
    return m && typeof m.entries === "object" && m.entries ? { cursor: Number(m.cursor) || 0, entries: m.entries } :
      { cursor: 0, entries: {} };
  };
  const getOutbox = () => {
    const o = read(KEYS.outbox, []);
    return Array.isArray(o) ? o : [];
  };

  function trimMirror(mirror) {
    if (JSON.stringify(mirror).length <= MIRROR_LIMIT) return mirror;
    const keep = new Set(getOutbox().map((i) => i.date));
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    for (const date of Object.keys(mirror.entries)) {
      if (date < cutoff && !keep.has(date)) delete mirror.entries[date];
    }
    return mirror;
  }

  function dayView(date) {
    const entry = getMirror().entries[date] || { parts: {}, order: [] };
    let parts = entry.parts, order = entry.order;
    for (const item of getOutbox()) {
      if (item.date !== date) continue;
      const merged = Merge.mergeParts(parts, order, item.parts);
      parts = merged.parts;
      order = merged.order;
    }
    return Merge.joinParts(parts, order);
  }

  function allDates() {
    const dates = new Set(Object.keys(getMirror().entries));
    for (const item of getOutbox()) dates.add(item.date);
    return [...dates].sort();
  }

  return {
    getConfig: () => read(KEYS.config, null),
    setConfig: (cfg) => write(KEYS.config, cfg),
    getRoutine: () => read(KEYS.routine, null),
    setRoutine: (r) => write(KEYS.routine, r),
    getLastSync: () => read(KEYS.last, null),
    setLastSync: (v) => write(KEYS.last, v),
    getMirror,
    getOutbox,
    addToOutbox(item) {
      return write(KEYS.outbox, [...getOutbox(), item]);
    },
    removeAccepted(ids) {
      const drop = new Set(ids);
      return write(KEYS.outbox, getOutbox().filter((i) => !drop.has(i.id)));
    },
    // 서버에서 받은 날짜: 변경번호가 같거나 더 큰 것만 바꾼다. 바뀐 날짜 목록을 돌려준다.
    applyServerEntries(entries, rev) {
      const mirror = getMirror();
      const changed = [];
      for (const e of entries || []) {
        const old = mirror.entries[e.date];
        if (!old || e.rev >= old.rev) {
          if (!old || !Merge.deepEqual(old.parts, e.parts)) changed.push(e.date);
          mirror.entries[e.date] = { rev: e.rev, parts: e.parts, order: e.order };
        }
      }
      if (typeof rev === "number") mirror.cursor = Math.max(mirror.cursor, rev);
      write(KEYS.mirror, trimMirror(mirror));
      return changed;
    },
    dayView,
    allRecords() {
      return allDates().flatMap((d) => dayView(d).rows);
    },
    allInbody() {
      return allDates().map((d) => dayView(d).inbody).filter(Boolean);
    },
  };
}
