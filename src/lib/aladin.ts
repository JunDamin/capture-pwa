/** 알라딘 TTB — JSONP 검색 + CORS fetch 표지. ADR-017. 키는 사용자 입력(localStorage). */

const LS_KEY = "capture.aladinTtbKey";

export function getTtbKey(): string | null {
  try {
    const k = localStorage.getItem(LS_KEY)?.trim();
    return k ? k : null;
  } catch { return null; }
}
export function setTtbKey(k: string): void {
  try {
    const t = k.trim();
    if (t) localStorage.setItem(LS_KEY, t);
    else localStorage.removeItem(LS_KEY);
  } catch { /* 사생활 모드 무시 */ }
}

export interface AladinItem { title: string; author: string; cover: string; isbn13: string; publisher: string }

let cbSeq = 0;

/** JSONP 검색. 키 없으면 throw. errorCode 응답·타임아웃(8s)·로드 실패 시 reject. */
export function searchBooks(query: string): Promise<AladinItem[]> {
  const key = getTtbKey();
  if (!key) return Promise.reject(new Error("no-key"));
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const cbName = `__aladinCb_${++cbSeq}`;
    const w = window as unknown as Record<string, unknown>;
    let done = false;
    const script = document.createElement("script");
    const cleanup = () => { script.remove(); w[cbName] = () => {}; }; // delete 금지 — 늦은 응답 ReferenceError 방지
    const timer = setTimeout(() => {
      if (done) return; done = true; cleanup(); reject(new Error("timeout"));
    }, 8000);
    w[cbName] = (data: { errorCode?: number; errorMessage?: string; item?: unknown[] }) => {
      if (done) return; done = true; clearTimeout(timer); cleanup();
      if (data?.errorCode) { reject(new Error(`aladin:${data.errorCode}`)); return; }
      const items = (Array.isArray(data?.item) ? data.item : []) as Record<string, string>[];
      resolve(
        items
          .filter((it) => it.cover && !it.cover.includes("noimg"))
          .map((it) => ({
            title: it.title ?? "", author: it.author ?? "",
            cover: it.cover, isbn13: it.isbn13 ?? "", publisher: it.publisher ?? "",
          })),
      );
    };
    script.onerror = () => {
      if (done) return; done = true; clearTimeout(timer); cleanup(); reject(new Error("load-failed"));
    };
    script.src =
      `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${encodeURIComponent(key)}` +
      `&Query=${encodeURIComponent(q)}&QueryType=Title&SearchTarget=Book&MaxResults=10` +
      `&Cover=Big&Output=JS&Version=20131101&callback=${cbName}`;
    document.head.appendChild(script);
  });
}

/** 표지 다운로드 — https 승격 + cover500 치환(실패 시 원본 폴백). CDN이 CORS 허용(실측). */
export async function fetchCover(coverUrl: string): Promise<{ buf: ArrayBuffer; type: string }> {
  const https = coverUrl.replace(/^http:/, "https:");
  const hi = https.replace(/\/(coversum|cover200|cover)\//, "/cover500/");
  for (const url of hi !== https ? [hi, https] : [https]) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const blob = await r.blob();
      return { buf: await blob.arrayBuffer(), type: blob.type || "image/jpeg" };
    } catch { /* 다음 후보 */ }
  }
  throw new Error("cover-fetch-failed");
}
