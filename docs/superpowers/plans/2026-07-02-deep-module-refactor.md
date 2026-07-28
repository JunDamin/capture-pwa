# 딥모듈 리팩터 — exportModel 추출 + 공용 유틸 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).
> 근거: 딥모듈 점검 — Export 파생 로직이 4파일에 분산(규칙 divergence: review만 다른 note 규칙), toast/esc/fmtTime 복붙.

**Goal:** 흩어진 파생 로직을 좁은 인터페이스의 깊은 모듈로 모은다 — ① 캡처→표현 변환(note 병합·capture-NN 번호·시각) 단일화, ② toast/esc/fmtTime 유틸 공용화. **동작·출력 불변**(리팩터).

**Tech Stack:** 기존 그대로. 검증 = `npm run build` + `npm run test:pdf`(프롬프트/PDF 바이트 동등성 확인).

## Global Constraints
- **순수 리팩터 — 사용자 관측 동작/출력 불변.** prompt.md 텍스트·PDF 캡션·토스트 문구·지속시간(기존 값) 유지. 회귀는 `test:pdf` blob 크기 근사 + 육안 diff로 방어.
- 딥모듈 원칙: 인터페이스는 좁게, 파생 규칙은 모듈 안에 숨김. 새 export 표면 최소화.
- 딜리버릿 스타일 존중: 의도적 병렬 상태(chosenTag/inpChosenTag 등)는 건드리지 않음 — 대상은 **우발적 복붙**(esc 8벌, flash 5벌, fmtTime 5변형)과 **규칙 divergence**(note 병합)뿐.

---

### Task 1: exportModel — 캡처→표현 변환 단일화

**Files:** Create `src/lib/exportModel.ts`; Modify `src/lib/prompt.ts`, `src/lib/pdf.ts`, `src/db/types.ts`(선택: captureNote 헬퍼 위치)

**딥모듈 근거:** note=memo⊕why·capture-NN 번호·fmtTime이 prompt.ts+pdf.ts에 독립 2벌(번호는 서로 참조 → lockstep 강제), review.ts는 note 규칙이 divergent(`passage ?? memo ?? why`).

**Interfaces (Produces):**
```ts
export interface CaptureRow {
  num: string;        // "01" (2자리, 1-based)
  fileName: string;   // "capture-01.jpg"
  tagEmoji: string; tagLabel: string;
  time: string;       // "YYYY-MM-DD HH:mm"
  passage: string | null;
  note: string | null;   // memo ⊕ legacy why (단일 규칙)
  page: number | null;
  hasImage: boolean;
}
export function captureRows(captures: Capture[]): CaptureRow[];
export function captureNote(c: Capture): string | null; // [memo, why] 병합 단일 규칙
```

- [ ] **Step 1: `src/lib/exportModel.ts` 작성** — `captureNote`(= `[c.memo, c.why].filter(s=>s&&s.trim()).join(" · ") || null`), `captureRows`(index+1 padStart 2, `capture-${num}.jpg`, TAGS 조회, fmtTime YYYY-MM-DD HH:mm). fmtTime은 여기 내부 함수(또는 T2 util 재사용 — T2가 뒤에 오므로 T1은 자체 fmtTime, T2에서 통합). Capture/TAGS import.
- [ ] **Step 2: prompt.ts 재배선** — `buildExport`가 `captureRows(captures)`를 써서 `### capture-NN · emoji label · time` / `담은 글:` / `내 생각:`(row.note) / `사진: capture-NN.jpg (첨부)|사진 없음` 블록 생성. **출력 텍스트 바이트 동일**해야 함(현 형식 그대로 매핑). 로컬 pad/fmtTime/note 병합 제거.
- [ ] **Step 3: pdf.ts 재배선** — 사진 페이지의 `num`/캡션(tag·time·page·담은 글·note)을 `captureRows`(또는 개별 헬퍼)로. 로컬 fmtTime/pad/note 병합 제거. **캡션 출력 동일**.
- [ ] **Step 4: review.ts note 규칙 정합** — review.ts:171의 `c.passage ?? c.memo ?? c.why`를 `c.passage ?? captureNote(c) ?? "—"`로(표시 우선순위는 유지하되 note는 단일 규칙). *동작 미세 변경 가능(why 병합) — 리뷰에서 확인, 사용자 관측상 개선*.
- [ ] **Step 5: 빌드 + 스모크** — `npm run build` 무에러. `npm run test:pdf` PASS. **prompt.md diff 확인**: buildExport 출력이 리팩터 전과 동일한지 노드로 비교(간단 스크립트 또는 육안).
- [ ] **Step 6: Commit** — `refactor: exportModel 추출 — 캡처→표현 변환 단일화(note 병합·번호·시각)`

---

### Task 2: 공용 유틸 (toast / esc / fmtTime) + 화면 이관

**Files:** Create `src/lib/ui.ts` (or `dom.ts`); Modify `src/screens/{export,capture,transfer,books,detail}.ts`, `src/lib/bookpicker.ts`, `src/lib/exportModel.ts`(fmtTime 통합), `src/screens/{home,review}.ts`(fmtTime 변형), `src/styles/app.css`(불필요 시 무변경)

**Interfaces (Produces):**
```ts
export function escapeHtml(s: string): string;
export function showToast(root: HTMLElement, msg: string, ms?: number): void; // .toast 요소 보장/생성 + 타이머 리셋 + aria-live
export function formatTime(ts: number, style: "full" | "short" | "date" | "hm"): string;
```

- [ ] **Step 1: `src/lib/ui.ts`** — `escapeHtml`(현 esc 구현), `showToast`(root에서 `.toast` 찾고 없으면 생성·append, `aria-live="polite"` 부여, textContent·hidden 토글, 이전 타이머 clearTimeout, 기본 ms=2400), `formatTime`(full=`YYYY-MM-DD HH:mm`, short=`MM-DD HH:mm`, date=`YYYY.M.D`, hm=`HH:mm` — 현 5변형 커버).
- [ ] **Step 2: esc 이관** — bookpicker/detail/export/capture/transfer/review/books/home의 로컬 `esc` 제거 → `escapeHtml` import 사용(호출부 `esc(` → `escapeHtml(` 또는 `import { escapeHtml as esc }`로 최소 변경).
- [ ] **Step 3: flash/toast 이관** — export/capture/transfer/books/detail의 로컬 `flash`/`.toast` 세팅을 `showToast(root, msg)`로. **각 화면의 기존 지속시간 유지**(detail 2400, capture 3000 등 — 필요 시 ms 인자). 타이머 리셋·aria-live는 유틸이 담당.
- [ ] **Step 4: fmtTime 통합** — exportModel(T1)의 자체 fmtTime → `formatTime(ts,"full")`; home relTime 옆 스탬프·detail 스탬프·review hm·pdf 캡션(captureRows 경유)을 `formatTime` 해당 style로. buildLabel(home 빌드 스탬프)은 로컬 유지 가능(용도 특수) — 판단.
- [ ] **Step 5: 빌드 + 스모크 + Commit** — `npm run build` 무에러, `test:pdf` PASS. `grep -rn "function esc(\|const flash" src/` → 0(공용화 확인). Commit `refactor: 공용 UI 유틸(escapeHtml·showToast·formatTime) — 복붙 제거 + aria-live`

---

## Self-Review
딥모듈 점검 ①(exportModel) → T1, ②(toast)·③(esc/fmtTime) → T2. 순수 리팩터(출력 불변) 명시. 의도적 병렬 상태 불건드림. capture.ts 분리는 범위 밖(별건). ✓
