# 카드에서 모드 선택 캡처 진입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 책/세션 카드와 빈 Review에서 📷/✍️ 모드를 골라 바로 캡처하게 해 "빈 Review 막다른 곳"을 없앤다.

**Architecture:** 세션 시작 시퀀스를 `db.ts`의 `startNewSession`으로 추출(중복 제거)하고, home 카드와 review 빈 상태에 모드 버튼을 추가. 본문 탭 동작은 유지(열림=캡처/닫힘=Review).

**Tech Stack:** Vanilla TS + Vite + idb.

## Testing approach
테스트 프레임워크 없음. 각 태스크 = `npm run build`(tsc) + 커밋. UI는 preview/iOS 실기기.

## Global Constraints
- 본문 탭 동작 불변(열림→capture, 닫힘→review). 버튼은 `ev.stopPropagation()`로 분리.
- 닫힌 카드 버튼/빈Review 버튼 = `startNewSession(bookId)` 후 capture(mode). 열린 건 그 세션 이어가기.
- 탭타깃 ≥48px, 토스-클린, 문구 "사진"/"입력".
- `startNewSession`은 mode를 받지 않음(라우팅 관심사). ADR-005 정합.

---

### Task 1: `startNewSession` 헬퍼 + books.ts 리팩터

**Files:** Modify `src/db/db.ts`, `src/screens/books.ts`
**Interfaces:** Produces `startNewSession(bookId: string, project?: string): Promise<string>` (새 세션 uuid 반환).

- [ ] **Step 1: db.ts에 헬퍼 추가**

`endAllOpenSessions` 근처에 추가(`Session`/`uuid`/`putSession`/`endAllOpenSessions`는 이미 db.ts에 있음):
```typescript
/** 새 세션 시작 — 기존 열린 세션 종료 후 생성(ADR-005). 새 세션 uuid 반환. */
export async function startNewSession(bookId: string, project?: string): Promise<string> {
  const now = Date.now();
  await endAllOpenSessions(now);
  const session: Session = { uuid: uuid(), bookId, project, started: now, ended: null };
  await putSession(session);
  return session.uuid;
}
```

- [ ] **Step 2: books.ts 리팩터(동작 불변)**

`books.ts`의 세션 시작 핸들러(현재 `endAllOpenSessions(now)` + 세션 객체 생성 + `putSession` + `nav capture`)에서 시작 시퀀스를 `startNewSession`으로 교체:
```typescript
const sid = await startNewSession(chosen!.uuid, projectValue || undefined);
nav({ name: "capture", sessionId: sid, mode: selectedMode });
```
(현재 import에 `endAllOpenSessions`/`uuid`/`putSession`이 더는 직접 안 쓰이면 import 정리; `startNewSession` import 추가. `projectValue`는 현 코드의 프로젝트 입력값 변수명에 맞춰.)

- [ ] **Step 3: 빌드** — `npm run build` 무에러.
- [ ] **Step 4: Commit** — `git add src/db/db.ts src/screens/books.ts && git commit -m "refactor: startNewSession 헬퍼 추출 + books 사용(동작 불변)"`

---

### Task 2: home.ts 카드 모드 버튼 + data-book

**Files:** Modify `src/screens/home.ts`, `src/styles/app.css`
**Interfaces:** Consumes `startNewSession`(Task1).

구현자는 현재 `home.ts`(topCard/recentItem 템플릿, `handleSessionTap`, 이벤트 배선)를 읽고 적용.

- [ ] **Step 1: import + data-book**

`import { startNewSession } from "../db/db.ts"`(또는 기존 db import에 추가). `topCard`와 `recentItem` 루트 엘리먼트에 `data-book="${v.session.bookId}"` 추가.

- [ ] **Step 2: 버튼 스트립 마크업**

topCard·recentItem 각 카드의 **본문 아래**에 버튼 스트립 추가:
```html
<div class="card-modes">
  <button class="cm-btn cm-photo" data-mode="photo" aria-label="사진으로 캡처">📷 사진</button>
  <button class="cm-btn cm-input" data-mode="input" aria-label="입력으로 캡처">✍️ 입력</button>
</div>
```
(카드가 `data-id`(sessionId), `data-open`, `data-book`을 가지도록.)

- [ ] **Step 3: 핸들러**

`render()` 이벤트 배선에 추가(본문 `handleSessionTap`은 유지):
```typescript
root.querySelectorAll<HTMLElement>(".card-modes .cm-btn").forEach((btn) => {
  btn.onclick = async (ev) => {
    ev.stopPropagation(); // 본문 탭과 분리
    const card = btn.closest("[data-id]") as HTMLElement;
    const sessionId = card.dataset.id!;
    const bookId = card.dataset.book!;
    const isOpen = card.dataset.open === "1";
    const mode = btn.dataset.mode as "photo" | "input";
    const id = isOpen ? sessionId : await startNewSession(bookId);
    nav({ name: "capture", sessionId: id, mode });
  };
});
```

- [ ] **Step 4: CSS** — `src/styles/app.css`에 `.card-modes`(가로 2버튼, gap, 카드 본문 아래), `.cm-btn`(min-height 48px, 토스-클린 보조 톤, 둥근). recentItem이 깨지지 않게 아이템에 세로 레이아웃 보정.

- [ ] **Step 5: 빌드 + 확인** — `npm run build` 무에러. preview: 카드 본문 탭 동작 유지, 📷/✍️ 버튼이 해당 모드 캡처로(닫힌 카드는 새 세션). 버튼이 본문 탭을 안 부름.

- [ ] **Step 6: Commit** — `git add src/screens/home.ts src/styles/app.css && git commit -m "feat: 홈 카드에 📷/✍️ 모드 캡처 버튼 + data-book"`

---

### Task 3: review.ts 빈 상태 시작 버튼

**Files:** Modify `src/screens/review.ts`, `src/styles/app.css`
**Interfaces:** Consumes `startNewSession`(Task1). review는 로드 시 `session`(및 bookId) 보관(이미 세션 편집용으로 session 보관 중).

- [ ] **Step 1: 빈 상태 버튼**

`emptyState()`(캡처 0개)에 버튼 추가:
```html
<div class="card-modes">
  <button class="cm-btn cm-photo" data-mode="photo">📷 사진</button>
  <button class="cm-btn cm-input" data-mode="input">✍️ 입력</button>
</div>
```
(scope === "session"일 때만; book-scope 빈 상태는 기존 문구 유지.)

- [ ] **Step 2: 핸들러**

빈 상태가 렌더된 뒤 배선(session 보관 변수 사용):
```typescript
root.querySelectorAll<HTMLElement>(".card-modes .cm-btn").forEach((btn) => {
  btn.onclick = async () => {
    if (!session) return;
    const mode = btn.dataset.mode as "photo" | "input";
    const id = session.ended == null ? session.uuid : await startNewSession(session.bookId);
    nav({ name: "capture", sessionId: id, mode });
  };
});
```

- [ ] **Step 3: 빌드 + 확인** — `npm run build` 무에러. preview: 캡처 0개 세션 Review의 📷/✍️ 버튼이 캡처로 진입.

- [ ] **Step 4: Commit** — `git add src/screens/review.ts src/styles/app.css && git commit -m "feat: 빈 Review에 📷/✍️ 캡처 시작 버튼"`

---

## Self-Review
**1. Spec coverage:** startNewSession+books → T1; 카드 버튼+data-book → T2; 빈 Review 버튼 → T3; CSS는 T2/T3. 본문탭 불변(설계대로 코드 미변경) ✓.
**2. Placeholder scan:** T2/T3은 현 파일 기준 구현 요구 + 구체 코드. 변수명(projectValue, session)은 구현자가 현 코드에 맞춤. ✓
**3. Type consistency:** `startNewSession(bookId, project?)→Promise<string>`(T1) ↔ books/home/review 호출 일치; capture route `mode?`(기존) 사용; `SessionView.session.bookId` 존재 확인됨(검토).

## 참고
- `.card-modes`/`.cm-btn`은 T2에서 정의, T3에서 재사용.
- iOS 멀티터치 무관(일반 탭) — preview/데스크톱으로 검증 가능, 실기기는 마무리 확인.
