# 데이터 이식: JSON 백업 + 가져오기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전체 데이터를 단일 .json으로 백업하고, 다른 기기에서 가져오기로 책·세션·캡처를 uuid upsert로 완전 복원한다.

**Architecture:** `src/lib/backup.ts`가 직렬화/역직렬화를 담당(이미지 Blob↔base64 dataURL). 새 화면 `src/screens/transfer.ts`(라우트 `transfer`, Home 진입)가 백업 다운로드 + 파일 선택 가져오기 UI를 제공. 복원은 기존 put 함수 재사용.

**Tech Stack:** Vanilla TS + Vite + idb. FileReader/fetch(dataURL)로 Blob 변환. 기존 `lib/share.ts`의 `downloadFile` 재사용.

## Testing approach (이 저장소 적응)

테스트 프레임워크 없음. 각 태스크 검증 = `npm run build`(tsc) + `npm run preview` 수동 + 커밋.

## Global Constraints

- 마이크로카피 plain·sentence case: "백업 파일 내려받기", "백업 파일 선택", "…복원했어요", 에러는 사과 없이 안내("백업 파일을 읽지 못했어요").
- 색/모양: 밝은 토스-클린, 카드형. 주 동작 `.btn-primary`, 보조 `.btn-ghost`. 탭타깃 ≥48px.
- 복원은 **uuid 기준 put(upsert)** — 같은 파일 재가져오기 시 중복 금지.
- 검증 실패(버전/구조)면 **아무것도 들이지 않음**(파싱 단계 중단).
- 새 db 트랜잭션 함수 없이 기존 `putBook`/`putSession`/`updateCapture` 루프 재사용.

---

### Task 1: `src/db/db.ts` — 전체 조회 함수 2개

**Files:**
- Modify: `src/db/db.ts`

**Interfaces:**
- Produces: `allSessions(): Promise<Session[]>`, `allCaptures(): Promise<Capture[]>`. (books는 기존 `listBooks()` 재사용.)

- [ ] **Step 1: 두 함수 추가**

`src/db/db.ts`의 `listBooks` 근처(목록 섹션)에 추가:

```typescript
export async function allSessions(): Promise<Session[]> {
  return (await db()).getAll("sessions");
}
export async function allCaptures(): Promise<Capture[]> {
  return (await db()).getAll("captures");
}
```

- [ ] **Step 2: 빌드**

Run: `npm run build`
Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/db/db.ts
git commit -m "feat: allSessions/allCaptures 전체 조회 추가"
```

---

### Task 2: `src/lib/backup.ts` — 직렬화/역직렬화

**Files:**
- Create: `src/lib/backup.ts`

**Interfaces:**
- Consumes: `listBooks`,`allSessions`,`allCaptures`,`putBook`,`putSession`,`updateCapture` from `../db/db.ts`(Task 1); `Book`,`Session`,`Capture` from `../db/types.ts`.
- Produces: `buildBackup(now: number): Promise<Blob>`; `importBackup(text: string): Promise<ImportResult>`; `interface ImportResult { books: number; sessions: number; captures: number }`.

- [ ] **Step 1: `src/lib/backup.ts` 작성**

```typescript
/** 전체 데이터 백업/복원 — 단일 JSON. 이미지 Blob↔base64 dataURL. uuid upsert 복원. */
import {
  allCaptures,
  allSessions,
  listBooks,
  putBook,
  putSession,
  updateCapture,
} from "../db/db.ts";
import type { Book, Capture, Session } from "../db/types.ts";

interface CaptureBackup extends Omit<Capture, "image"> {
  image: string | null; // dataURL 또는 null
}
interface BackupBundle {
  version: 1;
  exportedAt: number;
  books: Book[];
  sessions: Session[];
  captures: CaptureBackup[];
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}
async function dataUrlToBlob(u: string): Promise<Blob> {
  return (await fetch(u)).blob();
}

export async function buildBackup(now: number): Promise<Blob> {
  const [books, sessions, caps] = await Promise.all([listBooks(), allSessions(), allCaptures()]);
  const captures: CaptureBackup[] = [];
  for (const c of caps) {
    const { image, ...rest } = c;
    captures.push({ ...rest, image: image ? await blobToDataUrl(image) : null });
  }
  const bundle: BackupBundle = { version: 1, exportedAt: now, books, sessions, captures };
  return new Blob([JSON.stringify(bundle)], { type: "application/json" });
}

export interface ImportResult {
  books: number;
  sessions: number;
  captures: number;
}

export async function importBackup(text: string): Promise<ImportResult> {
  const b = JSON.parse(text) as BackupBundle;
  if (
    b.version !== 1 ||
    !Array.isArray(b.books) ||
    !Array.isArray(b.sessions) ||
    !Array.isArray(b.captures)
  ) {
    throw new Error("unsupported backup");
  }
  for (const bk of b.books) await putBook(bk);
  for (const s of b.sessions) await putSession(s);
  for (const c of b.captures) {
    const { image, ...rest } = c;
    const cap: Capture = { ...(rest as Omit<Capture, "image">), image: image ? await dataUrlToBlob(image) : null };
    await updateCapture(cap);
  }
  return { books: b.books.length, sessions: b.sessions.length, captures: b.captures.length };
}
```

- [ ] **Step 2: 빌드**

Run: `npm run build`
Expected: 에러 없음(타입 일치).

- [ ] **Step 3: Commit**

```bash
git add src/lib/backup.ts
git commit -m "feat: 백업 직렬화/역직렬화(이미지 base64, uuid upsert)"
```

---

### Task 3: `transfer` 화면 + 라우트 + Home 진입점

**Files:**
- Create: `src/screens/transfer.ts`
- Modify: `src/app.ts` (Route + import + switch)
- Modify: `src/screens/home.ts` (진입 버튼)
- Modify: `src/styles/app.css` (transfer/home 진입 스타일)

**Interfaces:**
- Consumes: `buildBackup`,`importBackup`,`ImportResult` from `../lib/backup.ts`(Task 2); `downloadFile` from `../lib/share.ts`; `Nav` from `../app.ts`.
- Produces: `mountTransfer(root: HTMLElement, nav: Nav): () => void`; Route `{ name: "transfer" }`.

- [ ] **Step 1: 라우트 추가 (`src/app.ts`)**

import에 추가: `import { mountTransfer } from "./screens/transfer.ts";`
Route 유니온에 추가:
```typescript
  | { name: "detail"; captureId: string; from: { scope: Scope; id: string } }
  | { name: "transfer" };
```
switch에 추가:
```typescript
      case "transfer":
        cleanup = mountTransfer(root, nav);
        break;
```

- [ ] **Step 2: `src/screens/transfer.ts` 작성**

```typescript
/** 백업·가져오기 — 전체 데이터를 단일 JSON으로 내보내고/복원. */
import type { Nav } from "../app.ts";
import { buildBackup, importBackup } from "../lib/backup.ts";
import { downloadFile } from "../lib/share.ts";

export function mountTransfer(root: HTMLElement, nav: Nav): () => void {
  root.innerHTML = `
  <div class="scr scr--light transfer">
    <div class="topbar">
      <button class="iconbtn back">‹</button>
      <div class="topbar__t">백업·가져오기</div>
    </div>

    <div class="card">
      <div class="card__h">백업</div>
      <div class="exp__how">모든 책·세션·캡처(사진 포함)를 파일 하나로 내려받아요. 다른 기기에서 가져오기로 복원할 수 있어요.</div>
      <button class="btn-primary backup">💾 백업 파일 내려받기</button>
    </div>

    <div class="card">
      <div class="card__h">가져오기</div>
      <div class="exp__how">백업 파일(.json)을 선택하면 이 기기에 복원해요. 같은 항목은 덮어써요(중복 안 생김).</div>
      <input class="t-file" type="file" accept="application/json,.json" hidden />
      <button class="btn-ghost pick">📥 백업 파일 선택</button>
    </div>

    <div class="toast" hidden></div>
  </div>`;

  const toast = root.querySelector(".toast") as HTMLElement;
  const flash = (msg: string) => {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => (toast.hidden = true), 2400);
  };

  (root.querySelector(".back") as HTMLElement).onclick = () => nav({ name: "home" });

  (root.querySelector(".backup") as HTMLButtonElement).onclick = async () => {
    try {
      const blob = await buildBackup(Date.now());
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const name = `capture-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
      downloadFile({ name, blob });
      flash("백업 파일을 내려받았어요");
    } catch (e) {
      console.error("backup failed", e);
      flash("백업에 실패했어요");
    }
  };

  const file = root.querySelector(".t-file") as HTMLInputElement;
  (root.querySelector(".pick") as HTMLButtonElement).onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const r = await importBackup(text);
      flash(`책 ${r.books} · 세션 ${r.sessions} · 캡처 ${r.captures} 복원했어요`);
    } catch (e) {
      console.error("import failed", e);
      flash("백업 파일을 읽지 못했어요(형식 확인)");
    } finally {
      file.value = "";
    }
  };

  return () => {};
}
```

- [ ] **Step 3: Home 진입점 (`src/screens/home.ts`)**

`render()`의 최상위 `.home` div 안, 닫는 `</div>` 직전(최근 세션 블록 다음)에 진입 버튼 추가:

```typescript
      <button class="home__transfer">백업·가져오기</button>
```

그리고 이벤트 배선(`startBtn.onclick` 근처)에 추가:

```typescript
    (root.querySelector(".home__transfer") as HTMLButtonElement).onclick = () =>
      nav({ name: "transfer" });
```

- [ ] **Step 4: CSS (`src/styles/app.css` 맨 끝)**

```css
.home__transfer {
  display: block;
  margin: 28px auto 8px;
  padding: 10px 16px;
  min-height: 48px;
  color: var(--sub);
  font-size: 14px;
  font-weight: 600;
}
.home__transfer:active {
  color: var(--ink);
}
.transfer .card {
  margin-bottom: 16px;
}
.transfer .btn-primary,
.transfer .pick {
  width: 100%;
  margin-top: 12px;
}
```

- [ ] **Step 5: 빌드 + 수동 확인**

Run: `npm run build` → 무에러.
Run: `npm run preview`:
- 책·세션·캡처(사진 포함) 만든 뒤 Home 하단 "백업·가져오기" → transfer 화면.
- "백업 파일 내려받기" → .json 다운로드. 파일 열어 books/sessions/captures + image dataURL 확인.
- DevTools에서 IndexedDB(capture) 삭제 → 새로고침(빈 상태) → 가져오기 → 같은 .json 선택 → "책 N · 세션 N · 캡처 N 복원했어요" → 홈/Review에 데이터·사진 복원 확인.
- 같은 파일 두 번 가져오기 → 중복 없음(카운트 동일).
- 잘못된 파일(아무 텍스트 .json) → "백업 파일을 읽지 못했어요" + 데이터 무변경.

- [ ] **Step 6: Commit**

```bash
git add src/screens/transfer.ts src/app.ts src/screens/home.ts src/styles/app.css
git commit -m "feat: 백업·가져오기 화면 + Home 진입 + transfer 라우트"
```

---

## Self-Review

**1. Spec coverage:** 전체 조회 → Task1 ✓; JSON 스키마/직렬화/upsert 복원 → Task2 ✓; transfer 화면/백업 다운로드/파일 선택 가져오기/진입점(Home)/라우트 → Task3 ✓; uuid upsert·검증실패시 무변경 → Task2 ✓.
**2. Placeholder scan:** 모든 코드 단계 실제 코드 포함. ✓
**3. Type consistency:** `allSessions/allCaptures`(Task1) ↔ backup.ts(Task2) 일치 ✓; `buildBackup(now)`/`importBackup(text)`/`ImportResult`(Task2) ↔ transfer.ts(Task3) 일치 ✓; `mountTransfer(root,nav)`(Task3) ↔ app.ts route/switch ✓; `downloadFile({name,blob})`는 기존 share.ts `ShareFile` 형태와 일치 ✓.

## 참고
- `.exp__how`/`.toast`/`.card`/`.btn-primary`/`.btn-ghost`/`.topbar`/`.iconbtn`는 기존 CSS 재사용.
- `updateCapture`는 put(upsert)이라 복원에 적합.
