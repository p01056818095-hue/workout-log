// 서버(구글 앱스 스크립트) 호출 (설계 2026-10-05 6장).
// POST + text/plain이라 브라우저의 사전 확인 요청이 생기지 않는다. 앱스 스크립트는 302로 결과 주소에 넘긴다.

export const MESSAGES = {
  network: "인터넷에 연결할 수 없어요",
  auth: "서버 응답이 이상해요. PC에서 Claude에게 알려주세요",
  key: "연결 정보가 바뀌었어요. PC 앱의 QR 코드를 다시 찍어 주세요",
  server: "서버 오류가 났어요",
};

const CODE_TEXT = { // 서버 오류 코드 → 화면 말 (영어 코드는 보여주지 않는다)
  lock: "서버가 바빠요. 잠시 뒤 다시 할게요",
  too_big: "보낸 내용이 너무 커요",
  bad_request: "요청 형식이 이상해요",
  action: "서버가 모르는 요청이에요",
};
const SERVER_URL = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//; // 검사·확인용 가짜 서버

export function classifyResponse(status, text) {
  if (status === 401 || status === 403) return { ok: false, kind: "auth", message: MESSAGES.auth };
  if (status >= 400) return { ok: false, kind: "server", message: `${MESSAGES.server} (서버 응답 코드 ${status})` };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, kind: "auth", message: MESSAGES.auth }; // JSON이 아니면 권한·오류 화면
  }
  if (!data || typeof data !== "object") return { ok: false, kind: "auth", message: MESSAGES.auth };
  if (!data.ok) {
    if (data.error === "key") return { ok: false, kind: "key", message: MESSAGES.key };
    const why = CODE_TEXT[data.error];
    return { ok: false, kind: "server", code: data.error, message: why ? `${MESSAGES.server} (${why})` : MESSAGES.server };
  }
  return { ok: true, data };
}

export async function call(config, action, payload = {}, { timeout = 45000, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchImpl(config.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, key: config.key, ...payload }),
      redirect: "follow",
      signal: ctrl.signal,
    });
    return classifyResponse(res.status, await res.text());
  } catch (e) {
    return { ok: false, kind: "network", message: MESSAGES.network };
  } finally {
    clearTimeout(timer);
  }
}

// 첫 연결 주소의 #c=... 를 읽는다. 구글 앱스 스크립트 웹앱 주소가 아니면 받지 않는다.
export function parseSetupLink(hash) {
  const m = /^#c=([A-Za-z0-9_-]+)$/.exec(hash || "");
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (m[1].length % 4)) % 4);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof data.u !== "string" || typeof data.k !== "string" || !data.k) return null;
    if (!SERVER_URL.test(data.u) && !LOCAL_URL.test(data.u)) return null;
    return { url: data.u, key: data.k };
  } catch (e) {
    return null;
  }
}

// 한 번에 보내는 양을 나눈다 (서버 한도 1MB보다 넉넉히 작게)
export function batches(items, limitChars = 300000) {
  const out = [];
  let cur = [], size = 0;
  for (const item of items) {
    const n = JSON.stringify(item).length;
    if (cur.length && size + n > limitChars) { out.push(cur); cur = []; size = 0; }
    cur.push(item);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
