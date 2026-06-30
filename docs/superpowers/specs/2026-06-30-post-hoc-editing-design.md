# 사후 편집 & 캡처 상세 보기 — 설계 (spec)

날짜: 2026-06-30
관련: PRD §8 (Review), ADR-001~006 (도메인), docs/design-language.md (토스 라이트)

## Context

지금 앱은 빠르게 "붙잡기"(캡처)는 되지만, 한 번 만든 것을 **다시 보고 고치는 길이 거의 없다.**
- Review에서 캡처는 **삭제만** 되고 탭해도 무동작 — 큰 사진·내용 수정 불가.
- 책·세션은 생성 후 편집 불가 (오타·목적 변경·저자/ISBN 추가 못 함).
- 페이지 번호를 남길 곳이 없다 (`Capture`에 `page` 필드 자체가 없음).

목표: **이미 만든 캡처·책·세션을 사후에 보고 고칠 수 있게** 한다. 단, 캡처 3초 루프(PRD §16) 철학과 "단순함"을 깨지 않는다.

핵심 UX 원칙 (사용자 합의):
1. **너무 복잡하지 않게** — 별도 전체화면 라이트박스 등은 빼고 최소 구성.
2. **태그 ≠ 왜** — 태그(이 순간의 느낌)와 왜(나중 용도)가 헷갈리지 않게 역할을 분명히 분리.
3. **태그는 이모지+텍스트** — 전 화면에서 `💡 흥미롭다`처럼 라벨을 붙여 이해를 쉽게.

## 범위

포함: 태그 라벨화, 태그/왜 역할 구분, 캡처 상세+편집 화면, 캡처 중 페이지 입력, 책 편집, 세션 편집.
범위 밖(다음 후보): 책 표지 사진, 세션·책 삭제, 세션의 책 재지정, 전체화면 이미지 라이트박스.

## 데이터 모델 (`src/db/types.ts`, `src/db/db.ts`)

- `Capture`에 선택 필드 추가: `page?: number`.
  - IndexedDB는 레코드 단위 스키마리스 → **DB 버전업 불필요**. 기존 캡처는 `page`가 `undefined`.
- `db.ts`에 조회 함수 1개 추가:
  ```ts
  export async function getCapture(id: string) {
    return (await db()).get("captures", id);
  }
  ```
- 기존 재사용: `updateCapture`(이미 put), `putBook`, `putSession`, `getBook`, `getSession`.

## A. 태그 라벨화 (교차 변경)

태그를 이모지 단독이 아니라 **이모지+텍스트**로 표시. `TAGS`(types.ts)의 `emoji`/`label`을 그대로 사용.

- `screens/capture.ts` 태그행: `<button class="tag">${t.emoji}</button>` → `${t.emoji} <span>${t.label}</span>` (가로 공간상 한 줄 라벨; 5개가 한 줄에 들어가게 CSS 조정 — 작은 폰트/줄임).
- `screens/review.ts` `card()`의 `captag`: 이모지 옆에 라벨 노출(`💡 흥미롭다`). 전 화면 일관 적용.
- 상세 화면: 태그 선택 UI에 라벨 표시.
- CSS: `src/styles/app.css`의 `.tag`, `.captag` 등에 라벨 표시용 스타일 추가.

## B. 태그 vs 왜 — 역할 구분

상세 화면과 캡처 시트에서 두 묶음에 안내 문구를 분명히:
- 태그 섹션 제목: **"이 순간은? (하나만)"** — 필수·단일, 라벨 알약.
- 왜 섹션 제목: **"왜 남겼나? (선택)"** — 선택, 가벼운 칩.
- 시각 차이: 태그=채워진 라벨 알약(선택 시 강조), 왜=윤곽 칩. CSS로 명확히 구분.

## C. 캡처 상세 + 편집 화면 — 신규 `src/screens/detail.ts`

라우트 추가 (`src/app.ts`):
```ts
| { name: "detail"; captureId: string; from: { scope: Scope; id: string } }
```
- `mountApp`의 switch에 `case "detail": cleanup = mountDetail(root, nav, route.captureId, route.from)` 추가.
- `from`은 뒤로가기 시 돌아갈 Review(scope+id) 좌표.

진입: `screens/review.ts`의 캡처 카드 탭 → `nav({ name: "detail", captureId: c.uuid, from: { scope, id } })`. (현재 무동작인 `.capcard` onclick 추가; 삭제 버튼은 `stopPropagation` 유지)

화면 구성 (`scr scr--light`, 토스 라이트):
- 상단바: ‹ 뒤로(= `nav({ name: "review", scope: from.scope, id: from.id })`).
- **큰 사진**: `Capture.image`(Blob)를 `URL.createObjectURL`로 표시. 이미지 없으면 메모 placeholder. (cleanup에서 `revokeObjectURL`)
- 편집 필드:
  - **태그**: TAGS 라벨 알약, 단일 선택(필수). 섹션 B 적용.
  - **왜**: WHY_CHIPS 칩 + "직접 입력". 선택.
  - **메모**: textarea (`memo`).
  - **페이지**: `<input type="number" inputmode="numeric">` (`page`).
  - 생성 시각: 읽기 전용 표시.
- **저장** 버튼(명시 저장, 자동저장 아님): 변경분을 모아 `updateCapture({ ...cap, tag, why, memo, page, updatedAt: Date.now() })`. `isValidCapture` 위반 시(둘 다 비면) 저장 막고 안내. 저장 후 Review로 복귀.

반환값: `() => urls.forEach(revokeObjectURL)`.

## D. 캡처 중 페이지 입력 (`src/screens/capture.ts`)

왜-시트(`.sheet`)에 **선택적 페이지 숫자칸** 추가:
- 템플릿: textarea 위/아래에 `<input class="sheet__page" type="number" inputmode="numeric" placeholder="페이지(선택)">`.
- 저장 핸들러(`saveBtn.onclick`): `page = parseInt(value)` 유효하면 `rec.page`에 설정. 비면 미설정.
- **3초 루프 보호**: 자동 포커스 금지(태그·왜 흐름 방해 X), 비워도 저장 정상.

## E. 책 편집 (`src/screens/books.ts`)

책 목록 행(`bookRow`)에 **✎ 편집 버튼** 추가:
- 행 본문 탭 = 기존대로 세션 시작(`renderProject`), ✎ 버튼 탭 = 편집 폼(`stopPropagation`).
- 편집 폼: 생성 폼 레이아웃 재사용 + **ISBN** 입력 추가. 제목·저자·ISBN 수정 → `putBook({ ...book, title, author, isbn })` → 목록 갱신.
- 제목 빈값 검증은 생성과 동일(필수, ADR-006).

## F. 세션 편집 (`src/screens/review.ts`)

Review 상단바(scope === "session"일 때)에 **✎** 추가:
- 탭 → 목적(`project`) 인라인 편집(작은 입력 + 저장) → `putSession({ ...session, project })` → 헤더 갱신.
- 세션 객체가 필요하므로 로드 시 `getSession` 결과를 보관(현재 `bookId`만 보관 → `session` 전체 보관으로 변경).

## 영향 파일 요약

- `src/db/types.ts` — `Capture.page?` 추가.
- `src/db/db.ts` — `getCapture` 추가.
- `src/app.ts` — `detail` 라우트 + 분기.
- `src/screens/detail.ts` — **신규**.
- `src/screens/review.ts` — 캡처 탭→상세, 세션 편집 ✎, 카드 태그 라벨.
- `src/screens/capture.ts` — 태그 라벨, 시트 페이지칸.
- `src/screens/books.ts` — 책 편집 ✎ + ISBN.
- `src/styles/app.css` — 태그 라벨/알약·칩 구분·상세 화면·편집 폼 스타일.

## 검증 (Verification)

이 프로젝트는 자동 테스트 프레임워크가 없다. 검증은 빌드 + 수동 동작 확인으로 한다.
1. `npm run build` — tsc 타입체크 + vite 빌드 무에러(라우트/타입 추가가 타입체크 통과).
2. `npm run preview` 로컬 구동 후 흐름 확인:
   - 캡처 → 태그가 이모지+텍스트로 보임. 시트에서 페이지 입력하고 저장.
   - Review에서 캡처 탭 → 상세에 큰 사진+필드. 메모/태그/왜/페이지 고치고 저장 → Review/재진입 시 반영.
   - 둘 다 비우면 저장 거부(`isValidCapture`).
   - 책 목록 ✎ → 제목/저자/ISBN 수정 반영. 행 탭은 여전히 세션 시작.
   - Review(세션) ✎ → 목적 수정 반영. 캡처 화면 상단 목적도 갱신됨.
   - 태그와 왜가 시각·문구상 분명히 구분됨.
3. 기존 3초 캡처 루프가 느려지지 않았는지 HUD(app/사람 ms)로 확인.

## 미해결/주의

- 태그 5개를 라벨까지 한 줄에 넣을 때 캡처 화면 가로폭 — 작은 폰트 또는 2열 등 CSS 조정 필요(구현 중 실측).
- 상세 저장은 명시 버튼(자동저장 아님) — 사용자 합의.
