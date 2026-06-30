# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Capture는 독서 중 떠오른 생각을 3초 안에 붙잡아, 외부 AI(ChatGPT/Claude)가 처리할 형태로 내보내는 **설치형 PWA**다. 서버·로그인 없음. 데이터는 IndexedDB에 로컬 저장.

## 명령어

```bash
npm install
npm run dev       # vite dev (localhost:5173, host). 카메라는 localhost/https 필요
npm run build     # tsc(타입체크) + vite build — 이 저장소의 사실상 "테스트". 항상 통과해야 함
npm run preview   # 프로덕션 빌드 미리보기
npm run test:pdf  # PDF 생성 스모크(chromium/Playwright) — npx playwright install chromium 선행
```

- **테스트 프레임워크 없음.** 변경 검증 = `npm run build`(tsc strict) + `npm run preview` 수동 + 해당 시 `npm run test:pdf`.
- **배포:** `main`에 push → GitHub Actions가 빌드해 GitHub Pages로 배포. `base`(`/capture-pwa/`)는 워크플로가 저장소 이름으로 주입(`VITE_BASE`).

## 아키텍처 (큰 그림)

- **인메모리 라우터:** `src/app.ts`가 전체 라우터. `mountApp(root)`이 `nav(route)`를 반환하고, 화면 전환 시 이전 화면의 cleanup(카메라 정지·objectURL revoke 등)을 호출한다. 히스토리/URL 라우팅 없음(브라우저 뒤로가기와 무관).
- **화면(`src/screens/`):** 각 화면은 `mountX(root, nav, ...args): () => void`(cleanup 반환) 패턴. home / books(책·세션 시작) / capture(캡처 루프) / review(요약·Export 진입) / detail(캡처 상세·편집) / export(PDF·프롬프트) / transfer(백업·가져오기).
- **도메인·저장(`src/db/`):** `types.ts`(Book/Session/Capture + `isValidCapture`), `db.ts`(idb 래퍼, 모든 put이 uuid keyPath upsert). Book 1:N Session, Session 1:N Capture.
- **라이브러리(`src/lib/`):** `image.ts`(리사이즈/압축), `pdf.ts`(canvas 렌더 PDF), `prompt.ts`(Export 프롬프트 빌더), `share.ts`(Web Share/다운로드), `viewer.ts`(전체화면 줌/크롭), `backup.ts`(JSON 백업/복원), `budget.ts`(캡처 예산 계측).
- **Export 파이프라인:** Review → `prompt.ts`가 prompt.md 텍스트 생성 → `pdf.ts`가 그 텍스트 + 사진을 단일 PDF로(AI에게 넘김). 외부 AI가 실제 분석 수행(앱은 분석 안 함, ADR-007).

## 핵심 도메인 모델 (ADR-014)

`Capture` = `tag`(느낌, 1개·필수) + 내용(`image` 또는 `passage`(책에서 담은 글) 중 ≥1) + `memo`(note: 내 생각, 선택) + `page?`. `isValidCapture` = (image ‖ passage ‖ memo) && tag.
- `why` 필드는 **deprecated(레거시 읽기 전용)** — 신규 캡처는 설정 금지(`why: null`), 표시/Export에서 note에 합쳐 보여줌. `WHY_CHIPS`는 제거됨.

## 반드시 지킬 프로젝트 규칙 (대부분 실기기에서 비싸게 배운 것)

- **iOS Safari가 주 타깃(설치형 PWA).** 항상 WebKit↔Blink 차이를 의심하고 **실기기로 검증**(멀티터치·카메라·핀치줌은 헤드리스 불가). 상세: `docs/decisions.md` ADR-013.
  - 이미지 로드는 **`Image`+`onload`만** — `createImageBitmap`·`img.decode()` 금지(iOS에서 throw/EncodingError).
  - 큰 라이브러리는 **정적 import** — `await import()` 동적 코드분할 금지(PWA 서비스워커가 옛 청크 해시를 fetch해 "Failed to fetch dynamically imported module"로 깨짐). 예: `pdf.ts`의 jsPDF.
  - iOS 캔버스/이미지 **메모리** 주의 — `pdf.ts`처럼 페이지 canvas를 누적하지 말고 즉시 처리·해제.
- **캡처 "사진 모드" 3초 루프는 신성하다.** 사진 경로(셔터→태그→note 시트→저장)를 느리게 하거나 포커스를 가로채는 변경 금지. 입력(텍스트) 모드·상세 편집엔 이 예산 미적용.
- **디자인 언어 = 토스 derived 밝고 깨끗.** 카메라 뷰파인더만 유일한 다크 풀블리드. 무채(잉크 `#191F28`/그레이/화이트) + 파랑 하나 `#3182F6`(색은 카메라·태그 이모지에서만). Pretendard 단일. 하단 풀폭 파랑 CTA. 탭타깃 ≥48px. reduced-motion 존중. 마이크로카피 plain·sentence case, 액션 이름 일관(새 변형 문구 만들지 말 것). 상세: `docs/design-language.md`.

## 설계 기록·작업 산출물

- **ADR:** `docs/decisions.md`(ADR-001~014). 도메인/아키텍처 결정은 여기서 확인하고, 새 결정은 같은 형식으로 추가.
- **PRD/용어:** `PRD.md`, `docs/glossary.md`.
- **spec/plan:** `docs/superpowers/specs/`, `docs/superpowers/plans/`(브레인스토밍→spec→plan→구현 워크플로 산출물).
- 커밋·푸시는 사용자가 요청할 때. 기능 작업은 별도 브랜치/워크트리에서.
