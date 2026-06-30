# 사후 편집 & 캡처 상세 보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 만든 캡처·책·세션을 사후에 보고 고칠 수 있게 하고(캡처 상세+편집·책·세션 편집·페이지), 가로 촬영을 지원한다.

**Architecture:** 기존 인메모리 라우터(`src/app.ts`)에 `detail` 라우트와 새 화면 `src/screens/detail.ts`를 더한다. 데이터 계층은 `Capture.page?` 한 필드와 `getCapture` 한 함수만 추가하고, 편집은 기존 `updateCapture`/`putBook`/`putSession`을 재사용한다. 공유는 데이터·검증(`types.ts`)에만 두고 화면 뷰는 의도적으로 공유하지 않는다(spec 구조 점검).

**Tech Stack:** Vanilla TypeScript + Vite + idb(IndexedDB), vite-plugin-pwa(workbox). 빌드 = `tsc && vite build`.

## Testing approach (이 저장소 적응)

이 프로젝트엔 테스트 프레임워크가 없다(의존성은 idb뿐, vanilla DOM PWA). 테스트 러너를 새로 도입하는 것은 사용자의 "단순하게" 원칙과 spec 검증 방식에 어긋난다. 따라서 각 태스크의 검증 사이클은:

1. **타입체크/빌드:** `npm run build` (= `tsc && vite build`) 무에러.
2. **수동 확인:** `npm run preview` 후 명시된 동작을 브라우저에서 확인(가로는 데스크톱 창 비율 또는 실기기 회전).
3. **커밋.**

각 코드 단계는 실제 코드를 그대로 싣는다. "구현은 나중에" 류 placeholder 금지.

## Global Constraints

- **마이크로카피는 기존 문자열 그대로 재사용**: "왜 저장했나요?", "한 가지 태그를 고르세요", "저장", 세션 목적은 "왜 이 책을 읽나요?". 새 변형 문구 금지.
- **색 규율**: UI는 무채(잉크 `#191F28`/Sub `#8B95A1`/Surface `#F2F4F6`/White) + 파랑 하나 `#3182F6`. 색은 라이브 카메라와 태그 이모지에서만. 태그 텍스트 라벨은 무채.
- **Shape**: 카드 16px, 버튼 14px, 칩/태그 full pill. CTA = 하단 풀폭 솔리드 파랑 ~56px.
- **품질 바닥선**: 모바일 반응형, 키보드 포커스 가시, `prefers-reduced-motion` 준수, 탭타깃 ≥48px.
- **캡처 3초 루프 불가침**: 캡처 화면 변경은 셔터→태그→왜→저장 흐름을 느리게 하거나 포커스를 가로채면 안 됨.
- **모든 사용자 입력은 `esc()`로 이스케이프**(기존 각 화면의 `esc` 헬퍼 패턴 유지).

---

### Task 1: 데이터 모델 — `Capture.page?` + `getCapture`

**Files:**
- Modify: `src/db/types.ts` (Capture 인터페이스)
- Modify: `src/db/db.ts` (Captures 섹션)

**Interfaces:**
- Produces: `Capture.page?: number` 선택 필드. `getCapture(id: string): Promise<Capture | undefined>`.
- Consumes: 없음.

- [ ] **Step 1: `Capture`에 `page?` 추가**

`src/db/types.ts`의 `Capture` 인터페이스에서 `ocr` 줄 위에 추가:

```typescript
  page?: number; // 책 페이지 번호 — 선택(사후 입력 가능)
  ocr: string | null;
```

- [ ] **Step 2: `getCapture` 추가**

`src/db/db.ts`의 `addCapture` 함수 바로 아래(updateCapture 위)에 추가:

```typescript
export async function getCapture(id: string): Promise<Capture | undefined> {
  return (await db()).get("captures", id);
}
```

- [ ] **Step 3: 빌드로 타입 확인**

Run: `npm run build`
Expected: 에러 없이 완료(타입체크 통과). `page?`는 IndexedDB 버전업 불필요(레코드 스키마리스).

- [ ] **Step 4: Commit**

```bash
git add src/db/types.ts src/db/db.ts
git commit -m "feat: Capture.page 필드 + getCapture 조회 추가"
```

---

### Task 2: 태그 라벨화 (캡처 행 + Review 카드 + CSS)

**Files:**
- Modify: `src/screens/capture.ts` (template의 태그 버튼)
- Modify: `src/screens/review.ts` (card()의 captag)
- Modify: `src/styles/app.css` (`.tag`, `.captag`)

**Interfaces:**
- Consumes: `TAGS`(emoji,label,key) from `types.ts`.
- Produces: 태그가 전 화면에서 이모지+무채 라벨로 표시. 새 함수/타입 없음.

- [ ] **Step 1: 캡처 화면 태그 버튼에 라벨 추가**

`src/screens/capture.ts`의 `template()` 안 `tags` 정의를 교체:

```typescript
  const tags = TAGS.map(
    (t) =>
      `<button class="tag" data-tag="${t.key}" aria-label="${t.label}">${t.emoji}<span class="tag__l">${t.label}</span></button>`,
  ).join("");
```

- [ ] **Step 2: Review 카드 태그에 라벨 추가**

`src/screens/review.ts`의 `card()`에서 capmeta 줄을 교체:

```typescript
      <div class="capmeta"><span class="captag">${tag.emoji} ${tag.label}</span> ${esc(c.why ?? (c.memo ? c.memo : "—"))}</div>
```

- [ ] **Step 3: CSS — 캡처 태그 라벨/Review 태그 칩 스타일**

`src/styles/app.css`의 `.tag { ... }` 규칙 뒤에 추가(기존 `.tag`는 그대로 두고 보강):

```css
.tag {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.tag__l {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.82);
  line-height: 1;
}
```

그리고 `.captag` 규칙을 다음으로 교체(라벨이 들어가도 색 규율 유지 — 이모지만 색, 텍스트는 잉크):

```css
.captag {
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}
```

- [ ] **Step 4: 빌드 + 수동 확인**

Run: `npm run build` → 무에러.
Run: `npm run preview` → 캡처 화면에서 태그 5개가 `이모지+작은 라벨`로 한 줄에 보임(탭타깃 충분). Review에서 카드 태그가 `💡 흥미롭다`로 보임.

- [ ] **Step 5: Commit**

```bash
git add src/screens/capture.ts src/screens/review.ts src/styles/app.css
git commit -m "feat: 태그에 텍스트 라벨 표시(이모지=색, 텍스트=무채)"
```

---

### Task 3: 캡처 상세 + 편집 화면 (신규 화면 + 라우트 + 진입)

**Files:**
- Create: `src/screens/detail.ts`
- Modify: `src/app.ts` (Route 타입 + import + switch)
- Modify: `src/screens/review.ts` (캡처 카드 탭 → 상세)
- Modify: `src/styles/app.css` (상세 화면 스타일)

**Interfaces:**
- Consumes: `getCapture`, `updateCapture` from `db.ts`; `TAGS`,`WHY_CHIPS`,`isValidCapture`,`Capture`,`Tag` from `types.ts`; `Nav`,`Scope` from `app.ts`; `Capture.page?`(Task 1).
- Produces: `mountDetail(root: HTMLElement, nav: Nav, captureId: string, from: { scope: Scope; id: string }): () => void`. Route `{ name: "detail"; captureId: string; from: { scope: Scope; id: string } }`.

- [ ] **Step 1: `app.ts`에 라우트 추가**

`src/app.ts`에서 import 줄에 추가:

```typescript
import { mountDetail } from "./screens/detail.ts";
```

`Route` 유니온에 한 줄 추가:

```typescript
  | { name: "export"; scope: Scope; id: string }
  | { name: "detail"; captureId: string; from: { scope: Scope; id: string } };
```

switch 문에 케이스 추가(export 케이스 뒤):

```typescript
      case "detail":
        cleanup = mountDetail(root, nav, route.captureId, route.from);
        break;
```

- [ ] **Step 2: `detail.ts` 작성**

`src/screens/detail.ts` 생성:

```typescript
/** 캡처 상세 + 편집 — 큰 사진 + 태그/왜/메모/페이지 수정. PRD §8, ADR-004. */
import type { Nav, Scope } from "../app.ts";
import { getCapture, updateCapture } from "../db/db.ts";
import { TAGS, WHY_CHIPS, isValidCapture, type Capture, type Tag } from "../db/types.ts";

export function mountDetail(
  root: HTMLElement,
  nav: Nav,
  captureId: string,
  from: { scope: Scope; id: string },
): () => void {
  const urls: string[] = [];
  root.innerHTML = `<div class="scr scr--light"><div class="loading">불러오는 중…</div></div>`;

  const back = () => nav({ name: "review", scope: from.scope, id: from.id });

  (async () => {
    const cap = await getCapture(captureId);
    if (!cap) return back();
    render(cap);
  })();

  function render(cap: Capture) {
    let tag: Tag = cap.tag;
    let why: string | null = cap.why;
    let freeMode = why != null && !WHY_CHIPS.includes(why as never);

    const tagPills = TAGS.map(
      (t) =>
        `<button class="tagpill ${t.key === tag ? "is-sel" : ""}" data-tag="${t.key}">${t.emoji} ${t.label}</button>`,
    ).join("");
    const whyChips = WHY_CHIPS.map(
      (w) =>
        `<button class="chip ${!freeMode && why === w ? "is-sel" : ""}" data-why="${w}">${esc(w)}</button>`,
    ).join("");

    const d = new Date(cap.createdAt);
    const p = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;

    root.innerHTML = `
    <div class="scr scr--light detail">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">캡처</div>
      </div>

      <div class="detail__photo ${cap.image ? "" : "detail__photo--none"}">${cap.image ? "" : "📝"}</div>

      <div class="card">
        <div class="card__h">한 가지 태그를 고르세요</div>
        <div class="tagpills">${tagPills}</div>
      </div>

      <div class="card">
        <h2 class="detail__q">왜 저장했나요?</h2>
        <div class="chips">
          ${whyChips}
          <button class="chip chip--write ${freeMode ? "is-sel" : ""}">직접 입력…</button>
        </div>
        <textarea class="field detail__free" rows="2" placeholder="왜 저장했는지 한 줄" style="display:${freeMode ? "block" : "none"}">${freeMode ? esc(why ?? "") : ""}</textarea>
      </div>

      <div class="card">
        <div class="card__h">메모</div>
        <textarea class="field detail__memo" rows="3" placeholder="메모 (선택)">${esc(cap.memo ?? "")}</textarea>
      </div>

      <div class="card detail__pagerow">
        <span class="card__h">📖 페이지</span>
        <input class="field detail__page" type="number" inputmode="numeric" min="1" placeholder="선택" value="${cap.page ?? ""}" />
      </div>

      <div class="detail__stamp">${stamp}</div>

      <button class="btn-primary save">저장</button>
    </div>`;

    if (cap.image) {
      const u = URL.createObjectURL(cap.image);
      urls.push(u);
      (root.querySelector(".detail__photo") as HTMLElement).style.backgroundImage = `url(${u})`;
    }

    (root.querySelector(".back") as HTMLElement).onclick = back;

    const free = root.querySelector(".detail__free") as HTMLTextAreaElement;
    const memo = root.querySelector(".detail__memo") as HTMLTextAreaElement;
    const pageEl = root.querySelector(".detail__page") as HTMLInputElement;
    const writeChip = root.querySelector(".chip--write") as HTMLElement;
    const chipEls = Array.from(root.querySelectorAll(".chip[data-why]")) as HTMLElement[];
    const tagEls = Array.from(root.querySelectorAll(".tagpill")) as HTMLElement[];

    tagEls.forEach((el) => {
      el.onclick = () => {
        tag = el.dataset.tag as Tag;
        tagEls.forEach((x) => x.classList.toggle("is-sel", x === el));
      };
    });

    chipEls.forEach((el) => {
      el.onclick = () => {
        const v = el.dataset.why!;
        const already = el.classList.contains("is-sel");
        chipEls.forEach((c) => c.classList.remove("is-sel"));
        writeChip.classList.remove("is-sel");
        free.style.display = "none";
        freeMode = false;
        if (already) {
          why = null;
        } else {
          el.classList.add("is-sel");
          why = v;
        }
      };
    });
    writeChip.onclick = () => {
      chipEls.forEach((c) => c.classList.remove("is-sel"));
      writeChip.classList.add("is-sel");
      free.style.display = "block";
      free.focus();
      freeMode = true;
    };

    (root.querySelector(".save") as HTMLButtonElement).onclick = async () => {
      const memoVal = memo.value.trim() || null;
      const whyVal = freeMode ? free.value.trim() || null : why;
      const n = parseInt(pageEl.value, 10);
      const page = Number.isFinite(n) && n > 0 ? n : undefined;

      if (!isValidCapture({ image: cap.image, memo: memoVal, tag })) {
        alert("사진이나 메모 중 하나는 있어야 해요.");
        return;
      }
      await updateCapture({ ...cap, tag, why: whyVal, memo: memoVal, page, updatedAt: Date.now() });
      back();
    };
  }

  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
```

- [ ] **Step 3: Review 카드 탭 → 상세 진입**

`src/screens/review.ts`의 `render()` 안 `caps.forEach((c) => { ... })` 블록에서, 썸네일 주입 다음·`capdel` 핸들러 위에 카드 탭 핸들러를 추가:

```typescript
      el.onclick = () => nav({ name: "detail", captureId: c.uuid, from: { scope, id } });
      (el.querySelector(".capdel") as HTMLElement).onclick = async (ev) => {
        ev.stopPropagation();
        if (!confirm("이 캡처를 삭제할까요?")) return;
        await deleteCapture(c.uuid);
        const next = caps.filter((x) => x.uuid !== c.uuid);
        render(next);
      };
```

(주의: `capdel`의 `ev.stopPropagation()`가 카드 탭과 충돌하지 않게 유지한다 — 이미 있음.)

- [ ] **Step 4: 상세 화면 CSS**

`src/styles/app.css` 맨 끝에 추가:

```css
/* --- 캡처 상세/편집 --- */
.detail {
  padding-bottom: 88px; /* 하단 고정 저장 버튼 공간 */
}
.detail__photo {
  width: 100%;
  max-height: 56vh;
  aspect-ratio: 4 / 3;
  background: var(--surface);
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  border-radius: var(--r-card);
  margin: 4px 0 16px;
}
.detail__photo--none {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  aspect-ratio: 16 / 9;
}
.tagpills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tagpill {
  padding: 10px 14px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
  min-height: 44px;
}
.tagpill.is-sel {
  background: var(--primary);
  color: #fff;
}
.detail__q {
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 12px;
}
.detail__pagerow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.detail__pagerow .card__h {
  margin: 0;
}
.detail__page {
  width: 120px;
  text-align: right;
}
.detail__stamp {
  color: var(--sub);
  font-size: 13px;
  text-align: center;
  margin: 8px 0 16px;
  font-variant-numeric: tabular-nums;
}
.detail .save {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(16px + var(--safe-bottom));
  width: min(100% - 40px, 600px);
}
```

- [ ] **Step 5: 빌드 + 수동 확인**

Run: `npm run build` → 무에러.
Run: `npm run preview` → 캡처를 하나 만든 뒤 Review에서 그 카드를 탭 → 상세 화면에 큰 사진 + 태그 알약(현재 태그 선택됨) + "왜 저장했나요?" 칩 + 메모 + 페이지 칸 + 하단 "저장". 태그/왜/메모/페이지를 바꾸고 저장 → Review로 복귀, 다시 들어가면 변경 반영. 사진·메모 둘 다 비우고 저장 시도 → "사진이나 메모 중 하나는 있어야 해요" 안내 후 막힘.

- [ ] **Step 6: Commit**

```bash
git add src/screens/detail.ts src/app.ts src/screens/review.ts src/styles/app.css
git commit -m "feat: 캡처 상세+편집 화면(큰 사진·태그·왜·메모·페이지)"
```

---

### Task 4: 캡처 중 페이지 입력 (왜-시트)

**Files:**
- Modify: `src/screens/capture.ts` (template의 sheet + saveBtn 핸들러)
- Modify: `src/styles/app.css` (`.sheet__page`)

**Interfaces:**
- Consumes: `Capture.page?`(Task 1).
- Produces: 캡처 시 선택적으로 `rec.page` 설정. 새 함수/타입 없음.

- [ ] **Step 1: 시트에 페이지 입력칸 추가**

`src/screens/capture.ts`의 `template()`에서 `<textarea class="sheet__free" ...>` 줄 바로 위에 추가:

```typescript
      <input class="sheet__page" type="number" inputmode="numeric" min="1" placeholder="페이지(선택)" />
```

- [ ] **Step 2: 시트 핸들 참조 + 저장 시 반영 + 리셋**

`run()` 안 핸들 정의부(`const free = ...` 줄 근처)에 추가:

```typescript
    const pageInput = root.querySelector(".sheet__page") as HTMLInputElement;
```

`saveBtn.onclick` 안에서 `rec` 객체를 만든 직후(`await addCapture(rec);` 위)에 페이지 반영:

```typescript
      const pageNum = parseInt(pageInput.value, 10);
      if (Number.isFinite(pageNum) && pageNum > 0) rec.page = pageNum;
```

`resetToLive()` 안에 입력칸 초기화 추가(`free.value = "";` 근처):

```typescript
      pageInput.value = "";
```

- [ ] **Step 3: CSS — 시트 페이지칸**

`src/styles/app.css` 맨 끝에 추가:

```css
.sheet__page {
  width: 100%;
  margin-bottom: 10px;
}
```

(주의: `.sheet__page`에 자동 포커스 금지 — 3초 루프 보호. Step 2는 포커스를 주지 않는다.)

- [ ] **Step 4: 빌드 + 수동 확인**

Run: `npm run build` → 무에러.
Run: `npm run preview` → 캡처 → 태그 선택 → 시트에 "페이지(선택)" 칸 보임. 숫자 입력 후 저장 → Review→상세에서 그 페이지가 표시됨. 비우고 저장해도 정상 저장. 시트가 자동으로 페이지칸에 포커스 가로채지 않음(빠른 흐름 유지).

- [ ] **Step 5: Commit**

```bash
git add src/screens/capture.ts src/styles/app.css
git commit -m "feat: 캡처 시 선택적 페이지 입력(왜-시트)"
```

---

### Task 5: 책 편집 (목록 ✎ → 생성/편집 겸용 폼 + ISBN)

**Files:**
- Modify: `src/screens/books.ts` (bookRow에 ✎, 생성/편집 겸용 폼)
- Modify: `src/styles/app.css` (`.bookrow__edit`)

**Interfaces:**
- Consumes: `putBook`, `getBook`(이미 있음), `Book` from `types.ts`.
- Produces: 책 목록에서 제목/저자/ISBN 편집. `Book.isbn` 저장.

- [ ] **Step 1: bookRow에 ✎ 편집 버튼 추가**

`src/screens/books.ts`의 `bookRow()`를 교체:

```typescript
function bookRow(b: Book) {
  return `
  <div class="item" data-id="${b.uuid}">
    <div class="mini cov-1"></div>
    <div class="item__body">
      <div class="item__t">${esc(b.title)}</div>
      ${b.author ? `<div class="item__s">${esc(b.author)}</div>` : ""}
    </div>
    <button class="bookrow__edit" data-edit="${b.uuid}" aria-label="책 편집">✎</button>
    <div class="chev">›</div>
  </div>`;
}
```

- [ ] **Step 2: 목록에서 ✎ 핸들러 연결(행 탭과 분리)**

`renderList()`의 `root.querySelectorAll<HTMLElement>(".recent .item")...` 블록 바로 아래에 추가:

```typescript
    root.querySelectorAll<HTMLElement>(".bookrow__edit").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const book = books.find((b) => b.uuid === el.dataset.edit) ?? null;
        if (book) renderEdit(book);
      };
    });
```

- [ ] **Step 3: 편집 폼 `renderEdit` 추가**

`src/screens/books.ts`에 `renderProject` 함수 아래에 추가:

```typescript
  function renderEdit(book: Book) {
    root.innerHTML = `
    <div class="scr scr--light books">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">책 편집</div>
      </div>

      <div class="card form">
        <input class="field e-title" placeholder="책 제목" autocomplete="off" value="${esc(book.title)}" />
        <input class="field e-author" placeholder="저자 (선택)" autocomplete="off" value="${esc(book.author ?? "")}" />
        <input class="field e-isbn" placeholder="ISBN (선택)" autocomplete="off" value="${esc(book.isbn ?? "")}" />
        <button class="btn-primary save">저장</button>
      </div>
    </div>`;

    (root.querySelector(".back") as HTMLElement).onclick = () => renderList();
    const titleEl = root.querySelector(".e-title") as HTMLInputElement;
    const authorEl = root.querySelector(".e-author") as HTMLInputElement;
    const isbnEl = root.querySelector(".e-isbn") as HTMLInputElement;
    titleEl.oninput = () => titleEl.classList.remove("field--err");
    (root.querySelector(".save") as HTMLButtonElement).onclick = async () => {
      const title = titleEl.value.trim();
      if (!title) {
        titleEl.focus();
        titleEl.classList.add("field--err");
        return;
      }
      await putBook({
        ...book,
        title,
        author: authorEl.value.trim() || undefined,
        isbn: isbnEl.value.trim() || undefined,
      });
      books = await listBooks();
      renderList();
    };
  }
```

- [ ] **Step 4: CSS — ✎ 버튼**

`src/styles/app.css` 맨 끝에 추가:

```css
.bookrow__edit {
  min-width: 44px;
  min-height: 44px;
  font-size: 16px;
  color: var(--sub);
  border-radius: 12px;
}
.bookrow__edit:active {
  background: var(--surface);
}
```

- [ ] **Step 5: 빌드 + 수동 확인**

Run: `npm run build` → 무에러.
Run: `npm run preview` → 책 목록에서 행 본문 탭 = 기존대로 세션 시작 화면. ✎ 탭 = 책 편집 폼(제목/저자/ISBN). 제목 비우면 저장 막힘. 저장 후 목록에 반영.

- [ ] **Step 6: Commit**

```bash
git add src/screens/books.ts src/styles/app.css
git commit -m "feat: 책 편집(제목·저자·ISBN) + 목록 ✎"
```

---

### Task 6: 세션 편집 (Review 상단 ✎ → 목적)

**Files:**
- Modify: `src/screens/review.ts` (session 객체 보관, 상단 ✎, 목적 편집)
- Modify: `src/styles/app.css` (`.review__editproj`)

**Interfaces:**
- Consumes: `getSession`(이미 import됨), `putSession` from `db.ts`; `Session` from `types.ts`.
- Produces: 세션 `project` 편집.

- [ ] **Step 1: import에 `putSession`·`Session` 추가**

`src/screens/review.ts` 상단 import 보강:

```typescript
import {
  capturesForBook,
  capturesForSession,
  deleteCapture,
  getBook,
  getSession,
  putSession,
} from "../db/db.ts";
import { TAGS, WHY_CHIPS, type Capture, type Session } from "../db/types.ts";
```

- [ ] **Step 2: 세션 객체 보관**

`mountReview` 상단의 `let bookId = ""; let title = "";` 아래에 추가:

```typescript
  let session: Session | null = null;
```

비동기 로더의 session 분기에서 보관(`const s = await getSession(id);` 직후, `bookId = s.bookId;` 옆):

```typescript
      session = s;
```

- [ ] **Step 3: 상단바에 ✎ + 목적 편집 핸들러**

`render()`의 topbar 마크업에 세션 스코프일 때 ✎ 버튼을 추가. topbar 블록을 교체:

```typescript
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">${esc(title)}</div>
        ${scope === "session" ? `<button class="iconbtn review__editproj" aria-label="세션 목적 편집">✎</button>` : ""}
      </div>
```

`render()` 끝부분 이벤트 배선(`const exportBtn = ...` 다음)에 추가:

```typescript
    const editProj = root.querySelector(".review__editproj") as HTMLElement | null;
    if (editProj && session) {
      editProj.onclick = () => {
        const cur = session!.project ?? "";
        const next = prompt("왜 이 책을 읽나요?", cur);
        if (next === null) return;
        const project = next.trim() || undefined;
        session = { ...session!, project };
        putSession(session).then(() => render(caps));
      };
    }
```

(주의: `render(caps)`는 현재 캡처 배열을 다시 그린다 — render는 caps를 인자로 받으므로 클로저의 `caps`를 그대로 넘긴다. `caps`는 render 매개변수이므로 이 핸들러가 정의되는 시점에 접근 가능.)

- [ ] **Step 4: CSS — topbar 우측 정렬 보정**

`src/styles/app.css` 맨 끝에 추가(✎이 오른쪽으로 가도록):

```css
.review__editproj {
  margin-left: auto;
}
```

- [ ] **Step 5: 빌드 + 수동 확인**

Run: `npm run build` → 무에러.
Run: `npm run preview` → 세션 Review 화면 우상단 ✎ 탭 → 목적 입력 프롬프트("왜 이 책을 읽나요?") → 저장하면 헤더/홈/캡처 상단 목적이 갱신됨. 책 전체 Review에는 ✎ 없음.

- [ ] **Step 6: Commit**

```bash
git add src/screens/review.ts src/styles/app.css
git commit -m "feat: 세션 목적 편집(Review 상단 ✎)"
```

---

### Task 7: 가로 모드 (매니페스트 + 카메라/이미지 CSS)

**Files:**
- Modify: `vite.config.ts` (manifest.orientation)
- Modify: `src/styles/app.css` (가로 미디어쿼리, 콘텐츠 max-width)
- Create: `docs/decisions.md`에 ADR 추가(append)

**Interfaces:**
- Consumes: 없음. `lib/image.ts`는 이미 가로 처리(변경 없음).
- Produces: 가로 방향 허용 + 가로 레이아웃.

- [ ] **Step 1: 매니페스트 세로 고정 해제**

`vite.config.ts`의 manifest에서 `orientation: "portrait",`를 교체:

```typescript
        orientation: "any",
```

- [ ] **Step 2: 콘텐츠 max-width (가로에서 안 깨지게)**

`src/styles/app.css`의 `.scr` 규칙에 max-width 중앙정렬을 보강. `.scr` 규칙 끝에 다음 속성 추가(기존 속성 유지):

```css
.scr {
  max-width: 720px;
  margin-inline: auto;
}
```

- [ ] **Step 3: 가로 카메라 + 이미지 미디어쿼리**

`src/styles/app.css` 맨 끝에 추가:

```css
/* --- 가로(landscape) — 카메라+사진 집중 --- */
@media (orientation: landscape) {
  /* 카메라: 다크 풀블리드 유지, 컨트롤을 우측 안전영역으로 */
  .cam__video,
  .cam__freeze {
    object-fit: cover;
  }
  .bottom {
    right: calc(12px + var(--safe-bottom, 0px));
    left: auto;
    bottom: 50%;
    transform: translateY(50%);
    width: auto;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
  }
  .tagrow {
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: 200px;
  }
  /* 상세 사진: 가로 이미지가 잘리지 않게 contain 유지하되 높이 확보 */
  .detail__photo {
    max-height: 70vh;
    aspect-ratio: auto;
    min-height: 200px;
  }
}
```

- [ ] **Step 4: ADR 기록**

`docs/decisions.md` 맨 끝에 추가:

```markdown

## ADR-012: 가로 모드 허용 (세로 고정 해제)

- 맥락: 책 펼침면은 가로로 길어 가로 촬영이 잦다. 기존 매니페스트는 `orientation: "portrait"`로 세로 고정.
- 결정: `orientation: "any"`로 변경해 가로를 허용한다. PWA에서 방향을 풀면 OS가 전 화면을 회전시키므로, 카메라+사진 표시는 가로 레이아웃을 정돈하고 나머지 화면은 콘텐츠 max-width로 "깨지지 않는" 수준까지만 보장한다.
- 영향: 카메라 화면은 여전히 유일한 다크 풀블리드(가로에서도 유지). image.ts는 이미 긴 변 기준이라 변경 없음.
```

- [ ] **Step 5: 빌드 + 수동 확인**

Run: `npm run build` → 무에러. dist/manifest.webmanifest의 orientation이 `any`인지 확인.
Run: `npm run preview` → 브라우저 창을 가로로 넓게(또는 실기기 회전):
- 카메라 화면: 비디오가 가로로 꽉 차고, 태그/셔터/왜-시트에 도달·동작.
- 와이드 책 사진 캡처 후 상세: 사진이 잘리지 않고 보임.
- Home/Review/책/Export: 가로에서 콘텐츠가 과도하게 늘어나지 않고 스크롤로 사용 가능(깨짐 없음).

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts src/styles/app.css docs/decisions.md
git commit -m "feat: 가로 모드 허용 + 카메라/이미지 가로 레이아웃 (ADR-012)"
```

---

## Self-Review

**1. Spec coverage:**
- A 태그 라벨화 → Task 2 ✓
- B 태그 vs 왜 타입 구분 → Task 3(상세: tagpill 알약 vs 윤곽 chip, "왜 저장했나요?" Display) ✓
- C 캡처 상세+편집(①②③) → Task 3 ✓ (페이지는 Task 1 필드 + Task 3 편집)
- D 캡처 중 페이지 → Task 4 ✓
- E 책 편집 + ISBN → Task 5 ✓
- F 세션 편집 → Task 6 ✓
- G 가로 모드 → Task 7 ✓
- 데이터(page/getCapture) → Task 1 ✓
- 마이크로카피 일관성(전역 제약) → Task 3/4/5/6에서 기존 문구 사용 ✓

**2. Placeholder scan:** 모든 코드 단계에 실제 코드 포함. "TODO/나중에" 없음. ✓

**3. Type consistency:**
- `getCapture`(Task1) ↔ Task3 사용 ✓
- `Capture.page?: number`(Task1) ↔ Task3/Task4 `rec.page`/`page` ✓
- `mountDetail(root, nav, captureId, from)`(Task3) ↔ app.ts Route `detail`(Task3) ↔ review.ts nav 호출(Task3) — 인자 순서·타입 일치 ✓
- `from: { scope: Scope; id: string }` ↔ review.ts `{ scope, id }` (mountReview 매개변수명과 일치) ✓
- `putSession`(Task6)·`putBook`(Task5)·`isValidCapture`(Task3) 모두 기존 export ✓

## Execution Handoff

(아래 핸드오프 안내는 스킬 절차에 따라 대화에서 제시한다.)
