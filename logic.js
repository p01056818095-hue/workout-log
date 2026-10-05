// 핸드폰 계산: 오늘 할 일, 저장값 불러오기, 저장 줄 만들기, 7일 평균, 주간 요약 (DOM 없음).
// PC의 app/core/schedule.py·screen.py·records.build_rows·stats.py와 같은 결과를 낸다.
// tests/phone_fixtures.py가 만든 예시로 phone/tests/logic.test.mjs에서 비교 검사한다.

export const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
export const MEAL_ORDER = ["아침", "출근길", "점심", "간식", "저녁"];
export const BODYWEIGHT = "맨몸";
export const OTHER_MENU = "기타(직접 입력)";
export const DAY_START_HOUR = 4;
export const PHASE_PREP = "준비";
export const PHASE_DELOAD = "회복";
export const PHASE_NORMAL = "일반";
export const NOT_IN_ROUTINE = "지금 루틴에 없는 운동 (기록에서 불러옴)";
export const PREP_NOTICE = "준비 주: 목표 무게까지 몇 단계로 올려 보고, 마지막 세트는 할 수 있는 만큼(목표 + 5회까지) 하고 " +
  "실제 횟수를 적으세요";
export const DELOAD_NOTICE = "회복주: 세트 절반, 무게는 그대로";
export const NO_START_NOTICE = "설정 시트의 시작일이 비어 있거나 날짜가 아니라서 주차 없이 보여줘요.";
export const RECORD_COLUMNS = ["날짜", "주차", "요일", "구분", "종류", "항목", "세트", "목표무게", "목표횟수", "실제무게",
  "실제횟수", "시간(분)", "거리(km)", "완료", "kcal", "단백질(g)", "메모"];

// ---------- 날짜 (YYYY-MM-DD 글자로 다룬다) ----------

const pad = (n) => String(n).padStart(2, "0");
const toUtc = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const addDays = (iso, n) => fromUtc(toUtc(iso) + n * 86400000);
export const diffDays = (a, b) => Math.round((toUtc(a) - toUtc(b)) / 86400000);
export const weekdayIndex = (iso) => (new Date(toUtc(iso)).getUTCDay() + 6) % 7;

export function logicalToday(now = new Date()) {
  const d = new Date(now.getTime() - DAY_START_HOUR * 3600000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const dayName = (iso) => DAYS[weekdayIndex(iso)];

export function formatDate(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}(${dayName(iso)})`;
}

export function weekNumber(iso, startIso) {
  if (!startIso) return null;
  return Math.floor(diffDays(iso, startIso) / 7) + 1;
}

export function weekDates(iso) {
  const monday = addDays(iso, -weekdayIndex(iso));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function phaseOf(week, config) {
  if (week !== null && week <= 0) return PHASE_PREP;
  if (week !== null && (config.deload_weeks || []).includes(week)) return PHASE_DELOAD;
  return PHASE_NORMAL;
}

export const deloadSets = (sets) => Math.ceil(sets / 2);

export function formatNumber(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(6)));
}

// 숫자 칸 읽기 (PC widgets.parse_number·parse_count와 같음): 비면 null, 숫자가 아니거나 음수면 오류
export function parseNumber(s) {
  const t = String(s ?? "").trim().replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0 || !/^[0-9.eE+-]+$/.test(t)) throw new Error("숫자가 아니에요");
  return v;
}

export function parseCount(s) {
  const v = parseNumber(s);
  if (v === null) return null;
  if (!Number.isInteger(v)) throw new Error("정수가 아니에요");
  return v;
}

export const normalizeName = (v) => (v === null || v === undefined ? "" : String(v).trim().split(/\s+/).filter(Boolean).join(" "));

// ---------- 오늘 할 일 ----------

function planned(name, targetWeight, targetReps, sets, minutes = null, distance = null, memo = "") {
  const isCardio = targetWeight === null && targetReps === null;
  const bodyweight = targetWeight === BODYWEIGHT;
  let summary;
  if (isCardio) {
    const parts = [];
    if (distance !== null) parts.push(`${formatNumber(distance)}km`);
    if (minutes !== null) parts.push(`${minutes}분`);
    summary = parts.join(" · ");
  } else {
    const head = bodyweight ? BODYWEIGHT : `${formatNumber(targetWeight)}kg`;
    summary = `${head} × ${targetReps}회 × ${sets}세트`;
  }
  return { name, target_weight: targetWeight, target_reps: targetReps, sets, minutes, distance, memo,
    is_cardio: isCardio, bodyweight, summary };
}

const routineCardio = (e) => e.weight === null && !e.bodyweight && e.reps === null;

export function exercisesFor(routine, day) {
  return routine.exercises.filter((e) => e.day === day);
}

export function mealSlots(routine, day) {
  const meals = routine.meals.filter((m) => m.day === day);
  const slots = [];
  for (const name of MEAL_ORDER) {
    const rows = meals.filter((m) => m.meal === name);
    if (!rows.length && name !== "저녁") continue;
    const options = [];
    const seen = new Set();
    for (const m of rows) {
      if (!seen.has(m.menu)) { options.push([m.menu, m.kcal, m.protein]); seen.add(m.menu); }
    }
    if (name === "저녁") {
      for (const o of routine.dinners) {
        if (!seen.has(o.menu)) { options.push([o.menu, o.kcal, o.protein]); seen.add(o.menu); }
      }
    }
    slots.push({ meal: name, options, memo: rows.length ? rows[0].memo : "" });
  }
  return slots;
}

export function buildDayPlan(routine, iso) {
  const cfg = routine.config;
  const week = weekNumber(iso, cfg.start_date);
  const day = dayName(iso);
  const phase = phaseOf(week, cfg);
  const deload = phase === PHASE_DELOAD;
  const exercises = exercisesFor(routine, day).map((e) => {
    let sets = e.sets || 1;
    if (deload && !routineCardio(e)) sets = deloadSets(sets);
    return planned(e.name, e.bodyweight ? BODYWEIGHT : e.weight, e.reps, sets, e.minutes, e.distance, e.memo);
  });
  const title = (cfg.day_names || {})[day] || (exercises.length ? `운동 ${exercises.length}개` : "휴식");
  const notices = [];
  if (!cfg.start_date) notices.push(NO_START_NOTICE);
  if (phase === PHASE_PREP && week === 0 && exercises.length) notices.push(PREP_NOTICE);
  if (deload) notices.push(DELOAD_NOTICE);
  const isInbodyWeek = week !== null && (cfg.inbody_weeks || []).includes(week);
  let weekText = "";
  if (week !== null) weekText = week < 0 ? " · 시작 전" : ` · ${week}주차`;
  return { date: iso, week, day, title, phase, notices, is_inbody_week: isInbodyWeek, is_sunday: day === "일",
    header: `${formatDate(iso)}${weekText} · ${title}`, exercises, meals: mealSlots(routine, day) };
}

// ---------- 저장값 불러오기 (screen.py) ----------

export function exerciseItems(plan, dayRows) {
  const recorded = new Map();
  const cardio = new Map();
  for (const r of dayRows) {
    const name = normalizeName(r.항목);
    if (r.종류 === "운동" && r.세트) {
      if (!recorded.has(name)) recorded.set(name, []);
      recorded.get(name).push(r);
    } else if (r.종류 === "유산소") {
      cardio.set(name, r);
    }
  }
  const items = [];
  const seen = new Set();
  const fromRecord = (name, rows, memo = "") => {
    const sorted = [...rows].sort((a, b) => a.세트 - b.세트);
    const p = planned(name, sorted[0].목표무게, sorted[0].목표횟수, sorted.length, null, null, memo);
    const state = {};
    for (const r of sorted) state[String(Math.trunc(r.세트))] = [r.완료 === "O", r.실제무게, r.실제횟수];
    return { kind: "exercise", planned: p, prefill: state };
  };
  for (const p of plan.exercises) {
    seen.add(p.name);
    if (p.is_cardio) {
      const c = cardio.get(p.name);
      items.push({ kind: "cardio", planned: p, prefill: c ? [true, c["시간(분)"], c["거리(km)"]] : null });
    } else if (recorded.has(p.name)) {
      items.push(fromRecord(p.name, recorded.get(p.name), p.memo));
    } else {
      items.push({ kind: "exercise", planned: p, prefill: null });
    }
  }
  for (const [name, rows] of recorded) {
    if (!seen.has(name)) items.push(fromRecord(name, rows, NOT_IN_ROUTINE));
  }
  for (const [name, c] of cardio) {
    if (!seen.has(name)) {
      items.push({ kind: "cardio", planned: planned(name, null, null, 1, c["시간(분)"], c["거리(km)"]),
        prefill: [true, c["시간(분)"], c["거리(km)"]] });
    }
  }
  return items;
}

// {끼니: [완료, 메뉴, kcal, 단백질, 기타인지]}
export function mealPrefill(plan, dayRows) {
  const result = {};
  for (const r of dayRows) {
    if (r.종류 !== "식단") continue;
    const menu = r.메모, kcal = r.kcal, protein = r["단백질(g)"];
    if (r.완료 === "O") {
      result[r.항목] = [true, menu, kcal, protein, false];
    } else if (kcal !== null || protein !== null) {
      result[r.항목] = [true, menu, kcal, protein, true];
    } else if (menu) {
      const slot = plan.meals.find((s) => s.meal === r.항목);
      const known = !!slot && slot.options.some((o) => o[0] === menu);
      result[r.항목] = known ? [false, menu, null, null, false] : [true, menu, null, null, true];
    }
  }
  return result;
}

// ---------- 저장 줄 (records.build_rows) ----------

function makeRow(values) {
  const row = {};
  for (const c of RECORD_COLUMNS) row[c] = values[c] === undefined ? null : values[c];
  return row;
}

export function buildRows(entry) {
  const base = { 날짜: entry.date, 주차: entry.week, 요일: entry.weekday, 구분: entry.phase };
  const rows = [];
  if (entry.weight !== null && entry.weight !== undefined) {
    rows.push(makeRow({ ...base, 종류: "체중", 항목: "아침 체중", 실제무게: entry.weight, 완료: "O" }));
  }
  for (const ex of entry.exercises || []) {
    if (!ex.sets.some((s) => s.done)) continue;
    ex.sets.forEach((s, i) => {
      const actualW = s.done ? (ex.target_weight === BODYWEIGHT ? BODYWEIGHT : s.weight) : null;
      rows.push(makeRow({ ...base, 종류: "운동", 항목: ex.name, 세트: i + 1, 목표무게: ex.target_weight,
        목표횟수: ex.target_reps, 실제무게: actualW, 실제횟수: s.done ? s.reps : null, 완료: s.done ? "O" : "X" }));
    });
  }
  for (const c of entry.cardio || []) {
    if (c.done) rows.push(makeRow({ ...base, 종류: "유산소", 항목: c.name, 완료: "O", "시간(분)": c.minutes, "거리(km)": c.distance }));
  }
  for (const m of entry.meals || []) {
    if (m.other) {
      if (m.done) {
        rows.push(makeRow({ ...base, 종류: "식단", 항목: m.meal, 완료: "X", kcal: m.kcal, "단백질(g)": m.protein, 메모: m.menu || null }));
      } else {
        rows.push(makeRow({ ...base, 종류: "식단", 항목: m.meal, 완료: "X" }));
      }
    } else if (m.done) {
      rows.push(makeRow({ ...base, 종류: "식단", 항목: m.meal, 완료: "O", kcal: m.kcal, "단백질(g)": m.protein, 메모: m.menu }));
    } else {
      rows.push(makeRow({ ...base, 종류: "식단", 항목: m.meal, 완료: "X", 메모: m.menu }));
    }
  }
  const memo = (entry.memo || "").trim();
  if (memo) rows.push(makeRow({ ...base, 종류: "메모", 항목: "메모", 메모: memo }));
  return rows;
}

// ---------- 통계 (stats.py) ----------

const round2 = (v) => Math.round(v * 100) / 100;
const mean = (vals) => vals.reduce((a, b) => a + b, 0) / vals.length;

export function dailyWeights(records) {
  const result = {};
  for (const r of records) {
    if (r.종류 === "체중" && typeof r.실제무게 === "number" && r.날짜) result[r.날짜] = r.실제무게;
  }
  return result;
}

export function sevenDayAverage(weights, iso) {
  const avg = (start, end) => {
    const vals = Object.entries(weights).filter(([d]) => d >= start && d <= end).map(([, w]) => w);
    return vals.length ? round2(mean(vals)) : null;
  };
  return [avg(addDays(iso, -6), iso), avg(addDays(iso, -13), addDays(iso, -7))];
}

export function weekSummary(records, iso, routine) {
  const days = weekDates(iso);
  const daySet = new Set(days);
  const rows = records.filter((r) => daySet.has(r.날짜));
  const planned = new Set(), cardioPlanned = new Set();
  for (const d of days) {
    for (const e of exercisesFor(routine, dayName(d))) (routineCardio(e) ? cardioPlanned : planned).add(`${e.day}|${e.name}`);
  }
  const done = new Set(rows.filter((r) => r.종류 === "운동" && r.완료 === "O").map((r) => `${r.요일}|${r.항목}`));
  const cardioDone = new Set(rows.filter((r) => r.종류 === "유산소" && r.완료 === "O").map((r) => `${r.요일}|${r.항목}`));
  const meals = rows.filter((r) => r.종류 === "식단");
  const weights = dailyWeights(records);
  const weekAvg = (ds) => {
    const vals = ds.filter((d) => d in weights).map((d) => weights[d]);
    return vals.length ? round2(mean(vals)) : null;
  };
  const count = (a, b) => [...a].filter((x) => b.has(x)).length;
  return {
    exercise_done: count(done, planned), exercise_planned: planned.size,
    cardio_done: count(cardioDone, cardioPlanned), cardio_planned: cardioPlanned.size,
    meals_checked: meals.filter((r) => r.완료 === "O").length, meals_total: meals.length,
    weight_avg: weekAvg(days), weight_prev_avg: weekAvg(days.map((d) => addDays(d, -7))),
  };
}

export function hasInbodyThisWeek(plan, inbodyRows) {
  const days = new Set(weekDates(plan.date));
  return inbodyRows.some((r) => days.has(r.날짜));
}
