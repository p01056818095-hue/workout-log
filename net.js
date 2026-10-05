// 서버(구글 앱스 스크립트) 호출 (설계 2026-10-05 6장).
// POST + text/plain이라 브라우저의 사전 확인 요청이 생기지 않는다. 앱스 스크립트는 302로 결과 주소에 넘긴다.

export const MESSAGES = {
  network: "인터넷에 연결할 수 없어요",
  auth: "서버 응답이 이상해요. PC에서 Claude에게 알려주세요",
  key: "연결 정보가 바뀌었어요. PC 앱의 QR 코드를 다시 찍어 주세요",
  server: "서버 오류가 났어요",
};

export function classifyResponse(status, text) {
  if (status === 401 || status === 403) return { ok: false, kind: "auth", message: MESSAGES.auth };
  if (status >= 400) return { ok: false, kind: "server", message: `${MESSAGES.server} (HTTP ${status})` };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, kind: "auth", message: MESSAGES.auth }; // JSON이 아니면 권한·오류 화면
  }
  if (!data || typeof data !== "object") return { ok: false, kind: "auth", message: MESSAGES.auth };
  if (!data.ok) {
    if (data.error === "key") return { ok: false, kind: "key", message: MESSAGES.key };
    return { ok: false, kind: "server", message: `${MESSAGES.server} (${data.error || "알 수 없음"})` };
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
