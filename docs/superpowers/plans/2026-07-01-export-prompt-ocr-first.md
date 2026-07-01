# Export 프롬프트: 원문 확보(OCR) 먼저 → 분석 2단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Export 프롬프트를 "1단계 원문 전사본 먼저 출력(핵심) → 2단계 분석"의 명시적 순서로 재구성해, OCR 기초자료를 안정적으로 먼저 확보하게 한다.

**Architecture:** `src/lib/prompt.ts`의 `md` 템플릿 중 "## 너에게 (지시)" 섹션 텍스트만 2단계 헤더 구조로 교체하고 템플릿 버전을 v2로 올린다. 로직·데이터·타입·소비자(pdf/export) 불변(ADR-007).

**Tech Stack:** Vanilla TS + Vite. 프롬프트는 마크다운 텍스트.

## Global Constraints
- **텍스트 전용 변경** — `buildExport`/`ExportContext`/`ExportPackage`/캡처 블록/태그 분포/파일 수집 로직 불변. 앱은 분석 안 함(ADR-007).
- 2단계 분리를 **헤더로 명확히**(향후 2단계만 가변). 1단계=원문 확보(핵심), 2단계=분석.
- 1단계 문구에 캡처 3상태 명시: 사진 있으면 OCR / 사진 없으면 담은 글·내 생각 정리 / 사진만 있고 텍스트 없으면 OCR 결과만.
- "먼저 전사본을 출력" 명시(중간 산출물 강제).
- `PROMPT_TEMPLATE_VERSION` `"v1"→"v2"` + `prompt.ts:2` JSDoc 주석 `v1→v2`.
- 마이크로카피 plain·한국어, 용어 일관("원문"/"전사본"/"기초자료"). 태그 범례·데이터·분포 유지.
- 테스트 프레임워크 없음: 검증 = `npm run build` + `npm run test:pdf`(PASS) + preview 미리보기.

---

### Task 1: 프롬프트 지시 2단계 재구성 + 버전 v2 (`src/lib/prompt.ts`)

**Files:**
- Modify: `src/lib/prompt.ts`

**Interfaces:**
- Consumes/Produces: 없음(공개 API·타입 불변). `PROMPT_TEMPLATE_VERSION` 값만 "v2"로.

- [ ] **Step 1: 버전 상수 + JSDoc 주석 갱신**

`prompt.ts:8` `export const PROMPT_TEMPLATE_VERSION = "v1";` → `"v2";`.
`prompt.ts:2` 주석 `* prompt.md 빌더 — ADR-008/009. 버전된 고정 템플릿 v1.` 의 `v1` → `v2`.

- [ ] **Step 2: "## 너에게 (지시)" 섹션 교체**

현재(prompt.ts:75-80):
```
## 너에게 (지시)

나는 책을 읽으며 떠오른 생각을 빠르게 캡처했다. 각 캡처에는 **태그**, 책에서 **담은 글(passage)**, **내 생각(note)**, 그리고 첨부 사진이 있을 수 있다.
첨부 사진은 책 페이지다. **각 사진을 OCR**해 파일명 번호(\`capture-NN\`)로 아래 항목과 연결하라. 그런 다음 아래를 만들어라:

1. **주요 주제** 2. **반복/강조** 3. **캡처 간 관계(연결·충돌)** 4. **글감 후보** 5. **인터뷰 질문** 6. **독서노트 초안**
```
로 교체:
```
## 너에게 (지시)

나는 책을 읽으며 떠오른 생각을 빠르게 캡처했다. 각 캡처에는 **태그**, 책에서 **담은 글(passage)**, **내 생각(note)**, 그리고 첨부 사진이 있을 수 있다. 첨부 사진은 책 페이지다. 아래 **순서대로** 진행하라.

### 1단계 — 원문 정리 (먼저)

**먼저 각 캡처의 원문을 확보·정리해 출력하라.** 이것이 이후 모든 작업의 기초자료다.
- **사진이 있는 캡처:** 사진을 OCR해 오탈자·줄바꿈·잘린 글자를 정리한 깨끗한 텍스트로 만들고, 그 캡처의 담은 글·내 생각과 묶어라.
- **사진이 없는 캡처:** 담은 글·내 생각을 그대로 정리하라.
- **사진만 있고 텍스트가 없는 캡처:** OCR 결과만 정리하라.
각 캡처를 파일명 번호(\`capture-NN\`)로 표시해 **정돈된 전사본**을 먼저 출력하라.

### 2단계 — 분석 (그 다음)

1단계의 정리된 원문을 **근거로** 만들어라.
1. **주요 주제** 2. **반복/강조** 3. **캡처 간 관계(연결·충돌)** 4. **글감 후보** 5. **인터뷰 질문** 6. **독서노트 초안**
```
- 나머지 섹션(태그 범례 `## 태그 범례`, 캡처 `## 캡처`, 참고 분포 `## 참고 — 태그 분포`)은 **그대로 둔다**.
- `###` 헤더는 pdf.ts `wrap()`가 처리(오버플로 없음 — 검토 확인).

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: 타입에러 없음.

- [ ] **Step 4: 스모크**

Run: `npm run test:pdf`
Expected: `PASS — buildPdf produced Blob`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt.ts
git commit -m "feat: Export 프롬프트 원문 확보(OCR) 먼저 → 분석 2단계 (템플릿 v2)"
```

---

## Self-Review
**1. Spec coverage:** 2단계 재구성(1단계 원문·2단계 분석) → Step 2; 캡처 3상태 명시 → Step 2 불릿; "먼저 전사본 출력" → Step 2; 버전 v2 + JSDoc → Step 1; 나머지 섹션·로직 불변 → 명시. ✓
**2. Placeholder scan:** 교체 전/후 문자열 전문 포함, 구체 커밋·명령. 플레이스홀더 없음. ✓
**3. Type consistency:** 공개 API·타입 변경 없음(값 상수만). 소비자(pdf/export/smoke) 영향 없음(검토 확인). ✓

## 참고
- preview로 prompt.md 미리보기(export 화면 `.promptview`)에서 1·2단계 헤더 순서·`v2` 표기 육안 확인.
- 사진 0개/혼합/이미지-only 세 경우 문구 자연스러움 확인.
- 2단계 작업 목록의 향후 목적별 가변(ADR-009 Phase 2)은 별건 — 이번엔 구조만 확립.
