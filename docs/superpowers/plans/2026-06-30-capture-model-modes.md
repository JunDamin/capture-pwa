# 캡처 입력 모델·모드 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** passage(책 글)와 note를 분리하고(유효성=image||passage), why 칩을 note로 흡수하며, 캡처를 사진/입력 모드로 나눠 책 선택·캡처에서 토글한다.

**Architecture:** 빌드가 매 태스크 통과하도록 **추가(passage·유효성) → 소비자 이전(prompt/pdf/detail/review/capture) → 정리(WHY_CHIPS 제거·문서)** 순서. `why` 필드는 레거시 읽기용으로 deprecated 보존(비파괴), 표시·Export에서 note에 합친다.

**Tech Stack:** Vanilla TS + Vite + idb. 기존 디자인 언어(입력은 라이트, 카메라만 다크).

## Testing approach (이 저장소 적응)

테스트 프레임워크 없음. 각 태스크 = `npm run build`(tsc) + `npm run preview` 수동 + 커밋. iOS는 실기기.

## Global Constraints

- 유효성: 내용 = image 또는 passage(레거시 memo 호환) + tag.
- 마이크로카피 일관: "담고 싶은 글", "내 생각(선택)", "저장", "한 가지 태그를 고르세요". why 문구 제거.
- `why`는 신규 미설정, 타입에 deprecated 보존(레거시 읽기). 표시/Export는 레거시 why를 note에 합침.
- 색/모양: 입력 모드=밝은 토스-클린, 카메라만 다크. 탭타깃 ≥48px. 3초 루프(사진 모드) 유지.
- ADR-007 "글감 후보" 사전분류 제거(사용자 합의). ADR-009 prompt 갱신.

---

### Task 1: 모델 — `passage` 추가 + 유효성 변경 (`src/db/types.ts`)

**Files:** Modify `src/db/types.ts`
**Interfaces:** Produces `Capture.passage: string | null`; `isValidCapture(Pick<Capture,"image"|"passage"|"memo"|"tag">)`.

- [ ] **Step 1: Capture에 passage 추가 + memo 의미 주석 + why deprecated 표기**

`Capture` 인터페이스에서 `memo`/`why` 부분을 교체:
```typescript
  image: Blob | null; // ADR-001/003
  imageW?: number;
  imageH?: number;
  passage: string | null; // 책에서 담고 싶은 글/인용 — image와 함께 "내용" (ADR-014)
  memo: string | null; // note: 내 생각·주석 (why 흡수)
  tag: Tag; // 필수, 단일 — ADR-002/004
  why?: string | null; // @deprecated 레거시 읽기 전용 — note로 합쳐 표시 (ADR-014)
  ocr: string | null;
```

- [ ] **Step 2: isValidCapture 갱신**

```typescript
/** 유효성 — ADR-014: (image 또는 passage) + tag. memo는 레거시 호환. */
export function isValidCapture(c: Pick<Capture, "image" | "passage" | "memo" | "tag">): boolean {
  const hasContent =
    c.image != null ||
    (c.passage != null && c.passage.trim() !== "") ||
    (c.memo != null && c.memo.trim() !== "");
  return hasContent && !!c.tag;
}
```

(WHY_CHIPS 상수는 이 태스크에선 **유지** — 소비자들이 아직 import 중. Task 7에서 제거.)

- [ ] **Step 3: 빌드** — `npm run build` 무에러(추가 변경이라 통과).
- [ ] **Step 4: Commit** — `git add src/db/types.ts && git commit -m "feat: Capture.passage 추가 + 유효성 image||passage (ADR-014)"`

---

### Task 2: AI 프롬프트 — passage+note 출력, why/글감분류 제거 (`src/lib/prompt.ts`)

**Files:** Modify `src/lib/prompt.ts`
**Interfaces:** Consumes `Capture.passage`(Task1). Produces 동일 `buildExport` 시그니처.

- [ ] **Step 1: 캡처 블록에 passage+note, 레거시 why 합치기**

`blocks` 생성부의 `lines` 배열(왜/메모 부분)을 교체:
```typescript
    const note = [c.memo, c.why].filter((s) => s && s.trim()).join(" · ") || null; // 레거시 why 합치기
    const lines = [
      `### capture-${pad(i)} · ${tag.emoji} ${tag.label} · ${fmtTime(c.createdAt)}${c.page ? ` · p.${c.page}` : ""}`,
    ];
    if (c.passage && c.passage.trim()) lines.push(`- 담은 글: ${c.passage.trim()}`);
    if (note) lines.push(`- 내 생각: ${note}`);
    lines.push(`- 사진: ${imgLine}`);
    return lines.join("\n");
```

- [ ] **Step 2: 규칙 기반 사전분류에서 why 제거**

`writingCandidates`/`noWhy` 라인과 그 사용을 삭제하고, 사전분류 섹션을 태그 분포 + "내용 없는 항목" 정도로 축소. `md` 템플릿의 "## 규칙 기반 사전 분류" 블록을 교체:
```typescript
  const md = `# 독서 캡처 — ${ctx.bookTitle}${author}

- 범위: ${ctx.scopeLabel}${project}
- 캡처 수: ${captures.length}
- 템플릿: capture-prompt ${PROMPT_TEMPLATE_VERSION}

## 너에게 (지시)

나는 책을 읽으며 떠오른 생각을 빠르게 캡처했다. 각 캡처에는 **태그**, 책에서 **담은 글(passage)**, **내 생각(note)**, 그리고 첨부 사진이 있을 수 있다.
첨부 사진은 책 페이지다. **각 사진을 OCR**해 파일명 번호(\`capture-NN\`)로 아래 항목과 연결하라. 그런 다음 아래를 만들어라:

1. **주요 주제** 2. **반복/강조** 3. **캡처 간 관계(연결·충돌)** 4. **글감 후보** 5. **인터뷰 질문** 6. **독서노트 초안**

## 태그 범례

${TAGS.map((t) => `- ${t.emoji} ${t.label}`).join("\n")}

## 캡처 (${captures.length}개)

${blocks.join("\n\n")}

## 참고 — 태그 분포

${tagDist || "(없음)"}
`;
```
(즉 `writingCandidates`/`noWhy`/`idxList` 중 why 의존 부분 삭제. `tagDist`는 유지.)

- [ ] **Step 3: 빌드** — `npm run build` 무에러.
- [ ] **Step 4: Commit** — `git add src/lib/prompt.ts && git commit -m "feat: Export 프롬프트 passage+note, why/글감분류 제거 (ADR-009/007)"`

---

### Task 3: PDF 캡션 — passage/note (`src/lib/pdf.ts`)

**Files:** Modify `src/lib/pdf.ts`
**Interfaces:** Consumes `Capture.passage`.

- [ ] **Step 1: 사진 페이지 캡션의 `왜:` 블록 교체**

`pdf.ts`에서 `왜: ${cap.why ...}` 렌더 부분(메모 렌더 포함)을 passage+note로 교체:
```typescript
    p.g.fillStyle = INK;
    const note = [cap.memo, cap.why].filter((s) => s && s.trim()).join(" · ");
    if (cap.passage && cap.passage.trim()) {
      for (const ln of wrap(p.g, `담은 글: ${cap.passage.trim()}`, W - M * 2)) {
        p.g.fillText(ln, M, cy);
        cy += 36;
      }
    }
    if (note) {
      for (const ln of wrap(p.g, `내 생각: ${note}`, W - M * 2)) {
        p.g.fillText(ln, M, cy);
        cy += 36;
      }
    }
```
(기존 `왜: ...` for문과 `if (cap.memo) { 메모: ... }` for문을 위 블록으로 대체.)

- [ ] **Step 2: 빌드** — 무에러.
- [ ] **Step 3: Commit** — `git add src/lib/pdf.ts && git commit -m "feat: PDF 캡션 passage/note"`

---

### Task 4: 상세 편집 — passage/note 필드, why UI 제거 (`src/screens/detail.ts`)

**Files:** Modify `src/screens/detail.ts`
**Interfaces:** Consumes types(Task1). 기존 `updateCapture`.

- [ ] **Step 1: import에서 WHY_CHIPS 제거**

`import { TAGS, isValidCapture, type Capture, type Tag } from "../db/types.ts";` (WHY_CHIPS 삭제)

- [ ] **Step 2: why 칩 편집 UI → passage + note 입력으로 교체**

`render(cap)` 안에서:
- `let why`/`freeMode`/`whyChips` 관련 상태·마크업 제거.
- "왜 저장했나요?" 카드(칩+free textarea)를 **담은 글(passage) 카드 + 내 생각(note) 카드**로 교체:
```typescript
      <div class="card">
        <div class="card__h">담은 글</div>
        <textarea class="field detail__passage" rows="3" placeholder="책에서 담고 싶은 글 (선택)">${esc(cap.passage ?? "")}</textarea>
      </div>
      <div class="card">
        <div class="card__h">내 생각</div>
        <textarea class="field detail__memo" rows="3" placeholder="내 생각·메모 (선택)">${esc([cap.memo, cap.why].filter((s)=>s&&s.trim()).join(" · "))}</textarea>
      </div>
```
- 핸들 참조: `const passageEl = root.querySelector(".detail__passage")`; 기존 `memo` textarea 그대로.
- 칩/free/writeChip 이벤트 배선 제거.

- [ ] **Step 3: 저장 시 passage/memo 기록(why 미설정, 레거시 why 비움)**

`.save` 핸들러 교체:
```typescript
    (root.querySelector(".save") as HTMLButtonElement).onclick = async () => {
      const passageVal = passageEl.value.trim() || null;
      const memoVal = memo.value.trim() || null;
      const n = parseInt(pageEl.value, 10);
      const page = Number.isFinite(n) && n > 0 ? n : undefined;
      if (!isValidCapture({ image: cap.image, passage: passageVal, memo: memoVal, tag })) {
        alert("담고 싶은 글이나 사진이 필요해요.");
        return;
      }
      await updateCapture({ ...cap, tag, passage: passageVal, memo: memoVal, why: null, page, updatedAt: Date.now() });
      back();
    };
```
(태그 선택 로직은 유지. `freeMode`/`why` 변수 제거에 맞춰 정리.)

- [ ] **Step 4: 빌드 + 수동 확인** — `npm run build` 무에러. preview: 상세에 담은 글/내 생각 편집·저장; 레거시 캡처의 why가 내 생각에 합쳐 보임.
- [ ] **Step 5: Commit** — `git add src/screens/detail.ts && git commit -m "feat: 상세 passage/note 편집, why UI 제거"`

---

### Task 5: Review — why 통계 제거, passage/note 반영 (`src/screens/review.ts`)

**Files:** Modify `src/screens/review.ts`
**Interfaces:** Consumes types(Task1).

- [ ] **Step 1: import에서 WHY_CHIPS 제거**

`import { TAGS, type Capture, type Session } from "../db/types.ts";`

- [ ] **Step 2: "왜 저장했나" 통계 카드 제거**

`render`에서 `whyRows`/`freeWhy`/`noWhy` 계산과 해당 "왜 저장했나" 카드 마크업 블록 전체 삭제(태그 통계 카드는 유지).

- [ ] **Step 3: 카드 메타 — why → passage/memo**

`card()`의 capmeta 줄 교체:
```typescript
      <div class="capmeta"><span class="captag">${tag.emoji} ${tag.label}</span> ${esc(c.passage ?? c.memo ?? c.why ?? "—")}</div>
```

- [ ] **Step 4: 빌드 + 확인** — 무에러. Review에 why 통계 사라지고 카드에 passage/메모 표시.
- [ ] **Step 5: Commit** — `git add src/screens/review.ts && git commit -m "feat: Review why 통계 제거, passage/note 표시"`

---

### Task 6: 캡처 사진 모드 — why 시트 → note (`src/screens/capture.ts`)

**Files:** Modify `src/screens/capture.ts`
**Interfaces:** Consumes types(Task1).

- [ ] **Step 1: import·상태 정리**

- `import { TAGS, type Capture, type Session, type Tag } from "../db/types.ts";` (WHY_CHIPS 제거)
- `chosenWhy` 및 chip/writeChip 관련 상태·이벤트 제거. `free`(.sheet__free)를 **note 입력**으로 의미 변경.

- [ ] **Step 2: 시트 마크업 — 칩 제거, note placeholder**

`template()`의 시트에서 `<div class="chips">…${chips}…직접 입력…</div>`와 `chips` 변수를 제거하고, textarea placeholder를 note로:
- `const chips = ...` 라인 삭제.
- 시트 내부: `<h2>왜 저장했나요?</h2>` → `<h2>내 생각 (선택)</h2>`, 그 아래 `<textarea class="sheet__free" rows="2" placeholder="내 생각·메모 (선택)"></textarea>` (style:none 제거해 항상 표시), 페이지 입력 유지.

- [ ] **Step 3: 저장 — memo(note) 기록, why/passage 미설정**

`saveBtn.onclick`에서:
```typescript
      const memoVal = free.value.trim() || null;
      const rec: Capture = {
        uuid: uuid(), sessionId: session.uuid,
        createdAt: Date.now(), updatedAt: Date.now(),
        image: null, passage: null, memo: memoVal,
        tag: chosenTag, why: null, ocr: null, exportStatus: "none",
      };
      const pageNum = parseInt(pageInput.value, 10);
      if (Number.isFinite(pageNum) && pageNum > 0) rec.page = pageNum;
```
(`chosenWhy`/`why` 제거. `resetToLive`에서 free/page 초기화 유지, chip 초기화 제거.)

- [ ] **Step 4: 빌드 + 확인** — 무에러. 사진 캡처 흐름: 셔터→태그→시트(내 생각+페이지)→저장. 3초 루프 유지.
- [ ] **Step 5: Commit** — `git add src/screens/capture.ts && git commit -m "feat: 캡처 사진 모드 why 시트→note"`

---

### Task 7: 입력 모드 + 모드 토글 + 시작 모드 선택 (`capture.ts`, `books.ts`, `app.ts`, `app.css`)

**Files:** Modify `src/screens/capture.ts`, `src/screens/books.ts`, `src/app.ts`, `src/styles/app.css`
**Interfaces:** Capture route에 모드 전달.

이 태스크는 현재 코드 상태에 의존하므로 **구현자가 capture.ts/books.ts/app.ts를 읽고** 아래 요구사항대로 구현한다(정확 코드는 현 파일 기준).

- [ ] **Step 1: 모드 개념 + 라우트**

- `app.ts`의 capture 라우트에 초기 모드 전달: `{ name: "capture"; sessionId: string; mode?: "photo" | "input" }` (기본 "photo"). `mountCapture(root, nav, sessionId, mode)`.

- [ ] **Step 2: 캡처 화면 모드 토글**

- 캡처 화면 상단(pill 영역 근처)에 **📷/✍️ 2-세그먼트 토글**. 전환 시 카메라 정지/재시작 또는 입력 패널 표시.
- **사진 모드:** 기존 카메라 흐름(Task 6 반영).
- **입력 모드:** 카메라 대신 **밝은 입력 패널** — `passage`(큰 textarea, 필수 내용) + `note`(선택) + 페이지(선택) + 태그 행(라벨 알약) → 저장. 저장 시 `isValidCapture`로 검증(passage 필요), `image:null, passage, memo, tag`로 `addCapture`. 카메라 미사용이라 예산 HUD는 입력 모드에서 숨김.
- 토글 전환 시 진행 중 상태 단순 초기화.

- [ ] **Step 3: 시작 모드 선택 (`books.ts`)**

- 세션 시작(`renderProject`) 화면에 **시작 모드 선택(📷 사진 / ✍️ 입력)** 추가. "세션 시작" 시 `nav({ name: "capture", sessionId, mode })`로 선택 모드 전달.

- [ ] **Step 4: CSS** — 모드 토글(2-세그먼트), 입력 패널(라이트, passage 큰 입력), 탭타깃 ≥48px. `src/styles/app.css` 추가.

- [ ] **Step 5: 빌드 + 확인** — 무에러. 책 선택에서 모드 고름 → 해당 모드로 진입. 캡처 화면에서 📷↔✍️ 토글. 입력 모드로 passage 저장 → 사진 없는 캡처 생성, 상세/Export 반영.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: 캡처 사진/입력 모드 토글 + 시작 모드 선택"`

---

### Task 8: 정리 + 문서 (`types.ts`, `docs`)

**Files:** Modify `src/db/types.ts`, `docs/decisions.md`, `docs/glossary.md`

- [ ] **Step 1: WHY_CHIPS 제거**

`src/db/types.ts`에서 `WHY_CHIPS` 상수 삭제(이제 import하는 곳 없음 — 빌드로 확인). `why?` 필드는 deprecated 보존.

- [ ] **Step 2: 빌드** — `npm run build` 무에러(잔존 import 없음 확인). 있으면 해당 파일 정리.

- [ ] **Step 3: ADR + glossary**

- `docs/decisions.md`에 **ADR-014: 캡처 모델 개편(passage/note, why 흡수, image||passage 유효성, 사진/입력 모드)** 추가, ADR-007/009 갱신 메모.
- `docs/glossary.md`에 **passage**, **note** 추가, why deprecated 표기.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore: WHY_CHIPS 제거 + ADR-014/glossary (모델 개편)"`

---

## Self-Review

**1. Spec coverage:** passage/유효성 → T1; 프롬프트 → T2; PDF → T3; 상세 → T4; Review → T5; 캡처 사진모드 note → T6; 입력 모드+토글+시작선택 → T7; WHY_CHIPS 정리+문서 → T8. ✓
**2. Placeholder scan:** T1-6,8은 구체 코드. T7은 UI 구조상 "현 파일 기준 구현" 요구사항 — 코드 일부는 구현자가 현 capture.ts에 맞춰 작성(파일 상태 의존이라 의도적). 그 외 placeholder 없음.
**3. Type consistency:** `passage: string|null`(T1) ↔ T2/T3/T4/T6/T7 사용 일치; `isValidCapture(...,passage,...)`(T1) ↔ T4/T7 호출 일치; `why?` deprecated 보존으로 prompt/pdf/review의 레거시 합치기 코드가 타입 통과; WHY_CHIPS 제거(T8)는 모든 import 제거(T2,T4,T5,T6) 후라 안전.

## 참고
- 빌드-패스 순서 핵심: WHY_CHIPS 제거(T8)는 T2/T4/T5/T6에서 모든 import가 사라진 뒤. `why` 필드는 끝까지 보존(레거시).
- T7은 캡처 흐름 대수술 — 구현자는 현 capture.ts(페이즈 머신·예산 HUD·카메라 cleanup)를 읽고 모드 분기를 신중히. 막히면 BLOCKED 보고.
