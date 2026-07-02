# 책 표지 썸네일 — 알라딘 TTB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 책 편집에서 알라딘으로 표지를 찾아 로컬(IDB)에 저장하고 홈/책장/Review에 표시한다. TTB 키는 설정에서 입력, 백업도 표지를 안전 직렬화. 홈에 "책장 →" 진입점 + 표지 선택 시 ISBN 자동 채움.

**Architecture:** 신규 `lib/aladin.ts`(JSONP 검색 + CORS fetch 표지 — 하드닝 포함). `Book.cover`를 ArrayBuffer로 재타입(ADR-015 정합), backup은 CaptureBackup 패턴 미러링(base64). UI는 books ✎ 편집에 결과 시트, 표시 3곳은 objectURL(+홈/책장에 urls 수명 신설). ADR-017.

**Tech Stack:** Vanilla TS + Vite + idb. JSONP(script 주입), localStorage(`capture.aladinTtbKey`).

## Global Constraints
- 알라딘 검색: `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey={KEY}&Query={enc}&QueryType=Title&SearchTarget=Book&MaxResults=10&Cover=Big&Output=JS&Version=20131101&callback={cb}`.
- **JSONP 하드닝:** done 플래그(이중 호출 방지), 타임아웃(8s) 시 콜백을 delete가 아닌 **no-op 교체**, 모든 경로(성공/에러/타임아웃)에서 script 제거, `encodeURIComponent`, 알라딘 errorCode 응답 감지(무효 키도 HTTP 200).
- 표지 URL: `http→https` 승격, `coversum|cover200→cover500` 치환 + **실패 시 원본 URL 폴백**, 빈/noimg cover 항목 제외.
- 키: `localStorage["capture.aladinTtbKey"]`, `trim()`(빈값=제거), try/catch(사파리 사생활 모드). 키 없으면 표지 검색 UI 미노출 — 앱 정상.
- **표시 가드: `book.cover instanceof ArrayBuffer`일 때만** 렌더. 이미지는 `<img>`+objectURL만(createImageBitmap/decode 금지 — ADR-013).
- **ISBN 자동 채움 규칙(레이스 방지):** 판정은 **표지 선택 시점의 편집 폼 필드 `isbnEl.value.trim()`** 기준 — 비었고 `isbn13`이 truthy면 필드도 채우고 putBook에 포함, 필드에 값 있으면 isbn 불변, isbn13 빈값이면 조용히 스킵.
- 스키마 버전 불변. `Book.isbn` 유지. 마이크로카피 plain("표지 찾기", "책장 →", "알라딘 TTB 키"). 탭타깃 ≥44px.
- 테스트 프레임워크 없음: 각 태스크 = `npm run build` + 커밋(마지막 태스크는 `test:pdf`도).

## File Structure
- T1: `src/db/types.ts`(cover 재타입) + `src/lib/backup.ts`(BookBackup) — 기반·필수 수정
- T2: `src/lib/aladin.ts`(신규) + `src/screens/transfer.ts`(키 설정 섹션, topbar "백업·설정")
- T3: `src/screens/books.ts`(✎ 편집 표지 찾기·ISBN 자동 채움·행 표지 표시·urls 수명) + `src/styles/app.css`
- T4: `src/screens/home.ts`(표지+urls+책장 링크)·`src/screens/review.ts`(hero 표지)·`src/styles/app.css`(.sectit flex)·`docs/decisions.md`(ADR-017)

---

### Task 1: Book.cover 재타입 + backup 직렬화 (필수 수정)

**Files:**
- Modify: `src/db/types.ts`, `src/lib/backup.ts`

**Interfaces:**
- Produces: `Book.cover?: ArrayBuffer | null` + `Book.coverType?: string` (이후 태스크 전제).

- [ ] **Step 1: types.ts**

현재 `Book`의 **미사용** `cover?: Blob`을 재타입(+coverType). `isbn?: string` **유지**:
```typescript
export interface Book {
  uuid: string;
  title: string;
  author?: string;
  isbn?: string;
  cover?: ArrayBuffer | null; // 표지(저장형 ArrayBuffer — ADR-015). instanceof 가드로만 렌더.
  coverType?: string;         // MIME (기본 image/jpeg)
}
```

- [ ] **Step 2: backup.ts — BookBackup (CaptureBackup 패턴 미러)**

현재 books는 raw JSON.stringify → ArrayBuffer가 `{}`로 파손. 수정:
```typescript
interface BookBackup extends Omit<Book, "cover"> { cover: string | null }
// BackupBundle.books: BookBackup[]
```
- export(buildBackup): 각 book을
```typescript
const cover = b.cover instanceof ArrayBuffer
  ? await blobToDataUrl(new Blob([b.cover], { type: b.coverType ?? "image/jpeg" }))
  : null;
books.push({ ...b, cover });
```
- import(importBackup): putBook 전에
```typescript
const cover = bk.cover ? await (await dataUrlToBlob(bk.cover)).arrayBuffer() : undefined;
await putBook({ ...bk, cover });
```
(기존 `blobToDataUrl`/`dataUrlToBlob` 재사용. `version: 1` 유지 — 구 번들의 cover 없는 book도 통과. 실제 함수/타입명은 현 backup.ts에 맞춤.)

- [ ] **Step 3: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/db/types.ts src/lib/backup.ts
git commit -m "feat: Book.cover ArrayBuffer 재타입 + 백업 base64 직렬화(파손 방지)"
```

---

### Task 2: aladin.ts + 키 설정

**Files:**
- Create: `src/lib/aladin.ts`
- Modify: `src/screens/transfer.ts`, `src/styles/app.css`

**Interfaces:**
- Produces: `getTtbKey(): string | null`, `setTtbKey(k: string): void`, `interface AladinItem { title: string; author: string; cover: string; isbn13: string; publisher: string }`, `searchBooks(query: string): Promise<AladinItem[]>`, `fetchCover(coverUrl: string): Promise<{ buf: ArrayBuffer; type: string }>`.

- [ ] **Step 1: `src/lib/aladin.ts` 작성**

```typescript
/** 알라딘 TTB — JSONP 검색 + CORS fetch 표지. ADR-017. 키는 사용자 입력(localStorage). */

const LS_KEY = "capture.aladinTtbKey";

export function getTtbKey(): string | null {
  try {
    const k = localStorage.getItem(LS_KEY)?.trim();
    return k ? k : null;
  } catch { return null; }
}
export function setTtbKey(k: string): void {
  try {
    const t = k.trim();
    if (t) localStorage.setItem(LS_KEY, t);
    else localStorage.removeItem(LS_KEY);
  } catch { /* 사생활 모드 무시 */ }
}

export interface AladinItem { title: string; author: string; cover: string; isbn13: string; publisher: string }

let cbSeq = 0;

/** JSONP 검색. 키 없으면 throw. errorCode 응답·타임아웃(8s)·로드 실패 시 reject. */
export function searchBooks(query: string): Promise<AladinItem[]> {
  const key = getTtbKey();
  if (!key) return Promise.reject(new Error("no-key"));
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const cbName = `__aladinCb_${++cbSeq}`;
    const w = window as unknown as Record<string, unknown>;
    let done = false;
    const script = document.createElement("script");
    const cleanup = () => { script.remove(); w[cbName] = () => {}; }; // delete 금지 — 늦은 응답 ReferenceError 방지
    const timer = setTimeout(() => {
      if (done) return; done = true; cleanup(); reject(new Error("timeout"));
    }, 8000);
    w[cbName] = (data: { errorCode?: number; errorMessage?: string; item?: unknown[] }) => {
      if (done) return; done = true; clearTimeout(timer); cleanup();
      if (data?.errorCode) { reject(new Error(`aladin:${data.errorCode}`)); return; }
      const items = (Array.isArray(data?.item) ? data.item : []) as Record<string, string>[];
      resolve(
        items
          .filter((it) => it.cover && !it.cover.includes("noimg"))
          .map((it) => ({
            title: it.title ?? "", author: it.author ?? "",
            cover: it.cover, isbn13: it.isbn13 ?? "", publisher: it.publisher ?? "",
          })),
      );
    };
    script.onerror = () => {
      if (done) return; done = true; clearTimeout(timer); cleanup(); reject(new Error("load-failed"));
    };
    script.src =
      `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${encodeURIComponent(key)}` +
      `&Query=${encodeURIComponent(q)}&QueryType=Title&SearchTarget=Book&MaxResults=10` +
      `&Cover=Big&Output=JS&Version=20131101&callback=${cbName}`;
    document.head.appendChild(script);
  });
}

/** 표지 다운로드 — https 승격 + cover500 치환(실패 시 원본 폴백). CDN이 CORS 허용(실측). */
export async function fetchCover(coverUrl: string): Promise<{ buf: ArrayBuffer; type: string }> {
  const https = coverUrl.replace(/^http:/, "https:");
  const hi = https.replace(/\/(coversum|cover200|cover)\//, "/cover500/");
  for (const url of hi !== https ? [hi, https] : [https]) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const blob = await r.blob();
      return { buf: await blob.arrayBuffer(), type: blob.type || "image/jpeg" };
    } catch { /* 다음 후보 */ }
  }
  throw new Error("cover-fetch-failed");
}
```

- [ ] **Step 2: transfer.ts 설정 섹션**

현 transfer.ts 구조(innerHTML 카드들)를 읽고, 하단에 카드 추가 + topbar 문구 "백업·가져오기"→**"백업·설정"**(홈 버튼 문구 `home.ts`의 "백업·가져오기"도 동일하게):
```html
<div class="card">
  <div class="card__h">알라딘 TTB 키</div>
  <div class="setting__s">표지 검색에 사용해요. aladin.co.kr에서 무료 발급.</div>
  <input class="field ttbkey" placeholder="TTB 키" autocomplete="off" value="${esc(getTtbKey() ?? "")}" />
  <button class="btn-ghost savekey">저장</button>
</div>
```
배선: `savekey` 클릭 → `setTtbKey(input.value)` → flash(키 저장/제거됨). CSS `.setting__s { color: var(--sub); font-size: 13px; margin-bottom: 10px; }`(기존 톤 재사용 가능하면 재사용).

- [ ] **Step 3: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/lib/aladin.ts src/screens/transfer.ts src/screens/home.ts src/styles/app.css
git commit -m "feat: 알라딘 TTB 모듈(JSONP 하드닝) + 설정에 키 입력"
```

---

### Task 3: books ✎ 편집 표지 찾기 + ISBN 자동 채움 + 책장 표지 표시

**Files:**
- Modify: `src/screens/books.ts`, `src/styles/app.css`

**Interfaces:**
- Consumes: `searchBooks`/`fetchCover`/`getTtbKey`/`AladinItem`(T2), `Book.cover/coverType`(T1), 기존 `putBook`.

구현자는 **현 books.ts를 먼저 읽고**(renderEdit 폼 `.e-title/.e-author/.e-isbn`+저장 핸들러, renderList/bookRow/`.mini`, urls 부재, cleanup `()=>{}`) 적용한다.

- [ ] **Step 1: objectURL 수명 신설**

`mountBooks` 스코프에 `const urls: string[] = [];`. `renderList()` **시작에** `urls.forEach((u) => URL.revokeObjectURL(u)); urls.length = 0;`(add/edit/del 재렌더마다). cleanup을 `() => { urls.forEach((u) => URL.revokeObjectURL(u)); }`로.

- [ ] **Step 2: 행 표지 표시**

`bookRow`의 `.mini` 박스: `b.cover instanceof ArrayBuffer`면
```typescript
const u = URL.createObjectURL(new Blob([b.cover], { type: b.coverType ?? "image/jpeg" }));
urls.push(u);
// `<img class="mini mini--img" src="${u}" alt="" />` (아니면 기존 `<div class="mini ...">`)
```
CSS: `.mini--img { object-fit: cover; }`(기존 .mini 크기/radius 상속 확인 — img 태그라 필요 시 width/height 명시).

- [ ] **Step 3: ✎ 편집에 "표지 찾기"**

`renderEdit(book)` 폼의 isbn 필드 아래에(키 있을 때만):
```typescript
${getTtbKey() ? `<button class="btn-ghost coverfind">표지 찾기</button><div class="coverres"></div>` : ""}
```
배선:
```typescript
const findBtn = root.querySelector(".coverfind") as HTMLButtonElement | null;
if (findBtn) findBtn.onclick = async () => {
  const q = (root.querySelector(".e-title") as HTMLInputElement).value.trim() || book.title;
  findBtn.disabled = true; findBtn.textContent = "검색 중…";
  try {
    const items = await searchBooks(q);
    renderCoverResults(items);
  } catch (e) {
    flash(String(e).includes("aladin:") ? "키를 확인해주세요" : "표지를 찾지 못했어요");
  } finally { findBtn.disabled = false; findBtn.textContent = "표지 찾기"; }
};

function renderCoverResults(items: AladinItem[]) {
  const box = root.querySelector(".coverres") as HTMLElement;
  if (!items.length) { box.innerHTML = `<div class="hint-empty">결과가 없어요</div>`; return; }
  box.innerHTML = items.map((it, i) => `
    <button class="coveropt" data-i="${i}">
      <img src="${it.cover}" alt="" loading="lazy" />
      <span class="coveropt__t">${esc(it.title)}</span>
      <span class="coveropt__a">${esc(it.author)}</span>
    </button>`).join("");
  box.querySelectorAll<HTMLButtonElement>(".coveropt").forEach((el) => {
    el.onclick = async () => {
      const it = items[Number(el.dataset.i)];
      try {
        const { buf, type } = await fetchCover(it.cover);
        const isbnEl = root.querySelector(".e-isbn") as HTMLInputElement;
        // ISBN 자동 채움: 폼 필드 기준(레이스 방지), isbn13 빈값 스킵
        const fillIsbn = !isbnEl.value.trim() && it.isbn13 ? it.isbn13 : null;
        if (fillIsbn) isbnEl.value = fillIsbn;
        await putBook({ ...book, cover: buf, coverType: type, ...(fillIsbn ? { isbn: fillIsbn } : {}) });
        book.cover = buf; book.coverType = type; if (fillIsbn) book.isbn = fillIsbn;
        flash("표지를 저장했어요");
        box.innerHTML = "";
      } catch { flash("표지를 가져오지 못했어요"); /* 시트 유지 — 재시도 */ }
    };
  });
}
```
(결과 시트 `<img>`는 원격 핫링크 — objectURL 아님, revoke 불필요. 화면 이탈 중 늦은 응답: 핸들러가 `root.querySelector` null이면 조용히 무시되도록 가드하거나 done 후 무해 — 확인.)

- [ ] **Step 4: CSS**

```css
.coverres { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.coveropt { display: flex; align-items: center; gap: 12px; min-height: 56px; background: var(--surface); border: none; border-radius: 12px; padding: 8px 12px; text-align: left; cursor: pointer; }
.coveropt img { width: 38px; height: 50px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
.coveropt__t { font-size: 14px; font-weight: 600; color: var(--ink); }
.coveropt__a { font-size: 12px; color: var(--sub); margin-left: auto; flex-shrink: 0; }
```

- [ ] **Step 5: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/screens/books.ts src/styles/app.css
git commit -m "feat: 책 편집에 표지 찾기(알라딘)·ISBN 자동 채움 + 책장 표지 표시"
```

---

### Task 4: 홈/Review 표지 표시 + 책장 링크 + ADR-017

**Files:**
- Modify: `src/screens/home.ts`, `src/screens/review.ts`, `src/styles/app.css`, `docs/decisions.md`

**Interfaces:**
- Consumes: `Book.cover/coverType`(T1). review는 `getBook` 결과 보관 필요.

- [ ] **Step 1: home.ts — urls + 표지 + 책장 링크**

- `mountHome`에 `const urls: string[] = [];`, `render()` 시작에 revoke+clear, cleanup(`return () => {...}`)에서 revoke.
- `topCard`의 `.cover`/`bookItem`의 `.mini`: `v.book.cover instanceof ArrayBuffer`면 objectURL `<img class="cover cover--img">`/`<img class="mini mini--img">`(아니면 기존 이니셜/그라데 박스). CSS `.cover--img, .mini--img { object-fit: cover; padding: 0; }`(크기·radius는 기존 클래스 상속 — img 특성상 필요 시 명시).
- "다른 책" 섹션 타이틀: `<div class="sectit">다른 책 <button class="home__books-link">책장 →</button></div>`; 전용 배선 `(root.querySelector(".home__books-link") as HTMLButtonElement | null)?.onclick = ... nav({name:"books"})`(위임 아님 — Adj-2). rest 없으면 섹션 자체 미표시(기존 구조 유지).
- CSS(Adj-1): `.sectit { display: flex; justify-content: space-between; align-items: center; ... }`(기존 폰트/마진 유지, books.ts 단독 자식 무해). `.home__books-link { background: none; border: none; color: var(--sub); font-size: 13px; font-weight: 600; min-height: 44px; cursor: pointer; }`

- [ ] **Step 2: review.ts — hero 표지**

`scope==="book"`/`"session"` 로드에서 `getBook` 결과를 `let book: Book | null`로 보관(현재 title만 쓰고 버림). `render()`의 hero에 `book?.cover instanceof ArrayBuffer`면 작은 표지 `<img class="hero__cover">`(objectURL — 기존 `urls` 사이클에 push, 기존 revoke 규율 그대로). CSS `.hero__cover { width: 48px; height: 64px; object-fit: cover; border-radius: 8px; }`(hero 레이아웃에 맞게 — 구현자가 현 hero 구조 보고 배치).

- [ ] **Step 3: ADR-017**

`docs/decisions.md`에 ADR-016 뒤 동일 형식으로: 외부 API 예외(알라딘 TTB) — 근거(실측: JSONP 동작·이미지 CDN `ACAO:*`, 대안 전멸: 카카오 저장불가/네이버 CORS없음/구글 무키 429/OpenLibrary 한국서 없음), 키=사용자 입력(공개 리포 비커밋, `capture.aladinTtbKey`), 표지 1회 수신 후 IDB 저장(오프라인·의존 제거), JSONP 신뢰 트레이드오프. **ADR-006과 PRD §19의 "외부 API 없음" 원칙을 함께 개정**함을 명시.

- [ ] **Step 4: 빌드 + 스모크 + Commit**

Run: `npm run build` → 무에러. `npm run test:pdf` → PASS.
```bash
git add -A
git commit -m "feat: 홈/Review 표지 표시 + 책장 진입점 + ADR-017"
```

---

## Self-Review
**1. Spec coverage:** cover 재타입+isbn 유지+backup 직렬화(필수) → T1; aladin.ts 하드닝 전항목+키 설정+topbar 문구 → T2; ✎ 표지 찾기+ISBN 폼기준 자동채움+isbn13 스킵+책장 표지+books urls → T3; 홈 표지+urls+책장 링크(sectit flex·전용 배선)+review hero(Book 보관)+ADR-017(PRD §19 포함) → T4. 델타검토 Adj-1~4 포함 ✓.
**2. Placeholder scan:** 전 태스크 구체 코드. "현 파일 먼저 읽기"는 정합용. ✓
**3. Type consistency:** `AladinItem`/`searchBooks`/`fetchCover`/`getTtbKey`(T2 정의) ↔ T3 사용 일치; `Book.cover: ArrayBuffer|null`(T1) ↔ T3/T4 instanceof 가드 일치. ✓

## 참고
- 순서: T1 → T2 → T3 → T4 (같은 워크트리 순차).
- preview 검증: 키 저장 → 편집에서 표지 찾기 → 선택 → 책장/홈/Review 표시 → 백업→가져오기 라운드트립에 표지 유지 → 오프라인 표시 유지. 실기기(iOS): JSONP·fetch·표시.
- 표지 검색은 키 입력자만 — 키 없어도 앱 전 기능 정상.
