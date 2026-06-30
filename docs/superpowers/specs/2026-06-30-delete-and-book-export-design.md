# 삭제(책/세션) + 책 단위 Export 직행 + Export 버튼 높이 (spec)

날짜: 2026-06-30
관련: ADR-005(세션 생명주기), ADR-008(Export), design-language.md
범위: A(삭제) + B(책 단위 AI 전달 직행 버튼) + C(Export 버튼 높이). **인카메라 크롭(D)은 별도 spec.**

## Context

- **A 삭제:** 현재 `deleteCapture`만 있고 **책/세션 삭제가 없다.** 잘못 만든 책·세션을 못 지운다.
- **B 책 Export:** 책 전체 합본 Export는 **이미 동작**(`capturesForBook`, export `scope:"book"`)하나, Review의 "이 책 전체 보기"를 거쳐야만 닿아 발견이 어렵다 → **직행 버튼** 추가.
- **C 버튼 높이:** Export 화면의 `.topdf`("📄 PDF로 내보내기 (AI에게 넘기기)") 버튼 높이가 비정상적으로 작다 → 표준 CTA 높이로.

## 결정 (확인 반영)

- **세션 삭제 = Review(세션 스코프) 화면**, **책 삭제 = 책 목록(books)**, 둘 다 **native `confirm()`** 로 "캡처 N개가 함께 삭제" 경고 후 실행. 연쇄 삭제.
- **B:** Review(세션 스코프)에 **"📤 이 책 전체 AI 전달"** 버튼 → `export(book, bookId)` 직행.
- **C:** `.topdf` 버튼이 표준 하단 CTA 높이를 갖도록 CSS 수정.

## 컴포넌트/변경

### 1. `src/db/db.ts` — 연쇄 삭제 헬퍼

```ts
// 세션 삭제: 그 세션의 캡처 전부 삭제 후 세션 삭제.
export async function deleteSession(sessionId: string): Promise<void> {
  const caps = await capturesForSession(sessionId);
  const d = await db();
  for (const c of caps) await d.delete("captures", c.uuid);
  await d.delete("sessions", sessionId);
}
// 책 삭제: 그 책의 모든 세션(+캡처) 삭제 후 책 삭제.
export async function deleteBook(bookId: string): Promise<void> {
  const ss = await sessionsForBook(bookId); // 없으면 sessions 인덱스로 조회 추가
  for (const s of ss) await deleteSession(s.uuid);
  await (await db()).delete("books", bookId);
}
```
- **확인됨(검토):** `sessionsForBook`(db.ts:125, `getAllFromIndex("sessions","byBook",bookId)`)·`capturesForBook`(db.ts:129)·`byBook` 인덱스(db.ts:57)가 **이미 존재** → 스키마/버전 변경 불필요. `deleteSession`/`deleteBook`만 새로 추가.
- idb `db.delete()`는 호출마다 자동 트랜잭션 → 루프 내 await 안전(과거 TransactionInactiveError 위험 없음). 캡처는 ArrayBuffer 레코드라 레코드 삭제로 정리됨.

### 2. `src/screens/review.ts` — 세션 삭제 + 책 전체 전달 버튼 (session scope)

- **세션 삭제:** 화면 하단에 절제된 위험 액션 "이 세션 삭제"(`.danger-link` 텍스트 버튼, 빨강 아님—무채+위험은 confirm으로). 클릭 → `confirm("이 세션의 캡처 N개가 모두 지워집니다. 삭제할까요?")` → `deleteSession(id)` → `nav({name:"home"})`.
  - **조정(검토):** 이 링크는 **`caps.length === 0`(빈 세션)일 때도 보여야** 함 — 현재 Export 버튼은 `caps.length > 0` 가드 안에 있으니, 삭제 링크는 그 가드 **밖**에 렌더(빈/잘못 만든 세션도 삭제 가능).
- **책 전체 전달(B):** 기존 "이 책 전체 보기"(→ review(book), `.scopebtn.toBook`) 근처에 **"📤 이 책 전체 AI 전달"** → `nav({name:"export", scope:"book", id:bookId})`. (route는 이미 `scope:"book"` 지원 — app.ts/export.ts 변경 불필요.)
  - **조정(검토):** `.hero`는 블록 흐름(flex 아님) → 두 `.scopebtn`은 세로 스택이 기본(안전). 가로 배치를 원하면 `display:flex; gap:8px` 래퍼로 — 구현자 판단(스택 기본).
- book scope Review에는 세션 삭제 없음(거긴 책 단위).

### 3. `src/screens/books.ts` — 책 삭제 (목록)

- 책 목록 각 행에 이미 편집(`.bookrow__edit`, `data-edit`)이 있음 → 그 옆에 **삭제(🗑 또는 "삭제")** 추가(`data-del=bookId`). 행 탭(책 선택)과 `stopPropagation`으로 분리(기존 edit 버튼과 동일 패턴).
  - **조정(검토):** `.bookrow__edit`에 명시적 크기 CSS가 없음 → 새 삭제 버튼은 **`min-width:44px; min-height:44px`를 명시**(인접 패턴이 알아서 해주리라 가정 금지).
- 클릭 → `confirm("'제목'과 이 책의 모든 세션·캡처가 지워집니다. 삭제할까요?")` → `deleteBook(id)` → 목록 재렌더.

### 4. `src/styles/app.css` — C: Export 버튼 높이 + 삭제 액션 스타일

- **C 진짜 원인(검토):** `.topdf`는 `.btn-primary { height: 56px }`(app.css:257)를 받는데, flex 컬럼(`.scr`) 안에서 **iOS Safari flex-shrink로 압축**될 수 있음. `.topdf` 전용/`.review .export` 규칙은 **원인 아님**. → **`.btn-primary`의 `height: 56px` → `min-height: 56px`로**(전 CTA 견고화) + `.topdf { margin-top: 4px }`(시각 간격, `.review .export`의 margin-top:6px와 정합). margin만 추가하지 말 것 — min-height가 핵심.
- `.danger-link`(세션 삭제), 책 목록 `.book-del` 버튼 스타일(절제, ≥44px). 토스-클린 유지.

## 디자인 언어 / 제약
- 삭제는 **되돌릴 수 없음** → 반드시 confirm, 캡처 수를 문구에 명시. 파괴적 버튼은 절제(작게, 본문 흐름 끝/행 보조). 탭타깃 ≥48px(핵심)/≥44px(보조).
- 마이크로카피 일관: "삭제", "이 책 전체 AI 전달". 새 변형 문구 만들지 않기.

## 영향 파일
`src/db/db.ts`(deleteSession/deleteBook/+sessionsForBook), `src/screens/review.ts`(세션삭제+책전달버튼), `src/screens/books.ts`(책삭제), `src/styles/app.css`(버튼 높이+삭제 스타일).

## 검증
테스트 프레임워크 없음 → `npm run build` + preview.
1. `npm run build` 무에러.
2. preview:
   - Review(세션)에서 "이 세션 삭제" → confirm → 홈으로, 세션·캡처 사라짐.
   - 책 목록에서 책 삭제 → confirm → 목록에서 사라지고 그 책 세션·캡처 모두 삭제.
   - Review(세션)의 "📤 이 책 전체 AI 전달" → Export(이 책 전체)로 직행, 모든 세션 캡처 합본.
   - Export의 PDF 버튼 높이가 다른 CTA와 동일하게 정상.
3. 삭제 후 홈/목록/카운트 정합(끊긴 참조 없음).

## 미해결/주의
- 삭제 confirm은 native(디자인 범위 밖, 기존 결정). 추후 커스텀 모달은 별도.
- B 버튼을 홈에도 둘지는 preview 후 판단(우선 Review에만 — 군더더기 최소).
