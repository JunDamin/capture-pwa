# 전체 점검 후속 — 정리 배치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).
> 근거: 2026-07-02 전체 앱 3중 감사(정확성 opus·UX·아키텍처) 발견 사항. P1-1(목적 설정 흐름)은 별도 보류.

**Goal:** 감사 발견의 기계적 정리 — 죽은 코드/CSS 제거, recentBooks 성능, 문구·탭타깃 통일, 문서 드리프트 해소.

**Tech Stack:** 기존 그대로. 각 태스크 = `npm run build`(+T1·T2는 `test:pdf`) + 커밋.

## Global Constraints
- 동작 변경 최소(정리 배치) — 명시된 항목 외 리팩터 금지. 회독 잠복 헬퍼(capturesWithRoundsForBook/roundNumberOf/displayRoundNo/roundNo/BookView 회독 필드)는 **보존**(ADR-016).
- 문구는 기존 액션명에 수렴(새 변형 금지): 캡처 수 = **"캡처 N개"**, Export 액션 = **"AI에게 넘기기"**, 토스트 어미 = **"~했어요"**.

---

### Task 1: 죽은 코드 제거 + 자잘한 수정

**Files:** `src/lib/image.ts`, `src/db/db.ts`, `src/lib/budget.ts`, `src/lib/prompt.ts`, `src/screens/export.ts`, `src/lib/viewer.ts`, `src/lib/cropframe.ts`, `src/styles/app.css`

- [ ] image.ts: `grabFrame`(**금지 API createImageBitmap 포함**)·`resizeCompress` 제거(참조 0 — grep 재확인). 헤더 주석 "저장 직후 백그라운드" → 셔터 시점으로 정정.
- [ ] db.ts: `endSession` 제거(참조 0, endOpenRoundsForBook이 대체). `deleteSession` export 해제(내부용화).
- [ ] budget.ts: `time`/`getSamples`/`p95` 제거(참조 0). 헤더의 "p95≤3000ms" 주석 ADR-011 기준으로 정정.
- [ ] prompt.ts: `ExportPackage`에서 `files` 제거(모든 캡처 Blob 배열을 만들고 아무도 소비 안 함) → `{ promptMd, imageCount }`. buildExport 내 files 구성 로직 삭제. export.ts 사용부 무영향 확인.
- [ ] export.ts: `unsupported` 분기에 `await markExported(caps)` 추가(분기 일관성).
- [ ] viewer.ts: 크롭 `toBlob` 후 `canvas.width = 0; canvas.height = 0;` 해제 추가(iOS 메모리 일관성).
- [ ] cropframe.ts: `loadCropRect` export 해제(내부 전용).
- [ ] app.css 죽은 CSS 제거(~70줄, TS 참조 0 확인 후): `.chips/.chip/.chip--write`, `.detail__q`, `.srow.warn`, `.dot--off`, `.bookmeta`, `.danger-link`.
- [ ] `npm run build` + `npm run test:pdf` → 커밋 `chore: 감사 후속 — 죽은 코드/CSS 제거 + 자잘한 정리`

### Task 2: recentBooks 성능 (이미지 실체화 제거)

**Files:** `src/db/db.ts`, `src/db/types.ts`

- [ ] `Session.lastCaptureAt?: number` 선택 필드 추가(마이그레이션 불필요). `addCapture`에서 캡처 저장 후 해당 세션에 `putSession({ ...s, lastCaptureAt: c.createdAt })`(세션 로드 1회 — 레코드 작음).
- [ ] `recentBooks`: 캡처 카운트를 `countCaptures`(countFromIndex — 레코드 로드 0)로, `lastActivity = max(세션들.started, 세션들.lastCaptureAt ?? 0)`로 교체 — **capturesForSession 호출(이미지 ArrayBuffer→Blob 실체화) 완전 제거**. 레거시(lastCaptureAt 없는 세션)는 started 폴백(정렬이 약간 달라질 수 있음 — 새 캡처부터 자가 교정, 수용).
- [ ] BookView 시그니처 불변(회독 필드 포함 — 잠복 유지, 계산은 세션만으로).
- [ ] `npm run build` + `test:pdf` → 커밋 `perf: recentBooks 이미지 실체화 제거(countFromIndex+lastCaptureAt)`

### Task 3: 문구·탭타깃·피드백 통일 (UX 감사 반영)

**Files:** `src/screens/*.ts`, `src/lib/bookpicker.ts`, `src/styles/app.css`, `src/styles/tokens.css`

- [ ] **캡처 수 "캡처 N개" 통일**: home.ts(:110 "N Captures", :128 "N captures"), bookpicker.ts(:37), review.ts(:80 "N개의 Capture", :108), export.ts(:54).
- [ ] **Export 액션 "AI에게 넘기기" 통일**: review.ts:87 "이 책 전체 AI에게 넘기기", :112 "📤 AI에게 넘기기", export.ts:46 화면제목 "AI에게 넘기기", :62 "📄 PDF로 AI에게 넘기기".
- [ ] **라벨 통일**: "담고 싶은 글"→"담은 글"(capture 입력 모드 라벨), "내 생각 (선택)" 라벨의 (선택)은 placeholder로.
- [ ] **토스트 어미 "~했어요"**: export.ts "PDF를 내려받아요"→"PDF를 내려받았어요", "프롬프트 복사됨"→"프롬프트도 복사했어요" 등(:101,:104,:111). books.ts:99 confirm "지워집니다"→"지워져요". books 편집 저장·detail 저장에 "저장했어요" 토스트 추가(books는 renderList에도 toast 요소).
- [ ] detail 검증 alert() → field--err+토스트(capture 패턴).
- [ ] **탭타깃**: `.pill .cnt` min-height 44px(세로 패딩 확대), `.scopebtn` min-height 44px.
- [ ] **토큰**: `--danger: #ff6b6b`·`--line: #e5e8eb` 신설 후 사용처 교체, `--r-card` 20px로 현실 정합, bookpick radius 대칭 20px.
- [ ] bookpicker 빈 상태 "책이 없어요"→"아직 책이 없어요 — 책장에서 먼저 등록해 주세요".
- [ ] aria-label: 라이트 화면 뒤로가기 "‹" 전부 `aria-label="뒤로"`, 편집시트 사진에 "탭하면 확대".
- [ ] `npm run build` → 커밋 `polish: 문구·탭타깃·토스트 통일(감사 반영)`

### Task 4: 문서 드리프트 해소

**Files:** `CLAUDE.md`, `docs/decisions.md`, `docs/glossary.md`, `README.md`, `src/db/types.ts`(주석), `src/lib/share.ts`(주석)

- [ ] **CLAUDE.md**: Export 파이프라인 서술을 현실로 — "prompt.md는 **클립보드**로(내보내기 시 자동 복사), PDF는 **표지+사진 자료 전용** — 둘을 함께 AI에 전달하는 2채널(ADR-019)". lib 목록에 `install.ts`(PWA 설치+공유수신), `aladin.ts`(표지 검색, ADR-017), `bookpicker.ts`(책 선택 시트), `cropframe.ts`(뷰파인더 크롭 프레임) 추가. 도메인 모델 문단에 편집 시트 사진 규칙(사진 있으면 태그만 필수) 반영.
- [ ] **ADR-019** 추가: Export 2채널 확정 — 프롬프트 v3(원문 전사·요약 금지)→v4(다중 턴 프로토콜: 전사 먼저·나눠서·거부 금지·"계속" 후 분석) + PDF 자료 전용 전환(표지 1장+사진, 프롬프트 페이지 제거). ADR-008/009 개정 명시.
- [ ] **glossary.md**: 사진 경로(편집 시트), Export(2채널·v4), 백업(단일 JSON — "ZIP" 정정), Why 잔재 제거.
- [ ] **README.md**: ADR 범위 ~019, 캡처 예산 서술 ADR-011 기준, Why 제거.
- [ ] 잔주석: types.ts "memo는 레거시 호환" 정정(생각만 저장 1급), share.ts 헤더(현재는 PDF 1개+텍스트 공유), ADR-003에 파라미터 개정 메모 1줄(3200px/0.8).
- [ ] `npm run build` → 커밋 `docs: 감사 드리프트 해소 — CLAUDE.md 2채널·ADR-019·glossary·README`

## Self-Review
감사 P2 전 항목 → T1·T3, P1-2 → T2, P1-3·4 → T3, P3 전 항목 → T4. 잠복 헬퍼 보존 명시. 플레이스홀더 없음(전 항목 file:line 감사 근거). ✓
