// 하루 기록을 조각으로 나누고 합치는 규칙 (설계 2026-10-05 4~5장).
// app/core/parts.py와 같은 규칙이다. 두 쪽은 tests/fixtures/merge_cases.json으로 같이 검사한다.
// 앱스 스크립트는 모듈을 못 쓰므로 전역 함수로 두고, node 검사용으로만 module.exports를 붙인다.
// 핸드폰은 일반 <script>로 불러와 window.Merge로 쓴다.
//
// 조각 값: {rows: 줄 목록 또는 null(지움 표시), t: 저장 시각(밀리초), w: 기본값인지, by: "phone"|"pc"}

var RECORD_COLUMNS = ["날짜", "주차", "요일", "구분", "종류", "항목", "세트", "목표무게", "목표횟수", "실제무게",
  "실제횟수", "시간(분)", "거리(km)", "완료", "kcal", "단백질(g)", "메모"];
var INBODY_COLUMNS = ["날짜", "주차", "체중", "골격근량", "체지방량", "체지방률", "기초대사량", "메모"];
var ROW_COLUMNS = RECORD_COLUMNS.filter(function (c) { return c !== "주차"; });
var INBODY_ROW_COLUMNS = INBODY_COLUMNS.filter(function (c) { return c !== "주차"; });
var KIND_ORDER = ["체중", "운동", "유산소", "식단", "메모"];
var MEAL_ORDER = ["아침", "출근길", "점심", "간식", "저녁"];
var INBODY_KEY = "인바디";

function normalizeName(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim().split(/\s+/).filter(Boolean).join(" ");
}

function cleanValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    var s = v.trim();
    return s === "" ? null : s;
  }
  return v;
}

function partKey(row) {
  return row["종류"] + "|" + normalizeName(row["항목"]);
}

function cleanRow(row) {
  var out = {};
  ROW_COLUMNS.forEach(function (c) { out[c] = cleanValue(row[c]); });
  if (out["항목"] !== null) out["항목"] = normalizeName(out["항목"]);
  return out;
}

function cleanInbody(row) {
  var out = {};
  INBODY_ROW_COLUMNS.forEach(function (c) { out[c] = cleanValue(row[c]); });
  return out;
}

function splitDay(rows, inbody) {
  var result = {};
  (rows || []).forEach(function (r) {
    var c = cleanRow(r);
    var key = partKey(c);
    if (!result[key]) result[key] = [];
    result[key].push(c);
  });
  Object.keys(result).forEach(function (key) {
    if (key.indexOf("운동|") === 0) {
      result[key].sort(function (a, b) {
        var x = a["세트"] === null ? Infinity : a["세트"];
        var y = b["세트"] === null ? Infinity : b["세트"];
        return x - y;
      });
    }
  });
  if (inbody) result[INBODY_KEY] = [cleanInbody(inbody)];
  return result;
}

function sortKey(key, order) {
  if (key === INBODY_KEY) return [KIND_ORDER.length + 1, 0, 0];
  var bar = key.indexOf("|");
  var kind = bar < 0 ? key : key.slice(0, bar);
  var item = bar < 0 ? "" : key.slice(bar + 1);
  var k = KIND_ORDER.indexOf(kind);
  if (k < 0) k = KIND_ORDER.length;
  var sub = 0;
  if (kind === "식단") {
    sub = MEAL_ORDER.indexOf(item);
    if (sub < 0) sub = MEAL_ORDER.length;
  }
  var pos = order.indexOf(key);
  if (pos < 0) pos = order.length;
  return [k, sub, pos];
}

function compareKeys(a, b) {
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function joinParts(parts, order) {
  var rows = [];
  var inbody = null;
  var keys = Object.keys(parts).sort(function (a, b) {
    return compareKeys(sortKey(a, order), sortKey(b, order));
  });
  keys.forEach(function (key) {
    var value = parts[key].rows;
    if (value === null || value === undefined) return;
    if (key === INBODY_KEY) {
      inbody = value.length ? Object.assign({}, value[0]) : null;
    } else {
      value.forEach(function (r) { rows.push(Object.assign({}, r)); });
    }
  });
  return { rows: rows, inbody: inbody };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  var ka = Object.keys(a);
  var kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !deepEqual(a[ka[i]], b[ka[i]])) return false;
  }
  return true;
}

function diffParts(initial, final, t, by) {
  var out = {};
  Object.keys(final).forEach(function (key) {
    var weak = !!initial && Object.prototype.hasOwnProperty.call(initial, key) && deepEqual(initial[key], final[key]);
    out[key] = { rows: final[key], t: t, w: weak, by: by };
  });
  Object.keys(initial || {}).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(final, key)) out[key] = { rows: null, t: t, w: false, by: by };
  });
  return out;
}

function accept(old, value) {
  if (old === null || old === undefined) return true;
  if (old.w && !value.w) return true;
  return old.w === value.w && value.t > old.t;
}

function mergeParts(parts, order, incoming) {
  var out = Object.assign({}, parts);
  var newOrder = order.slice();
  var changed = [];
  Object.keys(incoming).forEach(function (key) {
    var value = incoming[key];
    if (accept(out[key], value)) {
      if (!deepEqual(out[key], value)) changed.push(key);
      out[key] = value;
      if (newOrder.indexOf(key) < 0) newOrder.push(key);
    }
  });
  return { parts: out, order: newOrder, changed: changed };
}

var Merge = {
  RECORD_COLUMNS: RECORD_COLUMNS, INBODY_COLUMNS: INBODY_COLUMNS, ROW_COLUMNS: ROW_COLUMNS,
  INBODY_ROW_COLUMNS: INBODY_ROW_COLUMNS, KIND_ORDER: KIND_ORDER, MEAL_ORDER: MEAL_ORDER, INBODY_KEY: INBODY_KEY,
  normalizeName: normalizeName, partKey: partKey, cleanRow: cleanRow, cleanInbody: cleanInbody, splitDay: splitDay,
  joinParts: joinParts, diffParts: diffParts, accept: accept, mergeParts: mergeParts, deepEqual: deepEqual,
};
if (typeof module !== "undefined" && module.exports) module.exports = Merge;
if (typeof window !== "undefined") window.Merge = Merge;
