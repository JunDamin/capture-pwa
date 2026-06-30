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

포함: 태그 라벨화, 태그/왜 역할 구분, 캡처 상세+편집 화면, 캡처 중 페이지 입력, 책 편집, 세션 편집, **가로 모드(카메라+사진 집중)**.
범위 밖(다음 후보): 책 표지 사진, 세션·책 삭제, 세션의 책 재지정, 전체화면 이미지 라이트박스, **나머지 화면(Home/Review/책/Export)의 가로 전용 정돈**(가로에서 "깨지지 않고 쓸 수 있는" 수준까지만).

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

태그와 왜를 **타입(생김새)으로** 구분한다 (디자인 언어 지시):
- 태그: 라벨 색 알약, 필수·단일. 안내는 기존 문구 "한 가지 태그를 고르세요" 재사용.
- 왜: **질문체 Display 중간 굵기 "왜 저장했나요?"** + 가벼운 윤곽 칩, 선택.
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

## G. 가로 모드 (landscape) — 카메라+사진 집중

책 펼침면은 가로로 길어 가로 촬영이 잦다. 가로를 지원한다.

- **데이터/압축은 변경 없음.** `lib/image.ts`는 이미 긴 변 기준(`Math.max(w,h)`) 리사이즈 + 실제 `width/height` 저장 → 와이드 이미지 그대로 처리됨.
- **매니페스트 세로 고정 해제** (`vite.config.ts`): `orientation: "portrait"` → `"any"`. PWA는 방향을 풀면 OS가 전 화면을 회전시키므로 "카메라만 가로"는 불가 — 전 화면이 회전한다는 전제로 간다.
- **카메라 화면 가로 레이아웃** (`screens/capture.ts` 템플릿 + `app.css`): `@media (orientation: landscape)`로 다크 풀블리드 유지하되 컨트롤 재배치 — 비디오 `object-fit: cover`로 채우고, 하단 패널(태그행+셔터)·상단 pill·왜-시트가 가로에서도 thumb 도달·≥48px 유지. (가로에선 컨트롤을 우측/하단 안전영역에 맞춰 압축)
- **와이드 이미지 표시**: 상세 화면 hero 사진과 Review 썸네일이 가로 비율을 깨지 않게 — `imageW/imageH` 기반 `aspect-ratio` 또는 `object-fit`(상세=contain로 전체 보이게, 썸네일=cover). `cam__freeze`도 `object-fit: cover`.
- **나머지 화면**: 가로에서 깨지지 않게만 — 콘텐츠 `max-width` 제약으로 카드가 과도하게 늘어나지 않게 중앙 정렬, 세로 리스트는 스크롤로 사용 가능 확인. 가로 전용 정돈은 범위 밖.

## 영향 파일 요약

- `src/db/types.ts` — `Capture.page?` 추가.
- `src/db/db.ts` — `getCapture` 추가.
- `src/app.ts` — `detail` 라우트 + 분기.
- `src/screens/detail.ts` — **신규**.
- `src/screens/review.ts` — 캡처 탭→상세, 세션 편집 ✎, 카드 태그 라벨.
- `src/screens/capture.ts` — 태그 라벨, 시트 페이지칸.
- `src/screens/books.ts` — 책 편집 ✎ + ISBN.
- `src/styles/app.css` — 태그 라벨/알약·칩 구분·상세 화면·편집 폼 스타일 + **가로 모드 미디어쿼리**(카메라·이미지·콘텐츠 max-width).
- `vite.config.ts` — 매니페스트 `orientation: "any"` (세로 고정 해제).
- `lib/image.ts` — **변경 없음**(가로 이미 처리됨).

## 구조 점검 결과 (codebase-design)

설계의 모듈/seam을 점검해 다음을 확정한다.

1. **공유 편집 컴포넌트는 만들지 않는다.** 캡처 시트와 상세 화면이 둘 다 태그/왜/메모/페이지를 다루지만, 빠른 모달(페이즈 머신)과 전체 편집 화면은 맥락이 달라 억지 공유는 잘못된 seam이다. 공유 seam은 이미 올바른 위치(`types.ts`의 `TAGS`/`WHY_CHIPS`/`isValidCapture`)에 있고, **데이터·검증만 공유**한다. 뷰의 소규모 중복(칩 토글 등, 1회)은 허용 — rule-of-three 미달.
2. **책 폼은 하나로 겸용.** `books.ts`에서 생성·편집을 `renderBookForm(book?)` 하나로 처리(두 폼 따로 만들지 않는다).
3. **`review.ts` 책임 누적 주의.** 요약+캡처탭+삭제+세션편집으로 커진다. 지금은 세션편집이 작아 허용하나, 비대해지면 분리 신호로 본다.
4. **카메라 화면 태그 라벨은 레이아웃 리스크.** 좁고 어두운 카메라 화면에 태그 5개+풀 텍스트를 한 줄에 넣지 않는다. 카메라엔 이모지+작은 라벨, 확정 라벨은 왜-시트 헤더(이미 `${emoji} ${label}`)로 보강. Review/상세는 풀 라벨.
5. **라우트 `from`은 정당.** 캡처만으로 책범위/세션범위를 알 수 없으므로 복귀 좌표를 라우트에 싣는다.

## UX 방향 (frontend-design / docs/design-language.md 준수)

기존 토스-derived 디자인 언어를 브리프로 삼는다. 새 정체성을 만들지 않고 **기존 언어에 네이티브하게** 녹인다.

1. **태그 라벨 ↔ 색 규율.** 디자인 언어상 "태그 = 화면의 유일한 색 이벤트". 라벨을 붙이되 **이모지는 색 팝 유지, 텍스트 라벨은 잉크/Sub 무채색**. 카메라 태그 버튼 = 이모지(큼) + 아래 작은 라벨(11px Sub), 5개 한 줄·탭타깃 ≥48px, 선택 시 기존 스프링 '팝' 유지. Review/상세는 `💡 흥미롭다` 풀 라벨.
2. **태그 vs 왜 = 타입으로 구분.** 디자인 언어 지시대로 "왜 저장했나요?"는 폼 라벨이 아니라 **질문체 Display 중간 굵기**(선택). 태그는 **라벨 색 알약**(필수·단일). 생김새 자체가 달라 혼동 방지.
3. **마이크로카피 일관성(중요).** 새 변형 문구 금지 — 기존 문자열 그대로 재사용: **"왜 저장했나요?"**(← "왜 남겼나?"로 바꾸지 않는다), "한 가지 태그를 고르세요", "저장", 세션 목적은 "왜 이 책을 읽나요?". 액션은 끝까지 같은 이름.
4. **상세 화면 hero = 사진 그 자체.** 헤드라인이 아니라 캡처한 페이지 사진이 화면을 연다(16px 라운드, 풀폭). 하단 고정 풀폭 파랑 "저장"(~56px) = CTA 규칙. 메모/페이지/시각은 그 아래 조용한 스택.
5. **절제.** 새 색·폰트·장식 모션 없음. 상세 화면의 색은 사진+태그뿐. 빈 저장 시 사과 대신 안내: "사진이나 메모 중 하나는 있어야 해요."
6. **품질 바닥선.** 모바일 반응형·키보드 포커스 가시·reduced-motion·탭타깃 ≥48px (기존 기준 그대로).

> 위 3을 반영해 본 spec 내 "왜 남겼나?" 표현은 모두 기존 **"왜 저장했나요?"** 로 읽는다.

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
4. **가로 모드**: 기기를 가로로 돌렸을 때 — 카메라 화면 컨트롤(태그·셔터·왜-시트) 도달·동작, 와이드 책 사진이 잘리지 않고 캡처·표시됨, 상세/썸네일이 가로 비율로 깔끔, 나머지 화면이 가로에서 깨지지 않음. (실기기 회전 권장 — 데스크톱은 창 비율로 근사)

## 미해결/주의

- 태그 5개를 라벨까지 한 줄에 넣을 때 캡처 화면 가로폭 — 작은 폰트 또는 2열 등 CSS 조정 필요(구현 중 실측).
- 상세 저장은 명시 버튼(자동저장 아님) — 사용자 합의.
- 가로 카메라 컨트롤 배치(우측 vs 하단)는 실기기에서 thumb 도달성 보고 확정. 매니페스트 세로 고정 해제는 기존 설계 결정(다크 풀스크린 카메라 전제)을 바꾸므로 구현 시 ADR로 기록 권장.
