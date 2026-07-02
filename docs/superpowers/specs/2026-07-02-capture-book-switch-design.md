# 캡처 대상 책 전환 + 생각만 캡처 — 입력모드/상세 (spec)

날짜: 2026-07-02
관련: ADR-016(책 중심·회독, currentRoundFor), 공유 수신(share_target), ADR-014(캡처 모델)

## Context

공유로 텍스트를 받으면 "가장 최근 캡처한 책"의 현재 회독으로 들어가는데, **읽던 책이 바뀌었을 수 있다**. 또한 이미 저장된 캡처(노트)의 소속 책을 바꾸는 것도 어렵지 않아야 한다. → 두 지점에서 책 전환:

1. **입력모드(전체 — 공유 수신 포함):** 캡처 화면 상단 책 제목(pill) 탭 → 책 선택 시트 → **입력 중인 텍스트(담은 글/생각/페이지/태그) 유지**한 채 대상만 그 책의 현재 회독으로 전환.
2. **캡처 상세(detail):** 저장된 캡처에 "책 바꾸기" → 같은 시트 → `capture.sessionId = currentRoundFor(선택 책)` → updateCapture.

사진 모드는 불변(3초 루프 신성 — pill 탭 무동작 유지).

## 컴포넌트/변경

### 1. `src/lib/bookpicker.ts` (신규, 공용)
```ts
/** 밝은 바텀시트로 책 목록을 보여주고 선택을 콜백. 표지 있으면 썸네일. */
export function openBookPicker(
  root: HTMLElement,
  opts: { currentBookId?: string; onPick: (book: Book) => void },
): void;
```
- `recentBooks(50)`(최근 활동순, BookView 재사용)로 목록. 행: 표지(mini, `cover instanceof ArrayBuffer` 가드) + 제목 + 회독 배지. 현재 책은 체크 표시·탭 시 그냥 닫기(no-op).
- **CSS(검토 4): install-sheet 단순 재사용 불가** — 목록 시트라 `max-height` + `overflow-y: auto` + `-webkit-overflow-scrolling: touch` 필요(.input-panel 패턴 참조). 행 ≥48px. 오버레이는 **document.body에 append**(viewer.ts 방식 — 화면 재렌더에 안 죽게). 스크림 탭/닫기로 dismiss. 참고: 입력모드 배경은 **밝음**(.cam.mode--input) — 밝은 시트가 자연스럽게 어울림(검토 확인).
- 시트 내 objectURL은 dismiss 시 전부 revoke(자체 관리 — 호출 화면과 독립).
- **메모리(검토 6, 수용):** recentBooks는 책마다 캡처 전체(이미지 ArrayBuffer 포함)를 순회 — 사진 많은 서재에선 일시적 메모리 비용. 홈이 이미 같은 비용 지불(신규 점근 비용 없음). 후속 개선 아이디어: countCaptures + byCreated 커서 1패스.

### 2. `src/screens/capture.ts` — 입력모드 책 전환
- **핸들러 게이팅(검토 1):** 모드는 런타임 토글이므로 mount 시점 분기 금지 — `.pill__title`에 핸들러를 **한 번** 배선하고 내부에서 `if (currentMode !== "input") return;`. (mount 분기 시: photo→input 토글하면 기능 소실 / input→photo 토글하면 사진 모드로 누수.)
- 검토 확인: 저장(사진/입력)·카운트 칩 네비 모두 이벤트 시점에 `session.uuid`를 읽는 **늦은 바인딩** → 클로저 변수 재할당으로 충분. 교체 후 사진 모드 토글해 찍어도 새 세션 유지.
- **`onPick(book)`은 3가지 갱신(검토 2):** ① `session = (await getSession(await currentRoundFor(book.uuid)))!` ② `.pill__title` **전체 재렌더**(제목 + `session.project` 칩 — 옛 회독 목적 칩 잔류 방지, esc 필수) ③ `count = await countCaptures(session.uuid)` + `cntEl` 텍스트 갱신(옛 회독 수 잔류 방지). 입력 필드 값은 그대로.
- **pick 레이스(검토 5):** 시트 dismiss는 위 3가지 갱신 **완료 후에**(교체 중 빠른 저장이 옛 회독으로 가는 창 제거).
- ▾ 힌트는 **CSS로**: `.cam.mode--input .pill__title::after`(모드 클래스에 자동 연동, JS 불필요). `.pill__title` 탭 히트영역은 입력모드에서 패딩 확대(pill이 ~40px — ≥48px 규칙).

### 3. `src/screens/detail.ts` — 캡처 책 이동
- **전제(검토 3): detail은 현재 세션/책 컨텍스트가 전혀 없음**(getCapture만 로드) → `getSession(cap.sessionId)` + `getBook(session.bookId)` 로드 추가(책 이름 표시 + picker의 currentBookId용). import 확장.
- 현재 책 이름 표시 + **"책 바꾸기"** 액션 → `openBookPicker` → `onPick`: `cap.sessionId = await currentRoundFor(book.uuid); cap.updatedAt = Date.now(); await updateCapture(cap);` → 토스트("『제목』(으)로 옮겼어요") + 표시 갱신. (cap in-place 변이는 기존 저장 스프레드와 정합 — 검토 확인.)
- **toast div가 detail에 없음** → books.ts/export.ts 패턴(.toast + setTimeout 2400ms)으로 추가.
- **이동 후 back 동작(명시):** back은 기존 `from`(옛 Review)으로 — 캡처가 거기 없을 수 있음을 **수용**(문서화된 의도). 새 책 Review로 강제 이동하지 않음(단순성).

## 제약/디자인
- 사진 모드 3초 루프 불변(핸들러 자체를 입력모드에서만 배선).
- 시트는 토스-클린 밝은 바텀시트, 마이크로카피 "책 바꾸기"(두 곳 동일 액션명).
- currentRoundFor만 사용(회독 생성 규율 유지 — startNewSession 금지).
- 이동 후 원래 회독이 빈 회독이 되어도 그대로 둠(삭제 안 함 — 단순성; 빈 회독은 Review에서 자연히 안 보임(캡처 구분은 비어있는 회독 스킵)).

## 검증
`npm run build` + preview: 입력모드에서 pill 탭→책 전환→텍스트 유지→저장이 새 책 회독으로; 공유 수신 후 책 전환; detail에서 책 바꾸기→Review(새 책)에 캡처 표시; 사진 모드 pill 무반응. `test:pdf` PASS. 실기기 확인.

### 4. 입력모드 "생각만 캡처" 허용 (추가 요구)
- **맥락:** 책 전반에 드는 생각을 — 특정 구절(passage)이나 사진 없이 — 기록하고 싶다. 모델(ADR-014 `isValidCapture` = 사진‖담은글‖메모 + 태그)은 이미 허용; **입력모드 UI만 passage를 강제**(capture.ts:306, placeholder "(필수)").
- **변경(capture.ts 입력모드만):**
  - 검증: `if (!passageVal) reject` → **`if (!passageVal && !noteVal)`**(둘 다 비면 두 필드 모두 `field--err` + return). 그 아래 기존 `isValidCapture` 검사 유지. (note 요소 실명: `inpNote`.)
  - note 입력에도 `oninput` 에러 클리어 추가(passage와 동일 패턴). **[델타검토 3] 두 리셋 경로(setMode("photo") :153 부근, 저장 후 초기화 :350 부근)에서도 `inpNote`의 `field--err` 클리어 추가**(현재 passage만 클리어).
  - placeholder: 담은 글 "(필수)" → **"(선택)"**; note placeholder는 현행 유지(또는 "내 생각 — 이것만 적어도 저장돼요" 톤 확인 후 plain하게).
  - 파일 헤더 주석 "passage(필수)" → "passage 또는 note ≥1"로 정정.
- 표시/Export/PDF는 이미 메모-only 캡처를 처리(사진 모드가 원래 메모만 저장 가능) — 변경 없음.

### 5. Review 캡처 목록 날짜 구분선 (추가 요구)
- **맥락:** 기록이 여러 날에 걸침. 캡처는 `createdAt` 보유 — 렌더만. **회독 UI 잠복(§6)에 따라 날짜가 목록의 유일한 구조**가 됨.
- **변경(review.ts):** 캡처 목록(책·세션 스코프 모두)에 **날짜 구분 라벨 상시 삽입** — 캘린더 일 기준(로컬), "— 7월 2일 —"(올해 아니면 연도 포함). 회독 구분(roundsep)은 §6에서 제거되므로 중첩 없음 — flat 목록 + 날짜 라벨.
- 스타일: `.datesep`(작고 옅은 회색, 중앙). 토글 없음. 그룹핑은 `startOfDay(createdAt)` 비교(정렬 createdAt asc 유지).

### 6. 회독 UI 잠복 (추가 요구 — 기능 되돌림, 구조 보존)
- **결정:** 회독은 지금 필요 없음 — **UI에서 전부 걷어내고, 데이터·헬퍼(Session/roundNo/currentRoundFor/startNewSession 등)는 그대로** 남겨 나중에 재도입 가능하게(ADR-016 개정 메모).
- **걷어낼 UI:**
  - 홈/책장 카드의 회독 배지(`roundLabel` "N회독 · 제목") → **캡처 수 + 최근 활동만**(카드 단순화).
  - 책 Review: 회독 배지·✎(회독 번호/제목 편집)·**"새 회독 시작" 버튼**·회독 구분선(roundsep) 제거. 목록은 `capturesForBook`(flat) + 날짜 구분선(§5).
  - 세션 스코프 Review(캡처 카운트 칩 진입): 유지하되 문구 중립화 — "이번 회독" → **"최근 기록"**; "이 회독 삭제" 위험 링크는 **제거**(책 삭제로 충분 — 위험 액션 감소).
  - Export 스코프 라벨: "이번 회독" → **"최근 기록"**(prompt.md 범위 라벨 동일).
- **남기는 구조(잠복):** db의 회독 헬퍼 전부(미사용화되어도 삭제 안 함 — 재도입 여유; review.ts import는 정리: capturesWithRoundsForBook/deleteSession/displayRoundNo/putSession/sessionsForBook/startNewSession 드롭, capturesForBook 추가 — 델타검토 6), `Session.roundNo`, bookpicker는 캡처 수 표시.
- **[델타검토 5] books.ts renderProject(새 책 시작 화면)의 회독 문구 중립화:** topbar/버튼 "회독 시작" → **"독서 시작"**, "회독 제목 (선택)" → **"목적 (선택)"**(project는 계속 설정 가능 — pill 🎯·prompt.md 목적에 유용해 유지, "설정 경로 소멸" 아님을 정정). 삭제 confirm(books.ts:99) "모든 회독·캡처" → **"모든 기록·캡처"**, transfer 복원 flash "회독 N" → **"기록 N"**.
- CSS 정리: `.hero__round`/`.roundsep`/`.review__editproj`는 review 전용 — 제거 가능. `.scopebtn`은 유지(세션 스코프 버튼).
- ADR-016에 개정 메모 + **glossary.md의 "새 회독 시작" 항목도 갱신**(델타검토).

### 7. 입력모드 필드 순서 재배치 (추가 요구)
- **맥락:** 사진 모드 플로우(셔터 → **태그** → 글)와 논리 일치 — 태그(느낌)를 먼저 고르고 쓰는 흐름.
- **변경(capture.ts 입력모드 마크업):** 현재 순서(passage → note → page → hint → tagrow → save, capture.ts:429-439)를 **① `.inp__hint` + `.inp__tagrow`(태그 — hint는 태그 에러 안내이므로 함께 이동, 델타검토 4) → ② 담은 글 → ③ 내 생각 → ④ 페이지 → 저장**으로 재배열. 배선·CSS 전부 클래스 셀렉터(형제 셀렉터 없음 — 검토 확인)라 마크업 이동 안전. 자동 포커스는 passage 유지.
- 공유 수신 프리필(passage)·에러 표시(§4) 동작 불변.

### 8. 입력모드 저장 토스트 (추가 요구)
- **맥락:** 입력 저장 시 확인 피드백이 약해 사용자가 당황 — 명확한 토스트 필요.
- **변경(capture.ts):** 입력모드 저장 성공 시 토스트 **"저장했어요"** ~3초.
- **[델타검토 1] 입력 저장이 이미 `showDone()`(전면 ✓ 배지)을 호출 중(capture.ts:353)** → 토스트 추가 시 **입력 경로의 showDone() 제거**(이중 피드백 방지). 사진 경로(:250)는 불변.
- **[델타검토 2]** capture 템플릿에 `.toast` 없음 → 추가(books/export 패턴). `.toast`가 저장 버튼 위에 3초 얹히므로 **`pointer-events: none`** 부여. 연속 저장 시 타이머 리셋.

### 9. 동결 화면에서 크롭 프레임 유지 (추가 요구)
- **문제:** 셔터 후 동결(freeze) 미리보기에 크롭 프레임이 숨겨져(`.cam.is-frozen .cropframe { display:none }` — 크롭 배치 때 추가) **전체 사진이 보임** → 사용자가 크롭이 안 된 걸로 착각. 실제 저장은 프레임 영역만.
- **변경:** 해당 숨김 규칙 **제거** — 동결 상태에서도 프레임+마스크가 동결 사진 위에 유지(무엇이 저장될지 정직하게 표시). 입력모드 숨김(`.cam.mode--input .cropframe`)은 유지.
- **부수 효과(의도):** 저장이 저장 시점의 `cropFrame.getRect()`를 읽으므로, 동결 중 프레임 조정도 **저장에 반영**(보이는 대로 저장 — 찍고 나서 미세조정 가능).
- z-index 확인: 프레임 z2 < freeze(z1) 위 OK, 컨트롤(z3)·시트(z4/5) 아래 — 태그/시트 조작 방해 없음. 성능·3초 루프 영향 없음(CSS 규칙 1줄).

## 의도된 비동작 (검토 7 — 문서화)
- **같은 책 pick = 순수 닫기** → 같은 책의 옛 회독 캡처를 현재 회독으로 옮기는 건 범위 밖.
- **회독 없는 책 pick은 열린 회독을 생성**(currentRoundFor get-or-create — 홈 버튼과 동일 의미론). 저장 안 하면 빈 회독이 남을 수 있음 — 수용(빈 회독은 표시에서 자연 스킵).

## 범위 밖
- 사진 모드 책 전환, 다중 캡처 일괄 이동, 이동 취소(undo), recentBooks 경량화(후속).
