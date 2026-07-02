# 캡처 대상 책 전환 — 입력모드 + 캡처 상세 (spec)

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
- `listBooks()`(등록순) 또는 `recentBooks(50)`(최근 활동순 — **채택: 최근 활동순이 목적에 부합**, BookView 재사용)로 목록. 행: 표지(mini, `cover instanceof ArrayBuffer` 가드 — objectURL은 시트 닫힐 때 revoke) + 제목 + 회독 배지. 현재 책은 체크 표시·탭 시 그냥 닫기.
- 기존 시트 스타일(install-sheet/coveropt 톤) 재사용, 스크림 탭/닫기 버튼으로 dismiss. 탭타깃 ≥48px.
- 시트 내부에서 생성한 objectURL은 dismiss 시 전부 revoke(자체 관리 — 호출 화면과 독립).

### 2. `src/screens/capture.ts` — 입력모드 책 전환
- 상단 pill의 책 제목 영역: **입력모드일 때만** 탭 핸들러 → `openBookPicker(root, { currentBookId, onPick })`.
- `onPick(book)`: `const sid = await currentRoundFor(book.uuid);` → **화면 상태 교체**: `session`(회독)·책 제목 표시 갱신, **입력 필드(inpPassage/노트/페이지/선택 태그) 값은 그대로**. 재마운트(nav) 방식이 아니라 in-place 교체(텍스트 유지가 핵심 요구). 저장 시 새 session.uuid로 addCapture.
  - 구현 주의: capture.ts가 `session`을 로컬 상태로 들고 있으므로 `session = await getSession(sid)` + 제목 갱신이면 충분한지 확인(카메라는 입력모드라 무관). 사진 모드 전환 시에도 바뀐 세션 유지(모드 토글은 화면 내 상태).
- pill에 시각적 힌트(작은 ▾) — 입력모드에서만. 사진 모드는 기존 그대로(핸들러 없음).

### 3. `src/screens/detail.ts` — 캡처 책 이동
- 상세 화면에 현재 책 이름 표시 + **"책 바꾸기"** 액션(기존 편집 UI 톤에 맞게 — 행/버튼) → `openBookPicker` → `onPick`: `const sid = await currentRoundFor(book.uuid); cap.sessionId = sid; cap.updatedAt = Date.now(); await updateCapture(cap);` → 토스트("『제목』(으)로 옮겼어요") + 표시 갱신.
- detail이 책 제목을 이미 표시하는지 확인 — 없으면 세션→책 로드해 표시(작게).

## 제약/디자인
- 사진 모드 3초 루프 불변(핸들러 자체를 입력모드에서만 배선).
- 시트는 토스-클린 밝은 바텀시트, 마이크로카피 "책 바꾸기"(두 곳 동일 액션명).
- currentRoundFor만 사용(회독 생성 규율 유지 — startNewSession 금지).
- 이동 후 원래 회독이 빈 회독이 되어도 그대로 둠(삭제 안 함 — 단순성; 빈 회독은 Review에서 자연히 안 보임(캡처 구분은 비어있는 회독 스킵)).

## 검증
`npm run build` + preview: 입력모드에서 pill 탭→책 전환→텍스트 유지→저장이 새 책 회독으로; 공유 수신 후 책 전환; detail에서 책 바꾸기→Review(새 책)에 캡처 표시; 사진 모드 pill 무반응. `test:pdf` PASS. 실기기 확인.

## 범위 밖
- 사진 모드 책 전환, 다중 캡처 일괄 이동, 이동 취소(undo).
