// 운동 기록 핸드폰 화면 (설계 2026-10-05 7장). PC 앱(app/ui)과 같은 순서·규칙이다.
import * as L from "./logic.js";
import { createStore } from "./store.js";
import { call } from "./net.js";

const Merge = window.Merge;
const store = createStore(window.localStorage, Merge);
const root = document.getElementById("app");
const SYNC_EVERY_MS = 60_000;
const NEW_DATA_TEXT = "새 기록이 들어왔어요. 입력하던 내용은 그대로 뒀어요.";

const state = {
  today: L.logicalToday(),
  current: L.logicalToday(),
  plan: null,
  w: null,               // 지금 화면의 입력 칸들
  initialParts: null,    // 화면을 다 그린 직후의 저장 조각 (기본값 판단)
  syncing: false,
  status: { text: "", kind: "info" },
  newData: false,        // 입력 중에 새 기록이 들어옴
  dateChanged: false,
  update: null,          // 기다리는 새 서비스 워커
};

// ---------- 작은 도구 ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") :
  `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`);
const fmtInt = (v) => Math.round(v).toLocaleString("en-US");
const timeText = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function numInput(value, { mode = "decimal", enabled = true, onInput = null } = {}) {
  const el = h("input", { class: "num", inputmode: mode, autocomplete: "off", value: L.formatNumber(value) });
  el.disabled = !enabled;
  if (onInput) el.addEventListener("input", onInput);
  return el;
}

function notice(text, kind = "info", action = null, extra = "") {
  return h("div", { class: `notice ${kind} ${extra}`.trim() }, text,
    action ? h("span", { class: "act" }, h("button", { onclick: action[1] }, action[0])) : null);
}

function mark(el, bad) {
  if (el) el.classList.toggle("bad", !!bad);
}

// ---------- 첫 연결 (#c=...) ----------

function readSetupLink() {
  const m = location.hash.match(/^#c=([A-Za-z0-9_-]+)$/);
  if (!m) return false;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (m[1].length % 4)) % 4);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data.u || !data.k) throw new Error("bad");
    store.setConfig({ url: data.u, key: data.k });
    state.status = { text: "연결했어요. 크롬 메뉴(⋮) → [앱 설치]를 누르면 홈 화면에 아이콘이 생겨요.", kind: "ok" };
  } catch (e) {
    state.status = { text: "연결 정보를 읽지 못했어요. QR 코드를 다시 찍어 주세요.", kind: "error" };
  }
  history.replaceState(null, "", location.pathname + location.search); // 키가 주소창·기록에 남지 않게
  return true;
}

// ---------- 화면 ----------

function render() {
  root.replaceChildren();
  state.w = null;
  state.initialParts = null;
  const cfg = store.getConfig();
  if (!cfg) {
    root.append(h("div", { class: "center" }, h("h1", {}, "운동 기록"),
      h("p", {}, "PC 앱 ⚙ → [핸드폰 연결]의 QR 코드를 핸드폰 카메라로 찍어 주세요."),
      state.status.text ? h("p", { class: `status ${state.status.kind}` }, state.status.text) : null));
    return;
  }
  const routine = store.getRoutine();
  if (!routine) {
    root.append(h("div", { class: "center" }, h("h1", {}, "운동 기록"),
      h("p", {}, state.syncing ? "루틴을 받는 중이에요… (처음에는 20초쯤 걸릴 수 있어요)" : "아직 루틴을 받지 못했어요."),
      h("p", { id: "sync", class: "muted" }, syncLine()),
      h("button", { class: "btn", onclick: () => syncNow({ manual: true }) }, "다시 받기")));
    return;
  }

  const plan = L.buildDayPlan(routine, state.current);
  state.plan = plan;
  const view = store.dayView(state.current);
  const dayRows = view.rows;
  const records = store.allRecords();
  const editable = state.current <= state.today;
  const loadedPhase = (dayRows.find((r) => r.구분) || {}).구분 || plan.phase;

  // 머리줄
  const top = h("header", { class: "top" },
    h("h1", {}, plan.header),
    h("div", { class: "sub" }, state.current < state.today && !dayRows.length ? "현재 루틴 기준" : ""),
    h("div", { class: "nav" },
      h("button", { onclick: () => move(-1), "aria-label": "전날" }, "◀"),
      h("button", { onclick: goToday, disabled: state.current === state.today }, "오늘"),
      h("button", { onclick: () => move(1), "aria-label": "다음날" }, "▶"),
      h("span", { class: "grow" }),
      h("button", { onclick: openSettings, "aria-label": "설정" }, "⚙")));
  const main = h("main");
  root.append(top, main);

  if (state.update) main.append(notice("새 버전이 있어요.", "info", ["새로 고침", applyUpdate], "update"));
  if (state.dateChanged) main.append(notice("날짜가 바뀌었어요.", "warn", ["오늘로", goToday]));
  if (state.newData) main.append(notice(NEW_DATA_TEXT, "info", ["다시 불러오기", reload], "newdata"));
  if (routine.warnings && routine.warnings.length) {
    main.append(notice("루틴 확인 필요:\n· " + routine.warnings.slice(0, 5).join("\n· "), "warn"));
  }
  for (const n of plan.notices) main.append(notice(n, "info"));
  if (plan.is_inbody_week && !L.hasInbodyThisWeek(plan, store.allInbody())) {
    main.append(notice("인바디 주예요. 그 주 월요일 아침(화장실 다녀온 뒤, 먹기 전)에 재고 남겨주세요.", "info",
      ["인바디 입력", openInbody]));
  }

  const w = { weight: null, exercises: [], cardio: [], meals: [], memo: null, plan, loadedPhase, editable };

  // 아침 체중
  const weightRow = dayRows.find((r) => r.종류 === "체중");
  w.weight = numInput(weightRow ? weightRow.실제무게 : null, { enabled: editable });
  w.weight.placeholder = "--.-";
  const [avg, prev] = L.sevenDayAverage(L.dailyWeights(records), state.current);
  const avgText = avg === null ? "7일 평균: 기록이 쌓이면 보여요" :
    `7일 평균 ${avg.toFixed(1)}kg` + (prev !== null ? ` (전 7일 대비 ${avg - prev >= 0 ? "+" : ""}${(avg - prev).toFixed(1)})` : "");
  main.append(h("div", { class: "card weight" }, h("label", {}, "아침 체중"), w.weight, h("span", {}, "kg"),
    h("span", { class: "avg muted" }, avgText)));

  if (plan.is_sunday) main.append(weekSummaryCard(records, plan, routine));

  // 운동
  const items = L.exerciseItems(plan, dayRows);
  if (items.length || !plan.is_sunday) main.append(h("h2", {}, "운동"));
  if (!items.length && !plan.is_sunday) main.append(h("p", { class: "muted" }, "오늘은 운동이 없는 날이에요. 푹 쉬고 식단만 챙겨요."));
  for (const it of items) {
    if (it.kind === "cardio") {
      const c = cardioRow(it.planned, it.prefill, editable);
      w.cardio.push(c);
      main.append(c.el);
    } else {
      const e = exerciseCard(it.planned, it.prefill, editable);
      w.exercises.push(e);
      main.append(e.el);
    }
  }

  // 식단
  main.append(h("h2", {}, "식단"));
  const mealCard = h("div", { class: "card" });
  const prefill = L.mealPrefill(plan, dayRows);
  const total = h("div", { class: "total" });
  for (const slot of plan.meals) {
    const m = mealRow(slot, prefill[slot.meal], editable, () => updateTotal(w, total, routine));
    w.meals.push(m);
    mealCard.append(m.el);
  }
  mealCard.append(total);
  main.append(mealCard);
  updateTotal(w, total, routine);

  // 메모
  const memoRow = dayRows.find((r) => r.종류 === "메모");
  w.memo = h("input", { class: "text", placeholder: "컨디션, 통증, '스쿼트 자세 OK' 등", value: memoRow ? memoRow.메모 : "" });
  w.memo.disabled = !editable;
  main.append(h("h2", {}, "메모"), h("div", { class: "card" }, w.memo));

  // 아래 고정
  const save = h("button", { class: "save", onclick: saveDay, disabled: !editable }, "저장");
  save.addEventListener("pointerdown", () => document.activeElement && document.activeElement.blur()); // 한글 조합 확정
  if (!editable && !state.status.text) state.status = { text: "미래 날짜는 보기만 할 수 있어요.", kind: "info" };
  root.append(h("div", { class: "bottom" }, h("div", { class: "inner" },
    h("div", { id: "status", class: `status ${state.status.kind}` }, state.status.text),
    h("div", { id: "sync", class: "sync" }, syncLine()), save)));

  state.w = w;
  if (editable) {
    const c = collect(false);
    state.initialParts = c.errors.length ? null : Merge.splitDay(L.buildRows(c.entry), null);
  }
}

function weekSummaryCard(records, plan, routine) {
  const s = L.weekSummary(records, plan.date, routine);
  const lines = [`운동 ${s.exercise_done}/${s.exercise_planned}` +
    (s.cardio_planned ? ` · 유산소 ${s.cardio_done}/${s.cardio_planned}` : "")];
  if (s.meals_total) {
    lines.push(`식단 체크율 ${Math.round((100 * s.meals_checked) / s.meals_total)}% (${s.meals_checked}/${s.meals_total})`);
  }
  if (s.weight_avg !== null) {
    let t = `이번 주 평균 체중 ${s.weight_avg.toFixed(1)}kg`;
    if (s.weight_prev_avg !== null) {
      const d = s.weight_avg - s.weight_prev_avg;
      t += ` (지난주 대비 ${d >= 0 ? "+" : ""}${d.toFixed(1)}kg)`;
    }
    lines.push(t);
  }
  lines.push("PC에서 Claude에게 \"이번 주 루틴 파악해줘\"라고 말하면 다음 주 목표를 정해줘요.");
  return h("div", { class: "notice info" }, h("b", {}, "이번 주 요약"), "\n" + lines.join("\n"));
}

// 운동 카드: 운동 체크 = 모든 세트를 한꺼번에. 세트 체크 = 그 세트를 했다. 칸을 고치면 그 세트가 자동 체크.
function exerciseCard(p, prefill, editable) {
  prefill = prefill || {};
  const sets = [];
  let differs = false;
  const cardCheck = h("input", { type: "checkbox" });
  cardCheck.disabled = !editable;
  const setsBox = h("div", { class: "sets" });
  const toggle = h("button", { class: "toggle" }, "세트별 ▼");
  let expanded = false;
  const show = (on) => {
    expanded = on;
    setsBox.hidden = !on;
    toggle.textContent = on ? "세트별 ▲" : "세트별 ▼";
  };
  toggle.addEventListener("click", () => show(!expanded));
  const refresh = () => {
    cardCheck.checked = sets.length > 0 && sets.every((s) => s.check.checked);
    for (const s of sets) for (const e of [s.weight, s.reps]) if (e) e.classList.toggle("dim", !s.check.checked);
  };
  for (let i = 1; i <= p.sets; i++) {
    const has = Object.prototype.hasOwnProperty.call(prefill, String(i));
    const [done, wv, reps] = has ? prefill[String(i)] : [false, null, null];
    if (has) {
      differs = differs || !done || (!p.bodyweight && wv !== null && wv !== p.target_weight) ||
        (reps !== null && reps !== p.target_reps);
    }
    const check = h("input", { type: "checkbox" });
    check.checked = done;
    check.disabled = !editable;
    const s = { check, weight: null, reps: null };
    const edited = () => { if (!check.checked) { check.checked = true; } refresh(); };
    if (!p.bodyweight) s.weight = numInput(done && wv !== null ? wv : p.target_weight, { enabled: editable, onInput: edited });
    s.reps = numInput(done && reps !== null ? reps : p.target_reps, { mode: "numeric", enabled: editable, onInput: edited });
    check.addEventListener("change", refresh);
    setsBox.append(h("div", { class: "set" }, h("span", { class: "no" }, `${i}세트`), check,
      p.bodyweight ? h("span", {}, `${L.BODYWEIGHT} ×`) : [s.weight, h("span", {}, "kg ×")], s.reps, h("span", {}, "회")));
    sets.push(s);
  }
  cardCheck.addEventListener("change", () => {
    for (const s of sets) s.check.checked = cardCheck.checked;
    refresh();
  });
  const el = h("div", { class: "card" },
    h("div", { class: "ex-head" }, h("label", { class: "check" }, cardCheck),
      h("div", { class: "what" }, h("div", { class: "ex-name" }, p.name), h("div", { class: "ex-sum" }, p.summary)), toggle),
    p.memo ? h("div", { class: "memo" }, p.memo) : null, setsBox);
  refresh();
  show(differs && sets.some((s) => s.check.checked));
  return { el, planned: p, sets, show };
}

// 유산소·서킷: 체크했을 때만 저장한다
function cardioRow(p, prefill, editable) {
  const [done, minutes, distance] = prefill || [false, p.minutes, p.distance];
  const check = h("input", { type: "checkbox" });
  check.checked = done;
  check.disabled = !editable;
  const tick = () => { check.checked = true; };
  const dist = numInput(distance, { enabled: editable, onInput: tick });
  const mins = numInput(minutes, { mode: "numeric", enabled: editable, onInput: tick });
  const el = h("div", { class: "card" },
    h("div", { class: "ex-head" }, h("label", { class: "check" }, check),
      h("div", { class: "what" }, h("div", { class: "ex-name" }, p.name), h("div", { class: "ex-sum" }, p.summary))),
    h("div", { class: "cardio-inputs" }, h("span", { class: "muted" }, "실제"), dist, h("span", {}, "km"), mins, h("span", {}, "분")),
    p.memo ? h("div", { class: "memo" }, p.memo) : null);
  return { el, planned: p, check, dist, mins };
}

// 끼니 한 줄: 체크 + 드롭다운(그날 메뉴, 저녁은 저녁추천 전체, 맨 끝 '기타(직접 입력)')
function mealRow(slot, prefill, editable, onChange) {
  const [done, menu, kcal, protein, other] = prefill || [false, null, null, null, false];
  const options = new Map(slot.options.map(([name, k, p]) => [name, [k, p]]));
  if (menu && !other && !options.has(menu)) { // 루틴에서 메뉴 이름이 바뀐 지난 기록
    const rest = [...options];
    options.clear();
    options.set(menu, [kcal, protein]);
    for (const [k, v] of rest) options.set(k, v);
  }
  const values = [...options.keys(), L.OTHER_MENU];
  const check = h("input", { type: "checkbox" });
  check.checked = done;
  check.disabled = !editable;
  const select = h("select", {}, values.map((v) => h("option", { value: v }, v)));
  select.value = other ? L.OTHER_MENU : (menu || (options.size ? values[0] : L.OTHER_MENU));
  select.disabled = !editable;
  const info = h("div", { class: "info muted" });
  const otherMenu = h("input", { class: "text", placeholder: "먹은 메뉴", value: other && menu ? menu : "" });
  const otherKcal = numInput(other ? kcal : null, { enabled: editable });
  const otherProtein = numInput(other ? protein : null, { enabled: editable });
  otherMenu.disabled = !editable;
  otherKcal.placeholder = "kcal";
  otherProtein.placeholder = "단백질g";
  const otherBox = h("div", { class: "other" }, otherMenu, otherKcal, otherProtein);
  const m = { slot, check, select, options, otherMenu, otherKcal, otherProtein };
  m.isOther = () => select.value === L.OTHER_MENU;
  m.values = () => {
    if (m.isOther()) {
      const num = (e) => { try { return L.parseNumber(e.value); } catch (err) { return null; } };
      return [otherMenu.value.trim(), num(otherKcal), num(otherProtein)];
    }
    const [k, p] = options.get(select.value) || [null, null];
    return [select.value, k, p];
  };
  const updateInfo = () => {
    otherBox.hidden = !m.isOther();
    if (m.isOther()) {
      info.textContent = "먹은 걸 적어주세요. kcal·단백질은 모르면 비워도 돼요.";
      return;
    }
    const [, k, p] = m.values();
    const parts = [];
    if (k !== null) parts.push(`${L.formatNumber(k)}kcal`);
    if (p !== null) parts.push(`단백질 ${L.formatNumber(p)}g`);
    if (slot.memo && select.value === (slot.options[0] ? slot.options[0][0] : null)) parts.push(slot.memo);
    info.textContent = parts.join(" · ");
  };
  const changed = () => { updateInfo(); onChange(); };
  check.addEventListener("change", changed);
  select.addEventListener("change", changed);
  for (const e of [otherMenu, otherKcal, otherProtein]) {
    e.addEventListener("input", () => { if (!check.checked) check.checked = true; changed(); });
  }
  m.el = h("div", { class: "meal" }, h("div", { class: "meal-row" }, h("label", { class: "check" }, check),
    h("span", { class: "meal-name" }, slot.meal), select), info, otherBox);
  updateInfo();
  return m;
}

function updateTotal(w, el, routine) {
  let kcal = 0, protein = 0;
  for (const m of w.meals) {
    if (!m.check.checked) continue;
    const [, k, p] = m.values();
    kcal += k || 0;
    protein += p || 0;
  }
  const cfg = routine.config;
  const kt = cfg.kcal_target ? `목표 ${fmtInt(cfg.kcal_target)}kcal` : "목표 미설정";
  const pt = cfg.protein_target ? `목표 ${fmtInt(cfg.protein_target)}g` : "목표 미설정";
  const steps = cfg.step_target && L.weekdayIndex(state.current) < 5 ? ` · 걸음 ${fmtInt(cfg.step_target)}보` : "";
  el.textContent = `합계 ${fmtInt(kcal)}kcal / ${kt} · 단백질 ${Math.round(protein)}g / ${pt}${steps}`;
}

// ---------- 입력 모으기 (PC collect_input과 같은 검사) ----------

function collect(showErrors) {
  const w = state.w;
  const p = w.plan;
  const errors = [];
  const bad = (el, isBad) => { if (showErrors) mark(el, isBad); };
  const entry = { date: p.date, week: p.week, weekday: p.day, phase: w.loadedPhase, weight: null,
    exercises: [], cardio: [], meals: [], memo: w.memo.value.trim() };
  try {
    const kg = L.parseNumber(w.weight.value);
    if (kg !== null && !(kg >= 30 && kg <= 250)) throw new Error("범위");
    entry.weight = kg;
    bad(w.weight, false);
  } catch (e) {
    bad(w.weight, true);
    errors.push("아침 체중은 30~250 사이 숫자로 적어주세요 (예: 69.2)");
  }
  for (const ex of w.exercises) {
    const pl = ex.planned;
    const sets = [];
    let exErrors = 0;
    ex.sets.forEach((s, idx) => {
      const i = idx + 1;
      if (!s.check.checked) {
        sets.push({ done: false, weight: null, reps: null });
        bad(s.weight, false);
        bad(s.reps, false);
        return;
      }
      let wv = pl.bodyweight ? L.BODYWEIGHT : null;
      if (!pl.bodyweight) {
        try {
          wv = L.parseNumber(s.weight.value);
          bad(s.weight, wv === null);
          if (wv === null) { errors.push(`${pl.name} ${i}세트 무게가 비어 있어요`); exErrors++; }
        } catch (e) {
          bad(s.weight, true);
          errors.push(`${pl.name} ${i}세트 무게가 숫자가 아니에요`);
          exErrors++;
        }
      }
      let r = null;
      try {
        r = L.parseCount(s.reps.value);
        bad(s.reps, r === null);
        if (r === null) { errors.push(`${pl.name} ${i}세트 횟수가 비어 있어요`); exErrors++; }
      } catch (e) {
        bad(s.reps, true);
        errors.push(`${pl.name} ${i}세트 횟수가 정수가 아니에요`);
        exErrors++;
      }
      sets.push({ done: true, weight: wv, reps: r });
    });
    if (exErrors && showErrors) ex.show(true);
    entry.exercises.push({ name: pl.name, target_weight: pl.target_weight, target_reps: pl.target_reps, sets });
  }
  for (const c of w.cardio) {
    let distance = null, minutes = null;
    if (c.check.checked) {
      try { distance = L.parseNumber(c.dist.value); bad(c.dist, false); } catch (e) {
        bad(c.dist, true); errors.push(`${c.planned.name} 거리가 숫자가 아니에요`);
      }
      try { minutes = L.parseCount(c.mins.value); bad(c.mins, false); } catch (e) {
        bad(c.mins, true); errors.push(`${c.planned.name} 시간이 정수가 아니에요`);
      }
    }
    entry.cardio.push({ name: c.planned.name, done: c.check.checked, minutes, distance });
  }
  for (const m of w.meals) {
    if (m.isOther() && m.check.checked) {
      for (const [e, label] of [[m.otherKcal, "kcal"], [m.otherProtein, "단백질"]]) {
        try { L.parseNumber(e.value); bad(e, false); } catch (err) {
          bad(e, true); errors.push(`${m.slot.meal} 기타의 ${label} 칸이 숫자가 아니에요`);
        }
      }
      if (!m.otherMenu.value.trim()) {
        errors.push(`${m.slot.meal} 기타에 먹은 메뉴를 적어주세요`);
        bad(m.otherMenu, true);
      } else {
        bad(m.otherMenu, false);
      }
    }
    const [menu, kcal, protein] = m.values();
    entry.meals.push({ meal: m.slot.meal, menu, done: m.check.checked, kcal, protein, other: m.isOther() });
  }
  return { entry, errors };
}

function isDirty() {
  if (!state.w || !state.w.editable) return false;
  const c = collect(false);
  if (c.errors.length) return true;
  return !Merge.deepEqual(Merge.splitDay(L.buildRows(c.entry), null), state.initialParts || {});
}

// ---------- 동작 ----------

function setStatus(text, kind = "info") {
  state.status = { text, kind };
  const el = document.getElementById("status");
  if (el) {
    el.textContent = text;
    el.className = `status ${kind}`;
  }
}

function syncLine() {
  const n = store.getOutbox().length;
  const last = store.getLastSync();
  if (state.syncing) return "보내는 중…";
  if (n) {
    const why = last && !last.ok ? ` · ${last.message}` : "";
    return `핸드폰에 보관 중 ${n}건 (인터넷 연결되면 보내요)${why}`;
  }
  if (!last) return "";
  return last.ok ? `서버에 저장됨 · ${timeText(last.at)}` : `서버 오류: ${last.message}`;
}

function refreshSyncLine() {
  const el = document.getElementById("sync");
  if (el) el.textContent = syncLine();
}

function move(delta) {
  state.current = L.addDays(state.current, delta);
  state.status = { text: "", kind: "info" };
  state.newData = false;
  render();
  window.scrollTo(0, 0);
}

function goToday() {
  state.today = L.logicalToday();
  state.current = state.today;
  state.dateChanged = false;
  state.status = { text: "", kind: "info" };
  render();
  window.scrollTo(0, 0);
}

function reload() {
  state.newData = false;
  render();
}

function saveDay() {
  if (!state.w || !state.w.editable) return;
  if (document.activeElement) document.activeElement.blur();
  const { entry, errors } = collect(true);
  if (errors.length) {
    setStatus("저장하지 않았어요. 빨간 칸을 고쳐주세요:\n" + errors.slice(0, 4).join("\n"), "error");
    return;
  }
  const finalParts = Merge.splitDay(L.buildRows(entry), null);
  const parts = Merge.diffParts(state.initialParts, finalParts, Date.now(), "phone");
  if (Object.keys(parts).length && !store.addToOutbox({ id: uid(), date: state.current, parts })) {
    setStatus("핸드폰 저장 공간이 꽉 차서 저장하지 못했어요.", "error");
    return;
  }
  state.newData = false;
  state.status = { text: "저장했어요.", kind: "ok" };
  render();
  syncNow();
}

async function syncNow({ manual = false } = {}) {
  const cfg = store.getConfig();
  if (!cfg || state.syncing) return;
  state.syncing = true;
  refreshSyncLine();
  const before = store.getRoutine();
  let changed = [];
  let ok = false;
  try {
    const outbox = store.getOutbox();
    if (outbox.length) {
      const r = await call(cfg, "push", { by: "phone", items: outbox });
      if (!r.ok) return fail(r, manual);
      const rejected = r.data.rejected || [];
      store.removeAccepted([...(r.data.accepted || []), ...rejected.map((x) => x.id)]);
      changed = changed.concat(store.applyServerEntries(r.data.entries, null));
      if (rejected.length) setStatus(`서버가 받지 않은 입력이 ${rejected.length}개 있어요 (${rejected[0].reason}).`, "warn");
    }
    const routine = store.getRoutine();
    const p = await call(cfg, "pull", { since: store.getMirror().cursor, want_routine: true,
      routine_version: routine ? routine.version : null });
    if (!p.ok) return fail(p, manual);
    changed = changed.concat(store.applyServerEntries(p.data.entries, p.data.rev));
    if (p.data.routine) store.setRoutine(p.data.routine);
    store.setLastSync({ at: Date.now(), ok: true, message: "" });
    ok = true;
    if (manual) setStatus("서버와 맞췄어요.", "ok");
  } finally {
    state.syncing = false;
    refreshSyncLine();
    if (!state.w) render(); // 아직 루틴이 없는 화면은 결과를 보여주도록 다시 그린다
  }
  if (!ok) return;
  const routineChanged = (before && before.version) !== (store.getRoutine() || {}).version;
  const week = new Set(L.weekDates(state.current));
  const relevant = routineChanged || changed.some((d) => week.has(d) || d === state.current);
  if (!relevant && state.w) return;
  if (isDirty()) {
    state.newData = true;
    const main = document.querySelector("main");
    if (main && !main.querySelector(".notice.newdata")) main.prepend(notice(NEW_DATA_TEXT, "info", ["다시 불러오기", reload], "newdata"));
  } else {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }
}

function fail(result, manual) {
  store.setLastSync({ at: Date.now(), ok: false, message: result.message, kind: result.kind });
  if (manual || result.kind === "key" || result.kind === "auth") setStatus(result.message, "warn");
}

// ---------- 아래에서 올라오는 창 ----------

function sheet(title, build) {
  const bg = h("div", { class: "sheet-bg" });
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  bg.append(h("div", { class: "sheet" }, h("h3", {}, title), ...build(close)));
  document.body.append(bg);
  return close;
}

function openSettings() {
  const cfg = store.getConfig() || {};
  const last = store.getLastSync();
  const routine = store.getRoutine();
  sheet("설정", (close) => [
    h("button", { class: "btn", onclick: () => { close(); openInbody(); } }, "인바디 입력"),
    h("button", { class: "btn", onclick: () => { close(); syncNow({ manual: true }); } }, "지금 받기"),
    h("button", { class: "btn ghost", onclick: checkUpdate }, "새 버전 확인"),
    h("p", { class: "muted" },
      `서버: …${(cfg.url || "").slice(-16)}\n`,
      `마지막 동기화: ${last ? `${new Date(last.at).toLocaleString("ko-KR")} (${last.ok ? "성공" : last.message})` : "없음"}\n`,
      `보관 중: ${store.getOutbox().length}건 · 루틴 버전: ${routine ? routine.version.slice(0, 8) : "없음"}`),
    h("button", { class: "btn ghost", onclick: close }, "닫기"),
  ]);
}

const INBODY_FIELDS = [["체중", "kg"], ["골격근량", "kg"], ["체지방량", "kg"], ["체지방률", "%"], ["기초대사량", "kcal"]];

function openInbody() {
  const day = state.current < state.today ? state.current : state.today;
  const dateInput = h("input", { class: "text", type: "date", value: day });
  const inputs = Object.fromEntries(INBODY_FIELDS.map(([name]) => [name, numInput(null)]));
  const memo = h("input", { class: "text", placeholder: "예: 월요일 아침 공복, 헬스장 기계" });
  const msg = h("p", { class: "status error" });
  sheet("인바디 입력", (close) => [
    h("p", { class: "muted" }, "결과지 숫자를 적어주세요. 모르는 칸은 비워도 돼요. 같은 조건으로 재요: 월요일 아침, 화장실 다녀온 뒤, 먹기 전, 운동 전, 같은 기계."),
    h("div", { class: "field" }, h("span", {}, "날짜"), dateInput, h("span")),
    INBODY_FIELDS.map(([name, unit]) => h("div", { class: "field" }, h("span", {}, name), inputs[name], h("span", { class: "unit" }, unit))),
    h("div", { class: "field" }, h("span", {}, "측정 조건"), memo, h("span")),
    msg,
    h("button", { class: "btn", onclick: () => {
      const errors = [];
      const d = dateInput.value;
      mark(dateInput, !/^\d{4}-\d{2}-\d{2}$/.test(d));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push("날짜를 골라주세요");
      const values = {};
      for (const [name] of INBODY_FIELDS) {
        try { values[name] = L.parseNumber(inputs[name].value); mark(inputs[name], false); } catch (e) {
          mark(inputs[name], true); errors.push(`${name} 칸이 숫자가 아니에요`);
        }
      }
      if (!errors.length && Object.values(values).every((v) => v === null)) errors.push("숫자를 하나 이상 적어주세요");
      if (errors.length) { msg.textContent = errors.join("\n"); return; }
      const row = Merge.cleanInbody({ 날짜: d, ...values, 메모: memo.value.trim() || null });
      const parts = { [Merge.INBODY_KEY]: { rows: [row], t: Date.now(), w: false, by: "phone" } };
      if (!store.addToOutbox({ id: uid(), date: d, parts })) { msg.textContent = "핸드폰 저장 공간이 꽉 찼어요."; return; }
      close();
      state.status = { text: "인바디를 저장했어요.", kind: "ok" };
      if (isDirty()) setStatus(state.status.text, "ok"); else render();
      syncNow();
    } }, "저장"),
    h("button", { class: "btn ghost", onclick: close }, "취소"),
  ]);
}

// ---------- 오프라인·새 버전 ----------

async function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    const watch = (worker) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) { state.update = worker; showUpdate(); }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) { state.update = reg.waiting; showUpdate(); }
    reg.addEventListener("updatefound", () => watch(reg.installing));
    // 처음 설치될 때도 controllerchange가 나므로, [새로 고침]을 눌렀을 때만 다시 연다
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (state.reloading) location.reload(); });
    state.registration = reg;
  } catch (e) {
    // 서비스 워커가 안 돼도 화면은 그대로 쓴다 (오프라인 열기만 안 됨)
  }
}

function showUpdate() {
  const main = document.querySelector("main");
  if (main && !main.querySelector(".notice.update")) main.prepend(notice("새 버전이 있어요.", "info", ["새로 고침", applyUpdate], "update"));
}

function applyUpdate() {
  if (!state.update) return;
  state.reloading = true;
  state.update.postMessage("skip");
}

async function checkUpdate() {
  if (!state.registration) { setStatus("이 브라우저에서는 새 버전 확인을 할 수 없어요.", "warn"); return; }
  try {
    await state.registration.update();
    setStatus(state.update ? "새 버전이 있어요. 위의 [새로 고침]을 눌러주세요." : "지금이 최신 버전이에요.", "ok");
  } catch (e) {
    setStatus("인터넷에 연결할 수 없어요.", "warn");
  }
}

// ---------- 시작 ----------

function start() {
  readSetupLink();
  syncNow(); // 먼저 시작해서 첫 화면에 "받는 중"이 보이게
  render();
  registerWorker();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.addEventListener("online", () => syncNow());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  window.addEventListener("hashchange", () => { if (readSetupLink()) { render(); syncNow(); } });
  setInterval(() => {
    const now = L.logicalToday();
    if (now !== state.today) {
      state.today = now;
      state.dateChanged = true;
      if (!isDirty()) render();
    }
    if (document.visibilityState === "visible") syncNow();
  }, SYNC_EVERY_MS);
}

start();
