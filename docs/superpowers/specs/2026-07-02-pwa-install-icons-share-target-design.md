# PWA 설치 진입점 + PNG 아이콘 + 공유 타깃 (spec)

날짜: 2026-07-02
관련: ADR-013(iOS WebKit 실기기 검증), vite.config.ts(vite-plugin-pwa manifest), design-language.md

## Context

사용자가 겪은 3가지:
- **A. 설치 안내가 한번 지나가면 못 찾음** — 앱에 설치 유도 코드가 전혀 없음(브라우저 기본 배너/메뉴에만 의존). 상시 진입점 필요.
- **B. 앱 공유/홈화면에서 아이콘이 안 뜸** — 아이콘이 `icon.svg` 하나뿐. iOS는 홈화면·공유 아이콘에 SVG를 쓰지 않음 → **PNG 필수**.
- **C. 이북에서 텍스트를 공유해 Capture로 받기** — manifest `share_target` 없음. **iOS Safari는 Web Share Target 미지원** → 안드로이드용으로 구현하고, iOS는 현행(입력모드 붙여넣기 — passage 자동 포커스)으로 두고 추후 개선 모색(사용자 확인).

## 결정

- **B(기반):** `icon.svg`에서 PNG 래스터라이즈 — `apple-touch-icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`(safe-zone 패딩). `public/`에 추가, manifest icons를 PNG로 교체(svg는 any로 유지 가능), `index.html`의 `apple-touch-icon`을 180 PNG로. 생성은 저장소 스크립트(`scripts/make-icons.cjs`, Playwright chromium으로 SVG → PNG — test:pdf와 같은 의존)로 재현 가능하게 하되, **산출 PNG는 커밋**(빌드에 Playwright 불요).
- **A:** 홈 하단(백업·가져오기 근처)에 **"앱 설치"** 텍스트 버튼 — **standalone(설치 상태)이면 렌더 안 함**.
  - Android/Chrome: `beforeinstallprompt`를 모듈 스코프에 저장(app 시작 시 리스너) → 버튼 탭 시 `prompt()` → 수락 시 버튼 숨김.
  - iOS(비-standalone Safari): 버튼 탭 시 간단한 안내 시트/모달 — "공유 버튼 → '홈 화면에 추가'" 2줄 + 닫기. 토스-클린, 밝은 시트.
  - 감지: `matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone`.
- **C(안드로이드):** manifest에 `share_target` 추가(GET):
  ```json
  "share_target": {
    "action": "./share-receive",
    "method": "GET",
    "params": { "title": "shared_title", "text": "shared_text", "url": "shared_url" }
  }
  ```
  - **수신 처리(app.ts 시작 시):** URL이 `share-receive`(pathname 끝 매치)이고 쿼리에 text/title/url이 있으면 그 텍스트를 조합(text 우선, url 있으면 뒤에 붙임)해 **공유 수신 플로우**로:
    1. `openSession()` 있으면 → `nav capture(sessionId, "input")` + **passage에 공유 텍스트 프리필**.
    2. 없으면 → `nav books`(책 선택→세션 시작) 후 입력모드 진입 시 프리필.
  - 프리필 전달: 라우트 확장 대신 **모듈 변수**(예: `pendingSharedText`)를 `capture.ts`가 입력모드 마운트 시 소비(1회성). 라우터/타입 침습 최소화.
  - 처리 후 `history.replaceState`로 쿼리 제거(SW 캐시/재실행 시 중복 방지). SPA fallback: GitHub Pages에서 `./share-receive`는 실제 파일이 없으므로 **404 회피가 필요** — GET action을 `./index.html`로 두거나(쿼리만 사용), 404.html 리다이렉트 중 **간단한 쪽(action을 `./` + 쿼리)** 채택: `"action": "./"`.
- **iOS는 현행 유지**(입력모드 붙여넣기). 추후 개선(단축어 등)은 별건.

## 컴포넌트/변경

1. **`scripts/make-icons.cjs`(신규) + `public/*.png`(산출 커밋):** chromium으로 icon.svg 렌더 → 180/192/512/maskable-512 PNG. maskable은 아이콘을 80% 축소해 여백(safe zone).
2. **`vite.config.ts`:** manifest icons → PNG(192 any, 512 any, maskable-512 maskable; svg any 유지), `share_target`(action `./`, GET, params), `includeAssets`에 png 추가.
3. **`index.html`:** `apple-touch-icon` → `apple-touch-icon-180.png`.
4. **`src/app.ts`:** 시작 시 (a) `beforeinstallprompt` 캡처(모듈 변수), (b) 공유 수신 감지(location.search의 shared_text/title/url) → pendingSharedText 세팅 + 첫 라우팅 결정(열린 세션→capture(input)/없으면 books) + replaceState.
5. **`src/screens/home.ts`:** "앱 설치" 버튼(비설치 시만) — Android는 저장된 prompt 실행, iOS는 안내 시트. + CSS.
6. **`src/screens/capture.ts`:** 입력모드 마운트 시 `consumeSharedText()`(1회성)로 passage 프리필. (books 경유 흐름도 세션 시작 후 capture(input)에 도달하므로 동일 지점에서 소비.)
7. **`src/lib/install.ts`(신규, 작게):** `isStandalone()`, `captureInstallPrompt()`, `promptInstall()`, `pendingSharedText` set/consume — app/home/capture가 공유하는 작은 모듈.

## 제약/디자인
- 토스-클린: "앱 설치"는 조용한 텍스트 버튼(홈 하단), iOS 안내 시트는 밝고 2줄. 탭타깃 ≥44px. 마이크로카피 plain("앱 설치", "홈 화면에 추가").
- 캡처 3초 루프 무영향(공유 수신은 앱 시작 경로).
- iOS 실기기 검증: PNG 아이콘(홈화면 추가 시), 설치 안내 시트. 안드로이드 실기기: 설치 prompt, 이북→공유→Capture 수신.
- SW 갱신: manifest 변경은 재설치/재방문 시 반영(즉시 아닐 수 있음 — 알려진 PWA 특성).

## 검증
1. `npm run build` 무에러; dist에 png 포함(글롭에 png 추가 확인: workbox globPatterns `png` 추가).
2. preview: 홈에 "앱 설치"(비설치), manifest에 share_target/png icons(devtools).
3. 수신 시뮬: `/?shared_text=...`(또는 `./?shared_text=`)로 접속 → 열린 세션 있으면 입력모드 passage 프리필 / 없으면 books.
4. 실기기: (iOS) 홈화면 추가 시 PNG 아이콘 표시·안내 시트, (Android) 설치 prompt 동작·이북 공유 목록에 Capture 표시·텍스트 수신.

## 미해결/주의
- workbox `globPatterns`에 `png` 추가 필요(현재 `js,css,html,svg,woff2`).
- share_target의 `action: "./"`는 시작 URL과 같아 SW 프리캐시로 오프라인에도 동작. 쿼리 파라미터만 다름.
- iOS 공유 수신 개선(단축어/클립보드 자동 감지)은 추후 별건.
