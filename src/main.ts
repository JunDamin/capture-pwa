import "./styles/tokens.css";
import "./styles/app.css";
import { mountApp } from "./app.ts";
import { endStaleSessions, openSession } from "./db/db.ts";
import { setPendingSharedText } from "./lib/install.ts";

const app = document.getElementById("app")!;

async function boot() {
  // 앱 진입 시 비활동 세션 자동 종료(ADR-005) — 백그라운드 타이머 없이 lazy 평가.
  await endStaleSessions(Date.now());
  const nav = mountApp(app);

  // 공유 수신(share_target GET) 감지
  const params = new URLSearchParams(location.search);
  const text = (params.get("shared_text") ?? "").trim();
  const url = (params.get("shared_url") ?? "").trim();
  if (text || url) {
    const combined = [text, url].filter(Boolean).join("\n").slice(0, 10_000);
    setPendingSharedText(combined);
    history.replaceState(null, "", location.pathname); // 쿼리 제거(재실행 중복 방지)
    const open = await openSession();
    if (open) {
      nav({ name: "capture", sessionId: open.session.uuid, mode: "input" });
    } else {
      nav({ name: "books" });
    }
    return;
  }
  nav({ name: "home" });
}

boot();
