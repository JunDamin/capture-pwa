# 책/세션 삭제 + 책 단위 Export 직행 + Export 버튼 높이 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 잘못 만든 책/세션을 확인창 후 삭제(연쇄)하고, Review에서 책 전체를 한 번에 AI로 전달하며, Export 버튼 높이를 정상화한다.

**Architecture:** 삭제는 `db.ts`에 연쇄 헬퍼(`deleteSession`/`deleteBook`) 추가 + Review(세션)·책목록에 confirm 후 호출하는 UI. 책 Export는 이미 동작하는 `export(scope:"book")` 라우트로 직행 버튼만. 버튼 높이는 `.btn-primary`의 flex-shrink 견고화.

**Tech Stack:** Vanilla TS + Vite + idb. 인메모리 라우터(`app.ts`), native `confirm()`.

## Global Constraints
- **삭제는 native `confirm()` 후에만 실행.** 문구에 삭제될 캡처 수를 명시. 되돌릴 수 없음.
- 파괴적 액션은 절제(작게, 흐름 끝/행 보조). 탭타깃 ≥48px(핵심)/≥44px(보조). 토스-클린, 무채+파랑 하나.
- 마이크로카피 일관: "삭제", "이 책 전체 AI 전달". 새 변형 문구 금지.
- `db.delete()`는 호출마다 자동 트랜잭션 → 루프 내 await 안전. 기존 `sessionsForBook`(db.ts:125)·`capturesForSession`(db.ts:102)·`byBook` 인덱스(db.ts:57) 재사용 — 스키마 변경 없음.
- 테스트 프레임워크 없음: 각 태스크 = `npm run build`(tsc strict) 통과 + 커밋. UI는 preview/실기기.

## File Structure
- `src/db/db.ts` — `deleteSession(id)`, `deleteBook(id)` 추가(T1).
- `src/screens/review.ts` — 세션 삭제 링크 + "이 책 전체 AI 전달" 버튼(T2).
- `src/screens/books.ts` — 책 목록 행에 삭제 버튼(T3).
- `src/styles/app.css` — 버튼 높이(C) + 삭제/위험 액션 스타일(T2·T3·T4).

---

### Task 1: 연쇄 삭제 헬퍼 (`src/db/db.ts`)

**Files:**
- Modify: `src/db/db.ts`

**Interfaces:**
- Consumes: 기존 `db()`, `capturesForSession(sessionId)`, `sessionsForBook(bookId)`.
- Produces: `deleteSession(sessionId: string): Promise<void>`, `deleteBook(bookId: string): Promise<void>`.

- [ ] **Step 1: 헬퍼 추가**

`deleteCapture`(db.ts:109) 근처에 추가. 구현자는 `capturesForSession`/`sessionsForBook`의 실제 시그니처와 store 이름("captures"/"sessions"/"books")을 먼저 확인:
```typescript
/** 세션 삭제 — 그 세션의 캡처 전부 삭제 후 세션 레코드 삭제. */
export async function deleteSession(sessionId: string): Promise<void> {
  const caps = await capturesForSession(sessionId);
  const d = await db();
  for (const c of caps) await d.delete("captures", c.uuid);
  await d.delete("sessions", sessionId);
}

/** 책 삭제 — 그 책의 모든 세션(+캡처) 삭제 후 책 레코드 삭제. */
export async function deleteBook(bookId: string): Promise<void> {
  const sessions = await sessionsForBook(bookId);
  for (const s of sessions) await deleteSession(s.uuid);
  await (await db()).delete("books", bookId);
}
```

- [ ] **Step 2: 빌드**

Run: `npm run build`
Expected: 타입에러 없음(`d.delete`/store 이름이 idb 스키마와 일치).

- [ ] **Step 3: Commit**

```bash
git add src/db/db.ts
git commit -m "feat: deleteSession/deleteBook 연쇄 삭제 헬퍼"
```

---

### Task 2: Review — 세션 삭제 + 책 전체 AI 전달 (`src/screens/review.ts`, `src/styles/app.css`)

**Files:**
- Modify: `src/screens/review.ts`, `src/styles/app.css`

**Interfaces:**
- Consumes: `deleteSession`(T1), 기존 `nav`, `scope`, `session`(review.ts:21), `bookId`(review.ts:28), `caps`(캡처 배열).

구현자는 현재 `review.ts`(데이터 로드에서 `session`/`bookId`/`caps` 보관, `render()`, `.hero`의 `.scopebtn.toBook`, Export 버튼 `.btn-primary.export`, cleanup의 objectURL revoke, 이벤트 배선)를 **먼저 읽고** 적용한다.

- [ ] **Step 1: import 추가**

`deleteSession`을 `../db/db.ts` import에 추가.

- [ ] **Step 2: "이 책 전체 AI 전달" 버튼 (session scope만)**

`scope === "session"`일 때 `.hero`의 `.scopebtn.toBook`(이 책 전체 보기) 바로 뒤에 버튼 추가(세로 스택 기본):
```html
<button class="scopebtn toBookExport">📤 이 책 전체 AI 전달</button>
```
배선(`render()` 이벤트 영역, `scope === "session"` 가드):
```typescript
const beEl = root.querySelector(".toBookExport") as HTMLButtonElement | null;
if (beEl) beEl.onclick = () => nav({ name: "export", scope: "book", id: bookId });
```

- [ ] **Step 3: "이 세션 삭제" 위험 링크 (session scope, 빈 세션 포함)**

`scope === "session"`일 때, **`caps.length > 0` 가드 밖**(화면 최하단)에 항상 렌더:
```html
<button class="danger-link sessiondel">이 세션 삭제</button>
```
배선:
```typescript
const sdEl = root.querySelector(".sessiondel") as HTMLButtonElement | null;
if (sdEl) sdEl.onclick = async () => {
  const n = caps.length;
  if (!confirm(`이 세션의 캡처 ${n}개가 모두 지워집니다. 삭제할까요?`)) return;
  await deleteSession(id);
  nav({ name: "home" });
};
```
(`id`는 `mountReview`의 세션 id 파라미터 = 세션 uuid. `caps`는 로드 시 보관된 배열.)

- [ ] **Step 4: CSS — danger-link + scopebtn 간격**

`src/styles/app.css`에 추가:
```css
.danger-link {
  display: block;
  width: 100%;
  margin: 24px auto 8px;
  padding: 12px;
  min-height: 48px;
  background: none;
  border: none;
  color: var(--sub);
  font-size: 14px;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.toBookExport { margin-top: 8px; }
```

- [ ] **Step 5: 빌드 + 확인**

Run: `npm run build` → 에러 없음. (preview: 세션 Review에 두 버튼 + 하단 삭제 링크; 삭제는 confirm 후 홈으로; 빈 세션에서도 삭제 링크 노출.)

- [ ] **Step 6: Commit**

```bash
git add src/screens/review.ts src/styles/app.css
git commit -m "feat: Review에 세션 삭제(confirm) + 이 책 전체 AI 전달 버튼"
```

---

### Task 3: 책 목록 — 책 삭제 (`src/screens/books.ts`, `src/styles/app.css`)

**Files:**
- Modify: `src/screens/books.ts`, `src/styles/app.css`

**Interfaces:**
- Consumes: `deleteBook`(T1), 기존 `listBooks()`/`renderList()`, `bookRow` 템플릿, 행 탭 선택 배선, `.bookrow__edit`(data-edit) 패턴.

구현자는 현재 `books.ts`(`renderList`, `bookRow`, 행 탭/edit 배선, `stopPropagation` 패턴)를 **먼저 읽고** 적용한다.

- [ ] **Step 1: import + 삭제 버튼 마크업**

`deleteBook`을 `../db/db.ts` import에 추가. `bookRow`의 `.bookrow__edit` 옆에 삭제 버튼 추가:
```html
<button class="bookrow__del" data-del="${book.uuid}" aria-label="책 삭제">🗑</button>
```

- [ ] **Step 2: 배선 (stopPropagation으로 행 탭과 분리)**

`renderList()` 이벤트 영역(edit 배선과 동일 패턴):
```typescript
root.querySelectorAll<HTMLElement>(".bookrow__del").forEach((el) => {
  el.onclick = async (ev) => {
    ev.stopPropagation();
    const id = el.dataset.del!;
    const b = books.find((x) => x.uuid === id);
    const caps = await capturesForBook(id);
    if (!confirm(`'${b?.title ?? "이 책"}'과 이 책의 모든 세션·캡처 ${caps.length}개가 지워집니다. 삭제할까요?`)) return;
    await deleteBook(id);
    books = await listBooks();
    renderList();
  };
});
```
(현 코드의 책 배열 변수명/`listBooks`/`renderList` 실제 이름에 맞춤. `capturesForBook`은 db.ts에 이미 존재 — import 추가.)

- [ ] **Step 3: CSS — 삭제 버튼 탭타깃**

`src/styles/app.css`에 추가:
```css
.bookrow__del {
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  opacity: 0.7;
}
```

- [ ] **Step 4: 빌드 + 확인**

Run: `npm run build` → 에러 없음. (preview: 책 목록 각 행에 🗑; 클릭 → confirm → 삭제 후 목록 갱신; 행 탭은 여전히 책 선택.)

- [ ] **Step 5: Commit**

```bash
git add src/screens/books.ts src/styles/app.css
git commit -m "feat: 책 목록에서 책 삭제(confirm·연쇄)"
```

---

### Task 4: Export 버튼 높이 정상화 (C) (`src/styles/app.css`)

**Files:**
- Modify: `src/styles/app.css`

- [ ] **Step 1: `.btn-primary` flex-shrink 견고화**

`app.css`의 `.btn-primary`(약 257행) `height: 56px;` → `min-height: 56px;`로 변경(flex 컬럼에서 iOS Safari가 압축하지 못하게). 다른 속성 유지.

- [ ] **Step 2: `.topdf` 간격**

`app.css`에 추가:
```css
.topdf { margin-top: 4px; }
```

- [ ] **Step 3: 빌드 + 확인**

Run: `npm run build` → 에러 없음. (preview/실기기: Export 화면 "📄 PDF로 내보내기" 버튼이 다른 CTA와 동일 높이.)

- [ ] **Step 4: Commit**

```bash
git add src/styles/app.css
git commit -m "fix: Export 버튼 높이 정상화 (.btn-primary min-height, iOS flex-shrink 방지)"
```

---

## Self-Review
**1. Spec coverage:** A 삭제 → T1(db)+T2(세션UI)+T3(책UI); B 책Export 직행 → T2; C 버튼높이 → T4. 검토 조정 5건 반영(인덱스 기존/빈세션 삭제 노출/세로스택/min-height/44px) ✓.
**2. Placeholder scan:** T1은 구체 코드. T2/T3은 "현 파일 먼저 읽기" + 구체 코드·배선(변수명만 현 코드에 맞춤 — 의도적). CSS 전부 구체값. ✓
**3. Type consistency:** `deleteSession(id)`/`deleteBook(id)`→`Promise<void>`(T1) ↔ T2/T3 호출 일치. `export` route `{scope:"book", id}`(기존) 사용. `capturesForBook`/`sessionsForBook`/`capturesForSession` 기존 시그니처. ✓

## 참고
- 삭제 confirm은 native(범위 밖, 기존 결정). iOS standalone PWA에서 동작 확인됨(검토).
- D(인카메라 크롭)는 이 배치 머지 후 별도 spec/plan.
