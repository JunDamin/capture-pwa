# PWA 설치 진입점 + PNG 아이콘 + 공유 타깃 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** PNG 아이콘으로 홈화면/공유 아이콘을 제대로 띄우고, 홈에 상시 "앱 설치" 진입점을 만들고, 안드로이드에서 이북 등 텍스트 공유를 Capture가 받아 입력모드 passage로 채운다.

**Architecture:** (T1) icon.svg→PNG 생성 스크립트 + 산출 커밋 + manifest/HTML 교체 + workbox 조정. (T2) 신규 `lib/install.ts`(standalone 감지·beforeinstallprompt·pendingSharedText) + 홈 설치 버튼 + iOS 안내 시트. (T3) manifest share_target + main.ts boot() 수신 감지 + capture/books 프리필·클리어.

**Tech Stack:** Vanilla TS + Vite + vite-plugin-pwa(workbox). PNG 생성은 Playwright chromium(개발 시 1회, 산출물 커밋 — 빌드에 불요).

## Global Constraints
- **[MUST] workbox:** `globPatterns`에 `png` 추가 + `ignoreURLParametersMatching: [/^utm_/, /^shared_/]` (없으면 오프라인 공유 실행 실패).
- `install.ts`는 **정적 import**(동적 import 금지, ADR-013). `beforeinstallprompt` 리스너는 모듈 초기화에서 등록.
- 설치 버튼은 조용한 텍스트 버튼(홈 하단), 비설치 시만 렌더(동기 `isStandalone()`), 탭타깃 ≥44px. iOS 안내 시트는 밝고 2줄, 토스-클린. 마이크로카피: "앱 설치", "홈 화면에 추가".
- 공유 수신 가드: `shared_text.slice(0, 10_000)`, text/url 모두 비면 공유 아님. 소비는 1회성. photo 모드 진입 시 무조건 클리어 + books는 공유 대기 시 입력모드 기본.
- 캡처 3초 루프 무영향. 테스트 프레임워크 없음: 각 태스크 = `npm run build` + 커밋. T1은 `node scripts/make-icons.cjs` 실행 산출 확인.

## File Structure
- `scripts/make-icons.cjs`(신규) + `public/apple-touch-icon-180.png`·`icon-192.png`·`icon-512.png`·`icon-maskable-512.png`(산출 커밋) — T1
- `vite.config.ts`(manifest icons·share_target·workbox), `index.html`(apple-touch-icon) — T1/T3
- `src/lib/install.ts`(신규): isStandalone/captureInstallPrompt/promptInstall/setPendingSharedText/consumeSharedText/hasPendingSharedText — T2
- `src/screens/home.ts`(설치 버튼+시트), `src/styles/app.css` — T2
- `src/main.ts`(boot 수신 감지), `src/screens/capture.ts`(프리필/클리어), `src/screens/books.ts`(입력모드 기본) — T3

---

### Task 1: PNG 아이콘 생성 + manifest/HTML 교체 + workbox 조정

**Files:**
- Create: `scripts/make-icons.cjs`, `public/apple-touch-icon-180.png`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`
- Modify: `vite.config.ts`, `index.html:7`

**Interfaces:**
- Produces: `public/*.png` 4개(이후 태스크 무관, manifest가 참조).

- [ ] **Step 1: 생성 스크립트 작성**

`scripts/make-icons.cjs` (패턴: `scripts/pdf-smoke.cjs`의 Playwright 사용):
```javascript
/* icon.svg → PNG 래스터라이즈. 1회성 개발 도구 — 산출 PNG는 커밋. 선행: npx playwright install chromium */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SVG = fs.readFileSync(path.join(__dirname, "..", "public", "icon.svg"), "utf8");
// [name, canvasSize, iconScale] — maskable은 80%로 축소(safe zone)
const OUT = [
  ["apple-touch-icon-180.png", 180, 1],
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-maskable-512.png", 512, 0.8],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, scale] of OUT) {
    const inner = Math.round(size * scale);
    const pad = Math.round((size - inner) / 2);
    // maskable 배경은 흰색(#FFFFFF), 아이콘 중앙 배치
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px;background:#FFFFFF;display:grid;place-items:center">` +
        `<div style="width:${inner}px;height:${inner}px">${SVG.replace(/<svg /, '<svg style="width:100%;height:100%" ')}</div></body>`,
    );
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
    fs.writeFileSync(path.join(__dirname, "..", "public", name), buf);
    console.log("wrote", name, buf.length, "bytes");
    void pad;
  }
  await browser.close();
})();
```
(icon.svg의 루트 `<svg>` 속성 형태를 확인해 style 주입이 안 먹으면 width/height 속성 치환으로 조정.)

- [ ] **Step 2: 실행 + 산출 확인**

Run: `node scripts/make-icons.cjs`
Expected: `wrote apple-touch-icon-180.png ...` 4줄, `public/`에 PNG 4개(각 수십 KB). PNG를 열어(Read tool로 이미지 확인) 아이콘이 제대로 렌더됐는지, maskable은 여백이 있는지 확인.

- [ ] **Step 3: vite.config.ts — icons + workbox**

`includeAssets: ["icon.svg"]` → `["icon.svg", "apple-touch-icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]`.
manifest `icons` 교체:
```ts
icons: [
  { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
],
```
workbox 블록:
```ts
workbox: {
  globPatterns: ["**/*.{js,css,html,svg,woff2,png}"],
  navigateFallback: null,
  ignoreURLParametersMatching: [/^utm_/, /^shared_/],
},
```

- [ ] **Step 4: index.html**

`index.html:7` `<link rel="apple-touch-icon" href="icon.svg" />` → `<link rel="apple-touch-icon" href="apple-touch-icon-180.png" />`.

- [ ] **Step 5: 빌드 + 확인**

Run: `npm run build`
Expected: 무에러. `grep -o 'icon-512.png' dist/manifest.webmanifest` 매치, `ls dist/*.png` 4개, `grep -c 'ignoreURLParametersMatching' dist/sw.js` ≥1.

- [ ] **Step 6: Commit**

```bash
git add scripts/make-icons.cjs public/*.png vite.config.ts index.html
git commit -m "feat: PNG 앱 아이콘(180/192/512/maskable) + workbox 공유쿼리 무시"
```

---

### Task 2: install.ts + 홈 "앱 설치" 진입점

**Files:**
- Create: `src/lib/install.ts`
- Modify: `src/screens/home.ts`, `src/styles/app.css`

**Interfaces:**
- Produces (T3도 사용): `isStandalone(): boolean`, `promptInstall(): Promise<"accepted"|"dismissed"|"unavailable">`, `setPendingSharedText(t: string): void`, `consumeSharedText(): string | null`, `hasPendingSharedText(): boolean`.

- [ ] **Step 1: `src/lib/install.ts` 작성**

```typescript
/** PWA 설치/공유 수신 유틸. 정적 import 전용(ADR-013). */

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// beforeinstallprompt(안드로이드/크롬) — 모듈 초기화 시 등록
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferredPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
});

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const p = deferredPrompt;
  deferredPrompt = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  return outcome;
}

// 공유 수신 텍스트(1회성) — main.ts가 set, capture.ts가 consume
let pendingSharedText: string | null = null;
export function setPendingSharedText(t: string): void {
  pendingSharedText = t;
}
export function consumeSharedText(): string | null {
  const t = pendingSharedText;
  pendingSharedText = null;
  return t;
}
export function hasPendingSharedText(): boolean {
  return pendingSharedText != null;
}
```

- [ ] **Step 2: 홈 버튼 + iOS 안내 시트**

`home.ts`: `import { isStandalone, promptInstall } from "../lib/install.ts";`
템플릿에서 `<button class="home__transfer">…` 위에 조건 삽입(innerHTML 패턴 유지):
```typescript
${isStandalone() ? "" : `<button class="home__install">앱 설치</button>`}
```
배선(render 이벤트 영역):
```typescript
const installBtn = root.querySelector(".home__install") as HTMLButtonElement | null;
if (installBtn) installBtn.onclick = async () => {
  const r = await promptInstall();
  if (r === "accepted") installBtn.remove();
  else if (r === "unavailable") showIosInstallSheet(root); // iOS 등: 안내 시트
};
```
같은 파일에 시트 헬퍼(간단 오버레이 — 기존 시트/스크림 스타일 재사용 가능하면 재사용):
```typescript
function showIosInstallSheet(root: HTMLElement) {
  const el = document.createElement("div");
  el.className = "install-sheet";
  el.innerHTML = `<div class="install-sheet__card">
    <div class="install-sheet__t">홈 화면에 추가</div>
    <div class="install-sheet__s">Safari 하단 공유 버튼을 누르고<br>'홈 화면에 추가'를 선택하세요</div>
    <button class="btn-primary install-sheet__ok">확인</button>
  </div>`;
  root.appendChild(el);
  (el.querySelector(".install-sheet__ok") as HTMLButtonElement).onclick = () => el.remove();
  el.onclick = (ev) => { if (ev.target === el) el.remove(); };
}
```

- [ ] **Step 3: CSS**

`app.css`:
```css
.home__install {
  display: block; width: 100%; min-height: 44px; margin-top: 8px;
  background: none; border: none; color: var(--sub); font-size: 14px;
  text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
}
.install-sheet {
  position: fixed; inset: 0; z-index: 50; background: rgba(25,31,40,0.4);
  display: grid; place-items: end center; padding: 16px;
}
.install-sheet__card {
  background: #fff; border-radius: 20px; padding: 24px 20px; width: 100%; max-width: 420px;
  text-align: center;
}
.install-sheet__t { font-weight: 700; font-size: 18px; color: var(--ink); margin-bottom: 8px; }
.install-sheet__s { color: var(--sub); font-size: 14px; line-height: 1.5; margin-bottom: 16px; }
```

- [ ] **Step 4: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/lib/install.ts src/screens/home.ts src/styles/app.css
git commit -m "feat: 홈 '앱 설치' 진입점(beforeinstallprompt/iOS 안내 시트)"
```

---

### Task 3: share_target + 수신 플로우(프리필·클리어)

**Files:**
- Modify: `vite.config.ts`(manifest), `src/main.ts`, `src/screens/capture.ts`, `src/screens/books.ts`

**Interfaces:**
- Consumes: T2의 `setPendingSharedText`/`consumeSharedText`/`hasPendingSharedText`.

- [ ] **Step 1: manifest share_target**

`vite.config.ts` manifest에 추가(icons와 같은 레벨):
```ts
share_target: {
  action: "./",
  method: "GET",
  params: { title: "shared_title", text: "shared_text", url: "shared_url" },
},
```
(vite-plugin-pwa 타입이 share_target을 모르면 manifest 객체에 `as any` 최소 캐스팅 또는 `ManifestOptions` 확장 — 실제 타입 확인 후 최소 침습으로.)

- [ ] **Step 2: main.ts boot() 수신 감지**

현재 `boot()`의 `nav({ name: "home" })` 자리를 대체(구현자는 현재 main.ts를 읽고 맞춤):
```typescript
import { setPendingSharedText } from "./lib/install.ts";
import { openSession } from "./db/db.ts"; // 기존 import 형태에 맞춰

async function boot() {
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
```
(`openSession()` 반환 형태(SessionView)는 현재 코드 확인 — `open.session.uuid` 경로 맞춤.)

- [ ] **Step 3: capture.ts 프리필 + photo 클리어**

`import { consumeSharedText } from "../lib/install.ts";`
- 입력모드 프리필: `inpPassage` 배선 근처(현 `inpPassage.oninput = ...` 뒤), `initialMode === "input"` 가드:
```typescript
if (initialMode === "input") {
  const shared = consumeSharedText();
  if (shared) inpPassage.value = shared;
}
```
- photo 모드 잔류 클리어: run() 시작부(또는 initialMode 확정 직후):
```typescript
if (initialMode !== "input") consumeSharedText(); // 잔류 방지(버림)
```

- [ ] **Step 4: books.ts 입력모드 기본**

`import { hasPendingSharedText } from "../lib/install.ts";`
`renderProject()`의 `let selectedMode: "photo" | "input" = "photo";` →
```typescript
let selectedMode: "photo" | "input" = hasPendingSharedText() ? "input" : "photo";
```
그리고 초기 `is-active` 클래스가 selectedMode를 따르도록(현재 photo 버튼에 하드코딩된 `is-active`가 있으면 조건부로).

- [ ] **Step 5: 빌드 + 시뮬 확인**

Run: `npm run build` → 무에러.
(preview: `http://localhost:4173/?shared_text=테스트문장` 접속 → 열린 세션 있으면 입력모드 passage에 "테스트문장" / 없으면 books(입력 토글 활성) → 시작 → passage 프리필. 이후 새로고침 시 쿼리 없음(replaceState).)

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts src/main.ts src/screens/capture.ts src/screens/books.ts
git commit -m "feat: 공유 타깃(share_target) 수신 — 입력모드 passage 프리필(안드로이드)"
```

---

## Self-Review
**1. Spec coverage:** B(PNG 4종+manifest+HTML+글롭) → T1; A(설치 버튼+prompt/iOS 시트+standalone 숨김) → T2; C(share_target+boot 감지+프리필) → T3; 검토 조정(MUST workbox ignore → T1 Step 3; 잔류 클리어 2종 → T3 Step 3·4; 수신 가드 slice/빈값 → T3 Step 2) 모두 반영 ✓.
**2. Placeholder scan:** 전 단계 구체 코드/명령. "현재 코드 확인 후 맞춤"은 변수·타입 형태 확인(의도적)뿐. ✓
**3. Type consistency:** install.ts 시그니처(T2) ↔ main/capture/books 사용(T3) 일치. `capture` 라우트 `mode:"input"` 기존 지원. ✓

## 참고
- T1의 PNG는 Read tool로 열어 육안 확인(아이콘 렌더·maskable 여백).
- 실기기 최종 확인: (iOS) 홈화면 추가 아이콘·안내 시트, (Android) 설치 prompt·이북 공유 목록에 Capture·수신 프리필.
- manifest 변경은 기설치 PWA에 즉시 반영 안 될 수 있음(재설치/재방문 특성) — 안내.
