# 책 중심 전환 — 세션=회독 잠복 + 책장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** UI를 책 중심으로 전환하고 세션을 "회독"(번호 계산 + 사후 편집 가능한 제목)으로 재정의한다. 자동 종료를 없애 캡처가 항상 그 책의 현재 회독에 이어지게 한다.

**Architecture:** 스키마 불변(마이그레이션 없음). db.ts에 `currentRoundFor`(get-or-create, 아무것도 닫지 않음)·`recentBooks/BookView`·`capturesWithRoundsForBook`를 신설하고 `startNewSession`을 그 책만 닫는 "새 회독 시작" 전용으로 격리. 홈=책 목록(최대 재작업), books=책장, review=회독 배지·구분·새 회독. 문구 전면 "세션"→"회독".

**Tech Stack:** Vanilla TS + Vite + idb. 기존 인메모리 라우터.

## Global Constraints
- **`currentRoundFor(bookId)` = 모든 📷/✍️ 진입·공유 수신의 유일한 세션 획득 경로**(get-or-create, 종료 없음). `startNewSession` = "새 회독 시작" 버튼 전용(그 책의 열린 회독만 닫음 — `endOpenRoundsForBook`).
- 8시간 자동 종료 삭제(main.ts `endStaleSessions` 호출·import 제거). 전역 `endAllOpenSessions`는 미사용화.
- 회독 번호 = 그 책 세션들의 `started` **오름차순 JS sort** 후 1-based 인덱스(IDB 반환 순서 신뢰 금지).
- `session.project` = 회독 제목(선택·사후 편집 — 기존 ✎ 재사용). 스키마·백업·PDF 파이프라인 불변.
- 문구 "세션"→"회독" 전면(홈/books/review/export/transfer/confirm/빈 상태). 마이크로카피 plain·일관, 탭타깃 ≥44px, 토스-클린.
- 캡처 3초 루프 무영향. 테스트 프레임워크 없음: 각 태스크 = `npm run build` + 커밋(T5는 `npm run test:pdf`도).

## File Structure
- T1 `src/db/db.ts` — 회독 헬퍼·BookView (기반)
- T2 `src/main.ts` — 자동 종료 제거 + 공유 수신 재라우팅
- T3 `src/screens/home.ts`(+`app.css`) — 홈=책 목록 재작업(최대)
- T4 `src/screens/review.ts`(+`app.css`) — 회독 배지·✎·새 회독·구분·문구
- T5 `src/screens/books.ts`·`export.ts`·`transfer.ts`·`capture.ts`·`prompt.ts` 문구/책장 + `docs/decisions.md`(ADR-016)·`docs/glossary.md`

---

### Task 1: db.ts 회독 기반 헬퍼

**Files:**
- Modify: `src/db/db.ts`

**Interfaces (Produces — 이후 태스크가 그대로 사용):**
- `currentRoundFor(bookId: string): Promise<string>` — 열린 회독 uuid(get-or-create, 종료 없음)
- `startNewSession(bookId: string, project?: string): Promise<string>` — 기존 시그니처 유지, 내부만 그 책 한정 종료로
- `interface BookView { book: Book; currentRound: Session | null; roundNumber: number; totalRounds: number; captureCount: number; lastActivity: number }`
- `recentBooks(n: number): Promise<BookView[]>` — 최근 활동순
- `roundNumberOf(sessions: Session[], sessionId: string): number` — started asc 정렬 1-based(내보내기: T4가 씀)
- `capturesWithRoundsForBook(bookId: string): Promise<{ roundNumber: number; session: Session; captures: Capture[] }[]>`

- [ ] **Step 1: 현재 코드 확인** — `sessionsForBook`, `capturesForSession`, `startNewSession`(현재 `endAllOpenSessions` 호출), `SessionView`/`toView`, `listBooks`, `getBook`의 실제 시그니처.

- [ ] **Step 2: 헬퍼 구현**

```typescript
/** 그 책의 열린 회독만 종료(다른 책 무관). */
async function endOpenRoundsForBook(bookId: string, now: number): Promise<void> {
  const ss = await sessionsForBook(bookId);
  const d = await db();
  for (const s of ss) if (s.ended == null) await d.put("sessions", { ...s, ended: now });
}

/** 현재 회독 get-or-create — 아무것도 닫지 않음. 모든 캡처 진입/공유 수신 전용. */
export async function currentRoundFor(bookId: string): Promise<string> {
  const ss = await sessionsForBook(bookId);
  const open = ss.filter((s) => s.ended == null).sort((a, b) => b.started - a.started);
  if (open.length) return open[0].uuid; // 레거시 다중 열림: 최근 것
  const session: Session = { uuid: uuid(), bookId, started: Date.now(), ended: null };
  await putSession(session);
  return session.uuid;
}

/** 회독 번호: started asc 정렬(JS sort 필수) 1-based. */
export function roundNumberOf(sessions: Session[], sessionId: string): number {
  const sorted = [...sessions].sort((a, b) => a.started - b.started);
  return sorted.findIndex((s) => s.uuid === sessionId) + 1;
}
```
`startNewSession`: 내부 `await endAllOpenSessions(now)` → `await endOpenRoundsForBook(bookId, now)` 교체(시그니처·반환 불변). `endAllOpenSessions`는 미사용이 되면 export 제거(다른 사용처 grep 후).

- [ ] **Step 3: BookView + recentBooks + capturesWithRoundsForBook**

```typescript
export interface BookView {
  book: Book;
  currentRound: Session | null;
  roundNumber: number;   // currentRound의 순번, 없으면 totalRounds
  totalRounds: number;
  captureCount: number;
  lastActivity: number;  // 캡처/세션 중 최신
}

export async function recentBooks(n: number): Promise<BookView[]> {
  const books = await listBooks();
  const views: BookView[] = [];
  for (const book of books) {
    const ss = await sessionsForBook(book.uuid);
    if (!ss.length) {
      views.push({ book, currentRound: null, roundNumber: 0, totalRounds: 0, captureCount: 0, lastActivity: 0 });
      continue;
    }
    const open = ss.filter((s) => s.ended == null).sort((a, b) => b.started - a.started);
    const currentRound = open[0] ?? null;
    let captureCount = 0;
    let lastActivity = Math.max(...ss.map((s) => s.started));
    for (const s of ss) {
      const caps = await capturesForSession(s.uuid);
      captureCount += caps.length;
      for (const c of caps) if (c.createdAt > lastActivity) lastActivity = c.createdAt;
    }
    views.push({
      book,
      currentRound,
      roundNumber: currentRound ? roundNumberOf(ss, currentRound.uuid) : ss.length,
      totalRounds: ss.length,
      captureCount,
      lastActivity,
    });
  }
  return views.sort((a, b) => b.lastActivity - a.lastActivity).slice(0, n);
}

export async function capturesWithRoundsForBook(
  bookId: string,
): Promise<{ roundNumber: number; session: Session; captures: Capture[] }[]> {
  const ss = [...(await sessionsForBook(bookId))].sort((a, b) => a.started - b.started);
  const out: { roundNumber: number; session: Session; captures: Capture[] }[] = [];
  for (let i = 0; i < ss.length; i++) {
    const captures = await capturesForSession(ss[i].uuid);
    if (captures.length) out.push({ roundNumber: i + 1, session: ss[i], captures });
  }
  return out;
}
```
(캡처 없는 책도 목록에 남김 — 책장에서 등록만 한 책 표시. `lastActivity: 0`이면 맨 뒤.)

- [ ] **Step 4: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/db/db.ts
git commit -m "feat: 회독 기반 db 헬퍼 — currentRoundFor·recentBooks·회독번호·구분 (ADR-016)"
```

---

### Task 2: main.ts — 자동 종료 제거 + 공유 수신 재라우팅

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `recentBooks(1)`, `currentRoundFor(bookId)` (T1).

- [ ] **Step 1: endStaleSessions 제거** — `boot()`의 `await endStaleSessions(Date.now())` 줄과 import 제거. (db.ts의 함수 자체는 미사용 dead — 제거 가능하면 제거.)

- [ ] **Step 2: 공유 수신 라우팅 교체** — 기존 `openSession()` 분기(열린 세션→capture / 없으면 books)를:

```typescript
const recent = await recentBooks(1);
if (recent.length) {
  const sid = await currentRoundFor(recent[0].book.uuid);
  nav({ name: "capture", sessionId: sid, mode: "input" });
} else {
  nav({ name: "books" });
}
```
(imports: `openSession` 제거하고 `recentBooks, currentRoundFor`로. 공유 아닌 일반 부팅은 기존대로 `nav home`.)

- [ ] **Step 3: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/main.ts src/db/db.ts
git commit -m "feat: 자동 종료 제거 + 공유 수신을 최근 책 현재 회독으로"
```

---

### Task 3: 홈 = 책 목록 재작업 (최대 태스크)

**Files:**
- Modify: `src/screens/home.ts`, `src/styles/app.css`

**Interfaces:**
- Consumes: `recentBooks(n): Promise<BookView[]>`, `currentRoundFor(bookId)` (T1).

구현자는 **현재 home.ts를 먼저 읽고**(topCard/recentItem/emptyCard 템플릿, handleSessionTap, card-modes 배선, 설치 버튼·버전 스탬프) 아래로 재작업한다.

- [ ] **Step 1: 데이터 로드 교체** — `Promise.all([openSession(), recentSessions(8)])` → `const books = await recentBooks(8);`. import 정리(`openSession`/`recentSessions`/`startNewSession`/`SessionView` → `recentBooks`/`currentRoundFor`/`BookView`).

- [ ] **Step 2: 렌더 재구성** — open/recent 이분 구조 소멸. 첫 책 = 큰 카드(bookcard), 나머지 = 컴팩트 행(item) — 기존 CSS 재사용:

```typescript
function render(books: BookView[]) {
  const top = books[0] ? topCard(books[0]) : emptyCard();
  const rest = books.slice(1);
  root.innerHTML = `
  <div class="scr scr--light home">
    <h1 class="home__h">내 책</h1>
    ${top}
    <button class="btn-primary home__start">▶ 독서 시작</button>
    ${rest.length ? `<div class="sectit">다른 책</div><div class="recent">${rest.map(bookItem).join("")}</div>` : ""}
    ${isStandalone() ? "" : `<button class="home__install">홈 화면에 등록</button>`}
    <button class="home__transfer">백업·가져오기</button>
    <div class="home__ver">build ${__BUILD__}</div>
  </div>`;
  // ... 배선
}

function roundLabel(v: BookView): string {
  if (!v.totalRounds) return "캡처 전";
  const t = v.currentRound?.project ? ` · ${esc(v.currentRound.project)}` : "";
  return `${v.roundNumber}회독${t}`;
}

function topCard(v: BookView) {
  return `
  <div class="bookcard" data-action data-book="${v.book.uuid}">
    <div class="bookcard__row">
      <div class="cover cov-1">${esc(v.book.title).slice(0, 6)}</div>
      <div class="bookcard__body">
        <div class="booktitle">${esc(v.book.title)}</div>
        <div class="sessionchip"><span class="dot"></span>${roundLabel(v)} · ${v.captureCount} Captures</div>
      </div>
      <div class="chev">›</div>
    </div>
    <div class="card-modes">
      <button class="cm-btn cm-photo" data-mode="photo" aria-label="사진으로 캡처">📷 사진</button>
      <button class="cm-btn cm-input" data-mode="input" aria-label="입력으로 캡처">✍️ 입력</button>
    </div>
  </div>`;
}

function bookItem(v: BookView, i: number) {
  return `
  <div class="item" data-book="${v.book.uuid}">
    <div class="item__row">
      <div class="mini ${coverClass(i)}"></div>
      <div class="item__body">
        <div class="item__t">${esc(v.book.title)}</div>
        <div class="item__s">${roundLabel(v)} · ${v.captureCount} captures</div>
      </div>
      <div class="item__when">${v.lastActivity ? relTime(v.lastActivity) : ""}</div>
    </div>
    <div class="card-modes">
      <button class="cm-btn cm-photo" data-mode="photo" aria-label="사진으로 캡처">📷 사진</button>
      <button class="cm-btn cm-input" data-mode="input" aria-label="입력으로 캡처">✍️ 입력</button>
    </div>
  </div>`;
}
```

- [ ] **Step 3: 배선 교체**

```typescript
// 본문 탭 = 책 Review
root.querySelectorAll<HTMLElement>("[data-book]").forEach((el) => {
  if (!el.classList.contains("bookcard") && !el.classList.contains("item")) return;
  el.onclick = () => nav({ name: "review", scope: "book", id: el.dataset.book! });
});
// 📷/✍️ = 현재 회독에 캡처(get-or-create)
root.querySelectorAll<HTMLElement>(".card-modes .cm-btn").forEach((btn) => {
  btn.onclick = async (ev) => {
    ev.stopPropagation();
    const card = btn.closest("[data-book]") as HTMLElement;
    const sid = await currentRoundFor(card.dataset.book!);
    nav({ name: "capture", sessionId: sid, mode: btn.dataset.mode as "photo" | "input" });
  };
});
```
`handleSessionTap`/`data-id`/`data-open` 잔재 제거. 설치·백업·버전·emptyCard 배선 유지. CSS는 기존 재사용(필요 시 소폭).

- [ ] **Step 4: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/screens/home.ts src/styles/app.css
git commit -m "feat: 홈=최근 책 목록(회독 배지) — 탭=책 Review, 버튼=현재 회독 캡처"
```

---

### Task 4: Review — 회독 배지·✎·새 회독·구분·문구

**Files:**
- Modify: `src/screens/review.ts`, `src/styles/app.css`

**Interfaces:**
- Consumes: `currentRoundFor`, `startNewSession`, `capturesWithRoundsForBook`, `roundNumberOf`, `sessionsForBook` (T1).

구현자는 **현재 review.ts를 먼저 읽고**(scope 분기, session/bookId 보관, ✎ 편집, card-modes, sessiondel, toBook/toBookExport, render) 적용한다.

- [ ] **Step 1: book 스코프 데이터 로드** — `scope === "book"` 분기에서 추가:

```typescript
const ss = await sessionsForBook(id);
currentRound = ss.filter((s) => s.ended == null).sort((a, b) => b.started - a.started)[0] ?? null;
currentRoundNo = currentRound ? roundNumberOf(ss, currentRound.uuid) : ss.length;
```
(`let currentRound: Session | null = null; let currentRoundNo = 0;` 를 mountReview 스코프에. 세션 스코프에선 `currentRound = session`으로 통일해도 됨 — ✎가 하나의 경로로.)

- [ ] **Step 2: 책 스코프 UI** — hero에 회독 배지 + ✎ + 새 회독 + 📷/✍️ 상시:
- 배지: `${currentRoundNo}회독${currentRound?.project ? " · " + esc(currentRound.project) : ""}` (회독 0개면 "캡처 전").
- ✎(기존 편집 재사용): 대상 세션을 `session ?? currentRound`로 — book 스코프에서도 동작(현재 `if (editProj && session)` 가드가 book 스코프에서 조용히 no-op인 것 수정).
- **"새 회독 시작"** 버튼(book 스코프만): `await startNewSession(bookId)` → 데이터 리로드+재렌더(배지 증가). confirm 불필요.
- 📷/✍️ `card-modes`를 book 스코프에도 렌더, 핸들러는 스코프 공통:
```typescript
const sid = await currentRoundFor(bookId);
nav({ name: "capture", sessionId: sid, mode });
```
(세션 스코프의 기존 `session.ended==null ? uuid : startNewSession(...)` 분기도 이걸로 교체 — 검토 C4.)

- [ ] **Step 3: 회독 구분 라벨** — book 스코프 캡처 목록을 `capturesWithRoundsForBook(id)`로 로드해 회독별 그룹 앞에 `<div class="roundsep">— ${roundNumber}회독${session.project ? " · " + esc(session.project) : ""} —</div>` 삽입(전체 flat 목록과 동일한 카드 렌더 재사용). objectURL 관리(urls 배열)는 기존 패턴 유지. CSS `.roundsep { text-align:center; color: var(--sub); font-size: 12px; margin: 14px 0 6px; }`.

- [ ] **Step 4: 문구** — "이번 세션" → "이번 회독"(hero scope 라벨), "이 세션 삭제" → "이 회독 삭제" + confirm "이 회독의 캡처 N개가 모두 지워집니다…", 빈 상태 등 "세션" 잔여 검색·교체.

- [ ] **Step 5: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/screens/review.ts src/styles/app.css
git commit -m "feat: 책 Review 회독 배지·제목편집·새 회독 시작·회독 구분 + 문구 회독화"
```

---

### Task 5: 책장 + 문구 일괄 + ADR-016/glossary

**Files:**
- Modify: `src/screens/books.ts`, `src/screens/export.ts`, `src/screens/transfer.ts`, `src/screens/capture.ts`, `src/lib/prompt.ts`, `docs/decisions.md`, `docs/glossary.md`

**Interfaces:**
- Consumes: `currentRoundFor` (T1).

- [ ] **Step 1: books.ts 책장 승격** — 타이틀 "책 고르기"류 → **"책장"**. 각 책 행에 📷/✍️ 버튼 추가(`currentRoundFor(book.uuid)` → capture, stopPropagation) + **행 탭 = 책 Review**(`nav review(book)`)로 변경. 기존 renderProject(모드+목적 입력 시작 화면)는 **신규 책 등록 직후에만** 사용(등록→1회독 시작 흐름 유지, 문구 "세션"→"회독"·목적 placeholder "회독 제목(선택)"). `hasPendingSharedText` 입력모드 기본은 유지. 삭제 confirm `books.ts:87` "모든 세션·캡처" → "모든 회독·캡처".

- [ ] **Step 2: 문구 일괄** — `export.ts:31` scopeLabel "이번 세션"→"이번 회독"; `export.ts:93` 파일명 `"세션"`→`"회독"`; `transfer.ts:63` flash "세션 N"→"회독 N"; `prompt.ts:16` 주석; `capture.ts` 내 "세션" 사용자 노출 문구 검색·교체(있으면). 전체 `grep -rn "세션" src/`로 잔여 사용자 노출 문구 0 확인(코드 식별자·주석 제외 판단).

- [ ] **Step 3: ADR-016 + glossary** — `docs/decisions.md`에 ADR-016(세션=회독 재정의: 번호 계산·project=제목·자동종료 삭제·currentRoundFor/startNewSession 역할 분리·홈=책; ADR-005 개정 명시, 기존 형식). `docs/glossary.md` 세션→회독 갱신.

- [ ] **Step 4: 빌드 + 스모크 + Commit**

Run: `npm run build` → 무에러. `npm run test:pdf` → PASS.
```bash
git add -A
git commit -m "feat: 책장 승격 + 문구 회독화 일괄 + ADR-016/glossary"
```

---

## Self-Review
**1. Spec coverage:** currentRoundFor/endOpenRoundsForBook/BookView/recentBooks/구분헬퍼 → T1; 자동종료 삭제+공유수신 → T2; 홈 재작업(M4·M5 포함) → T3; review(C4·C5·4b·구분·문구) → T4; 책장+문구(M1·M2·M3·prompt 주석)+ADR/glossary → T5. 검토 조정 10건 전부 매핑 ✓.
**2. Placeholder scan:** 전 태스크 구체 코드. "현재 파일 먼저 읽기"는 변수명 정합용(의도적). ✓
**3. Type consistency:** `currentRoundFor(bookId)→Promise<string>`·`BookView`·`recentBooks(n)`·`roundNumberOf(sessions,id)`·`capturesWithRoundsForBook(bookId)` (T1 정의) ↔ T2~T5 사용 일치. `startNewSession` 시그니처 불변. ✓

## 참고
- 순서 의존: T1 → (T2·T3·T4·T5). 같은 워크트리 순차 실행.
- preview 검증(병합 전): 홈=책 목록, 📷 연타에도 회독 안 늘어남(핵심!), 새 회독 시작→번호 증가·이어 캡처, 회독 제목 사후 편집, 공유 수신, 책장.
- 표지 썸네일(외부 조회)은 이 배치 머지 후 별도 spec.
