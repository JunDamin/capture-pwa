import "./styles/tokens.css";
import "./styles/app.css";
import { mountApp } from "./app.ts";
import { endStaleSessions } from "./db/db.ts";

const app = document.getElementById("app")!;

async function boot() {
  // 앱 진입 시 비활동 세션 자동 종료(ADR-005) — 백그라운드 타이머 없이 lazy 평가.
  await endStaleSessions(Date.now());
  const nav = mountApp(app);
  nav({ name: "home" });
}

boot();
