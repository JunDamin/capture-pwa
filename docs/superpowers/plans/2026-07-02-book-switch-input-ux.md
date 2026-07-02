# 책 전환 + 입력모드 UX + 날짜 구분 + 회독 잠복 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 캡처 대상 책을 쉽게 바꾸고(입력모드·상세), 생각만으로도 저장하고, 입력 흐름을 태그-우선으로 정리하고(저장 토스트 포함), Review를 날짜로 구조화하며, 회독 UI는 잠복시킨다(데이터·헬퍼 보존).

**Architecture:** 공용 `lib/bookpicker.ts`(bottom sheet, recentBooks)를 capture/detail이 재사용. capture.ts는 in-place 세션 교체(늦은 바인딩 검증됨: onPick이 session·pill·count 3종 갱신). 회독 잠복은 표시 계층만 제거(db 헬퍼·roundNo 유지). 날짜 구분선이 목록의 유일한 구조가 됨.

**Tech Stack:** Vanilla TS + Vite + idb. 기존 시트/토스트 패턴 재사용.

## Global Constraints
- **사진 모드 3초 루프 불변.** 책 전환 핸들러는 `.pill__title`에 한 번 배선 + 내부 `if (currentMode !== "input") return;` 가드(mount 분기 금지 — 런타임 토글 대응).
- **onPick 3종 갱신**: ① `session` 재할당(getSession(currentRoundFor(...))) ② `.pill__title` 전체 재렌더(제목+project 칩, esc) ③ `count = await countCaptures(...)` + cntEl 갱신. **시트 dismiss는 갱신 완료 후**(레이스 방지).
- 세션 획득은 **currentRoundFor만**(startNewSession 금지). 같은 책 pick = 닫기(no-op).
- bookpicker: `document.body` append(viewer.ts 방식), `max-height`+`overflow-y:auto`+`-webkit-overflow-scrolling:touch`, 행 ≥48px, 표지는 `cover instanceof ArrayBuffer` 가드, objectURL 자체 revoke(dismiss 시).
- 입력 검증: **passage 또는 note ≥1**(둘 다 비면 두 필드 err), placeholder "(필수)"→"(선택)". 토스트 톤 "~했어요" 일관.
- 회독 잠복: **UI만 제거** — db 헬퍼(currentRoundFor/startNewSession/roundNumberOf/displayRoundNo/capturesWithRoundsForBook)·`Session.roundNo`·데이터 전부 보존(미사용 export여도 삭제 금지 — 재도입 여유). tsc가 unused로 잡으면 export 유지로 회피(export는 unused 에러 안 남).
- 문구: "이번 회독"→"최근 기록"(review 세션 스코프 + export scopeLabel + PDF 파일명 "회독"→"기록"), "이 회독 삭제" 링크 제거. 탭타깃 ≥44px(pill 히트영역 확대 포함).
- 테스트 프레임워크 없음: 각 태스크 = `npm run build` + 커밋(T5는 `test:pdf`도).

## File Structure
- T1: `src/lib/bookpicker.ts`(신규) + `src/styles/app.css`
- T2: `src/screens/capture.ts`(책 전환) + `src/styles/app.css`(▾ 힌트·히트영역)
- T3: `src/screens/capture.ts`(생각만+순서+토스트)
- T4: `src/screens/detail.ts`(책 바꾸기+toast div)
- T5: `src/screens/review.ts`(날짜 구분+회독 잠복+문구)·`home.ts`·`books.ts`(카드 라벨)·`export.ts`/`prompt.ts`(문구)·`docs/decisions.md`(ADR-016 개정 메모)

---

### Task 1: 공용 책 선택 시트 (`src/lib/bookpicker.ts`)

**Files:**
- Create: `src/lib/bookpicker.ts`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: `recentBooks(50): Promise<BookView[]>`(db).
- Produces: `openBookPicker(opts: { currentBookId?: string; onPick: (book: Book) => void | Promise<void> }): void`.

- [ ] **Step 1: 모듈 작성**

```typescript
/** 책 선택 바텀시트 — capture(책 전환)/detail(책 바꾸기) 공용. objectURL 자체 관리. */
import { recentBooks } from "../db/db.ts";
import type { Book } from "../db/types.ts";

export function openBookPicker(opts: {
  currentBookId?: string;
  onPick: (book: Book) => void | Promise<void>;
}): void {
  const urls: string[] = [];
  const el = document.createElement("div");
  el.className = "bookpick";
  el.innerHTML = `<div class="bookpick__card"><div class="bookpick__t">책 선택</div><div class="bookpick__list"><div class="loading">불러오는 중…</div></div></div>`;
  document.body.appendChild(el);
  const dismiss = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.length = 0;
    el.remove();
  };
  el.onclick = (ev) => { if (ev.target === el) dismiss(); };

  (async () => {
    const views = await recentBooks(50);
    const list = el.querySelector(".bookpick__list") as HTMLElement;
    if (!list.isConnected) return; // 이미 dismiss됨
    if (!views.length) { list.innerHTML = `<div class="hint-empty">책이 없어요</div>`; return; }
    list.innerHTML = views.map((v, i) => {
      let coverHtml = `<div class="mini cov-${(i % 3) + 1}"></div>`;
      if (v.book.cover instanceof ArrayBuffer) {
        const u = URL.createObjectURL(new Blob([v.book.cover], { type: v.book.coverType ?? "image/jpeg" }));
        urls.push(u);
        coverHtml = `<img class="mini mini--img" src="${u}" alt="" />`;
      }
      const cur = v.book.uuid === opts.currentBookId;
      return `<button class="bookpick__row" data-i="${i}">
        ${coverHtml}
        <span class="bookpick__body"><span class="bookpick__title">${esc(v.book.title)}</span>
        <span class="bookpick__sub">${v.captureCount} captures</span></span>
        ${cur ? `<span class="bookpick__check">✓</span>` : ""}
      </button>`;
    }).join("");
    list.querySelectorAll<HTMLButtonElement>(".bookpick__row").forEach((row) => {
      row.onclick = async () => {
        const v = views[Number(row.dataset.i)];
        if (v.book.uuid === opts.currentBookId) { dismiss(); return; } // 같은 책 = no-op
        await opts.onPick(v.book); // 갱신 완료 후 닫기(레이스 방지)
        dismiss();
      };
    });
  })();
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
```

- [ ] **Step 2: CSS**

```css
.bookpick { position: fixed; inset: 0; z-index: 60; background: rgba(25,31,40,0.4); display: grid; place-items: end center; padding: 16px; }
.bookpick__card { background: #fff; border-radius: 20px 20px 16px 16px; width: 100%; max-width: 420px; padding: 18px 14px calc(env(safe-area-inset-bottom, 0px) + 14px); }
.bookpick__t { font-weight: 700; font-size: 16px; color: var(--ink); margin: 0 6px 12px; }
.bookpick__list { max-height: 55vh; overflow-y: auto; -webkit-overflow-scrolling: touch; display: flex; flex-direction: column; gap: 6px; }
.bookpick__row { display: flex; align-items: center; gap: 12px; min-height: 56px; background: var(--surface); border: none; border-radius: 12px; padding: 8px 12px; text-align: left; cursor: pointer; }
.bookpick__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.bookpick__title { font-size: 15px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bookpick__sub { font-size: 12px; color: var(--sub); }
.bookpick__check { margin-left: auto; color: var(--primary); font-weight: 700; }
```
(`.mini--img`는 기존 재사용 — bookpick 내에서도 크기 정상인지 확인, 필요 시 `.bookpick__row .mini { flex-shrink: 0; }`.)

- [ ] **Step 3: 빌드 + Commit**

Run: `npm run build` → 무에러(모듈 미사용이어도 export라 OK).
```bash
git add src/lib/bookpicker.ts src/styles/app.css
git commit -m "feat: 공용 책 선택 시트(bookpicker) — 표지·현재책 체크·자체 objectURL 관리"
```

---

### Task 2: capture 입력모드 책 전환

**Files:**
- Modify: `src/screens/capture.ts`, `src/styles/app.css`

**Interfaces:**
- Consumes: `openBookPicker`(T1), `currentRoundFor`/`getSession`/`countCaptures`/`getBook`(db).

구현자는 **현 capture.ts를 먼저 읽고**(run(session, bookTitle, startCount), `.pill__title` 마크업(제목+project 칩), `currentMode`/setMode, count/cntEl(84·90·247·340 부근), 저장 핸들러의 늦은 바인딩) 적용.

- [ ] **Step 1: 핸들러(게이트) + onPick 3종 갱신**

```typescript
// pill 책 전환 — 입력모드에서만 동작(런타임 가드)
const pillTitle = root.querySelector(".pill__title") as HTMLElement;
pillTitle.onclick = () => {
  if (currentMode !== "input") return; // 사진 모드 불변(3초 루프)
  openBookPicker({
    currentBookId: session.bookId,
    onPick: async (book) => {
      const sid = await currentRoundFor(book.uuid);
      session = (await getSession(sid))!;
      // pill 전체 재렌더(제목+회독 목적 칩 잔류 방지)
      pillTitle.innerHTML = `📚 ${esc(book.title)}${session.project ? ` <span class="pill__proj">🎯 ${esc(session.project)}</span>` : ""}`;
      count = await countCaptures(session.uuid);
      cntEl.textContent = `📍 ${count} ›`;
    },
  });
};
```
(실제 pill 마크업 구조·esc·count/cntEl 변수명은 현 코드에 맞춤 — pill의 project 칩 마크업이 다르면 동일 구조로 재현. `session`은 run 파라미터 재할당 — 저장·카운트 네비가 이벤트 시점에 `session.uuid`를 읽으므로 충분(검토 확인). `getSession`/`countCaptures` import 추가.)

- [ ] **Step 2: ▾ 힌트 + 히트영역 (CSS)**

```css
.cam.mode--input .pill__title { cursor: pointer; padding: 12px 4px; margin: -12px -4px; } /* 히트영역 ≥48px */
.cam.mode--input .pill__title::after { content: " ▾"; color: var(--sub); font-size: 11px; }
```
(입력모드는 밝은 배경 — var(--sub) 가독 확인. 사진 모드는 ::after 없음(셀렉터 스코프).)

- [ ] **Step 3: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/screens/capture.ts src/styles/app.css
git commit -m "feat: 입력모드에서 캡처 대상 책 전환(pill 탭 → 시트, 텍스트 유지)"
```

---

### Task 3: capture 입력모드 UX — 생각만 저장 + 필드 순서 + 토스트

**Files:**
- Modify: `src/screens/capture.ts`, `src/styles/app.css`(필요 시)

- [ ] **Step 1: 생각만 캡처(검증 완화)**

입력 저장 핸들러(capture.ts:306 부근)의 `if (!passageVal) { ... }` →
```typescript
if (!passageVal && !noteVal) {
  inpPassage.classList.add("field--err");
  inpNote.classList.add("field--err");
  return;
}
```
`inpNote`(:70)에도 `oninput = () => classList.remove("field--err")` 추가. **두 리셋 경로(setMode("photo") :153 부근, 저장 후 초기화 :350 부근)에서 `inpNote`의 field--err도 클리어**(현재 passage만). placeholder `담고 싶은 글 (필수)` → `(선택)`(:432). 파일 헤더 주석(:4) "passage(필수)" → "passage 또는 note ≥1". 기존 `isValidCapture` 검사(:317) 유지.

- [ ] **Step 2: 필드 순서 재배치**

현 순서(:429-439: passage → note → page → hint → tagrow → save)를 **① `.inp__hint` + `.inp__tagrow`(hint는 태그 에러 안내 — 태그와 함께 이동) → ② 담은 글 → ③ 내 생각 → ④ 페이지 → ⑤ 저장** 으로 재배열. 배선·CSS 전부 클래스 셀렉터(형제 셀렉터 없음 — 검토 확인)라 마크업 이동만. 자동 포커스 passage 유지.

- [ ] **Step 3: 저장 토스트 (+showDone 중복 제거)**

- **입력 저장 핸들러의 `showDone()`(:353) 제거** — 현재 입력 저장도 전면 ✓ 배지를 띄우고 있어 토스트와 이중 피드백이 됨. 사진 경로(:250)는 불변.
- capture 템플릿에 `.toast` div 추가(books/export 패턴, `hidden`+setTimeout **3000ms**) + **CSS `pointer-events: none`**(저장 버튼 위에 얹히므로). 저장 성공 시 `flash("저장했어요")`. 연속 저장 시 이전 타이머 clear.

- [ ] **Step 3b: 동결 화면 크롭 프레임 유지 (§9)**

`src/styles/app.css`의 `.cam.is-frozen .cropframe { display: none; }` 규칙 **제거**(입력모드 숨김 `.cam.mode--input .cropframe`은 유지). 동결 사진 위에 프레임+마스크가 남아 "무엇이 저장될지" 표시 — 동결 중 프레임 조정도 저장에 반영(저장이 getRect()를 저장 시점에 읽음 — 의도된 부수 효과, 주석으로 명시).

- [ ] **Step 4: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/screens/capture.ts src/styles/app.css
git commit -m "feat: 입력모드 UX — 생각만 저장 허용·태그 우선 배치·저장 토스트"
```

---

### Task 4: detail 책 바꾸기

**Files:**
- Modify: `src/screens/detail.ts`, `src/styles/app.css`(필요 시)

**Interfaces:**
- Consumes: `openBookPicker`(T1), `currentRoundFor`/`getSession`/`getBook`/`updateCapture`(db).

구현자는 **현 detail.ts를 먼저 읽고**(getCapture만 로드·세션/책 컨텍스트 없음, 편집 저장 스프레드(:123), toast 없음, back(from)) 적용.

- [ ] **Step 1: 컨텍스트 로드 + 책 표시**

로드 시 `const session = await getSession(cap.sessionId); const book = session ? await getBook(session.bookId) : null;` → 상세 상단/메타 영역에 현재 책 이름 작게 표시(`📚 제목`) + **"책 바꾸기"** 버튼(≥44px, btn-ghost 톤).

- [ ] **Step 2: 이동 + 토스트**

```typescript
changeBtn.onclick = () => openBookPicker({
  currentBookId: book?.uuid,
  onPick: async (b) => {
    cap.sessionId = await currentRoundFor(b.uuid);
    cap.updatedAt = Date.now();
    await updateCapture(cap);
    // 화면의 책 이름 갱신 + 토스트
    flash(`『${b.title}』(으)로 옮겼어요`);
  },
});
```
`.toast` div + flash 헬퍼(books.ts:170-178 패턴, 2400ms) 추가. `book` 로컬 갱신. back은 기존 `from` 유지(옛 Review에 없을 수 있음 — 의도된 수용, 주석).

- [ ] **Step 3: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/screens/detail.ts src/styles/app.css
git commit -m "feat: 캡처 상세에서 책 바꾸기(현재 회독으로 이동)"
```

---

### Task 5: 날짜 구분선 + 회독 UI 잠복 + 문구

**Files:**
- Modify: `src/screens/review.ts`, `src/screens/home.ts`, `src/screens/books.ts`, `src/screens/export.ts`, `src/lib/prompt.ts`(주석), `src/styles/app.css`, `docs/decisions.md`

- [ ] **Step 1: review.ts — 회독 UI 제거 + 날짜 구분선**

- 제거(델타검토 정밀 목록): 회독 배지 `hero__round`(:110)·roundBadge(:67-70), topbar ✎(:101)+editProj 핸들러(:171-203), "새 회독 시작"(:117, :157-161), roundsep 목록(:84-94 — `capturesWithRoundsForBook`을 `capturesForBook` flat으로 되돌림, 책 스코프 :47-56), "이 회독 삭제"(:145, :163-169), 상태 currentRound/currentRoundNo/groups(:26-28)와 capdel의 groups 유지코드(:228-230).
- **import 정리(tsc strict 필수):** `capturesWithRoundsForBook`/`deleteSession`/`displayRoundNo`/`putSession`/`sessionsForBook`/`startNewSession` 드롭, **`capturesForBook` 추가**. db 함수 자체는 보존(export 유지).
- 세션 스코프 hero의 `toBook`/`toBookExport`(:115-116)는 유지.
- 날짜 구분선: 캡처 목록 렌더(책·세션 스코프 공통)에서 직전 캡처와 `startOfDay(createdAt)`가 다르면 라벨 삽입:
```typescript
function dateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const y = d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}년 ` : "";
  return `— ${y}${d.getMonth() + 1}월 ${d.getDate()}일 —`;
}
```
`<div class="datesep">${dateLabel(c.createdAt)}</div>`. CSS `.datesep { text-align: center; color: var(--sub); font-size: 11px; opacity: 0.8; margin: 12px 0 4px; }`(roundsep CSS는 미사용화 — 제거 가능).
- 문구: 세션 스코프 라벨 "이번 회독" → **"최근 기록"**.

- [ ] **Step 2: home.ts/books.ts — 카드 라벨·문구 단순화**

- home `roundLabel`(:88-92) 제거 → topCard sessionchip(:110)은 `${v.captureCount} Captures`, bookItem item__s(:128)는 `${v.captureCount} captures`(+기존 relTime). BookView의 roundNumber/currentRound 사용처 제거(필드는 db에 남음).
- books 행엔 회독 배지 없음(확인됨 — no-op). **renderProject 문구 중립화:** topbar/버튼 "회독 시작" → "독서 시작", placeholder "회독 제목 (선택)" → "목적 (선택)"(project 설정 경로는 유지 — pill 🎯·prompt 목적에 사용). 삭제 confirm(:99) "모든 회독·캡처" → "모든 기록·캡처".
- transfer.ts 복원 flash "회독 N" → "기록 N".

- [ ] **Step 3: export/prompt 문구**

`export.ts:30` scopeLabel "이번 회독" → "최근 기록"; `export.ts:94` PDF 파일명 `"회독"` → `"기록"`; `prompt.ts:14` 주석 갱신.

- [ ] **Step 4: ADR-016 개정 메모 + glossary + CSS 정리**

- `docs/decisions.md` ADR-016에 개정 메모(같은 형식): "2026-07-02 회독 UI 잠복 — 회독 노출 불필요 판단(사용자). **UI만 제거**(배지/새 회독/구분/✎편집/삭제링크), 데이터 모델(Session=회독, roundNo)·db 헬퍼 보존 — 재도입 시 UI만 복원. 목록 구조는 날짜 구분선으로 대체."
- `docs/glossary.md`의 "새 회독 시작"/회독 관련 항목 갱신(잠복 상태 명시).
- CSS: `.hero__round`/`.roundsep`/`.review__editproj` 제거(review 전용 — 확인됨), `.scopebtn` 유지. `.datesep` 추가.

- [ ] **Step 5: 빌드 + 스모크 + Commit**

Run: `npm run build` → 무에러(미사용 import 정리 — export 함수는 보존). `npm run test:pdf` → PASS.
```bash
git add -A
git commit -m "feat: Review 날짜 구분선 + 회독 UI 잠복(데이터 보존) + 문구 정리"
```

---

## Self-Review
**1. Spec coverage:** §1 bookpicker → T1(스크롤 CSS·body append·같은책 no-op·레이스·revoke); §2 책 전환(게이트·3종 갱신·▾ CSS·히트영역) → T2; §4 생각만 → T3; §7 순서 → T3; §8 토스트 → T3; §3 detail(컨텍스트 로드·toast div·back 수용) → T4; §5 날짜 구분선 → T5; §6 회독 잠복(홈/책장/review/export/ADR) → T5. 검토 조정 7건 전부 매핑 ✓.
**2. Placeholder scan:** 전 태스크 구체 코드(변수명 정합만 "현 파일 확인"). ✓
**3. Type consistency:** `openBookPicker(opts)`(T1) ↔ T2/T4 사용 일치; `currentRoundFor`/`getSession`/`countCaptures` 기존 시그니처; BookView 사용 T1. ✓

## 참고
- 순서: T1 → T2 → T3 → T4 → T5 (같은 워크트리 순차; T2·T3 같은 파일 — 순차 필수).
- preview 검증: 입력모드 pill 탭→책 전환→텍스트 유지→저장 위치; 생각만 저장; 태그 우선 배치; 저장 토스트; detail 책 바꾸기; Review 날짜 구분·회독 흔적 0; 사진 모드 pill 무반응.
- 회독 재도입 여유: db 헬퍼·roundNo·ADR-016 메모로 보장.
