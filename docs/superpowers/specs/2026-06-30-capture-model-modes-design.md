# 캡처 입력 모델·모드 개편 설계 (spec)

날짜: 2026-06-30
관련: ADR-001~006(도메인), ADR-007(규칙 분류), ADR-009(prompt 템플릿), docs/glossary.md, PRD §7/§8/§11

## Context

사용자가 기록 모델을 명확히 하고 싶어 한다:
- **passage**(책에서 담고 싶은 글/인용)와 **note**(내 생각)를 **분리**.
- 내용은 **image 또는 passage 중 최소 하나** 입력(둘 중 하나는 필수).
- 기존 **why(왜 저장했나) 칩은 note에 흡수**(별도 필드 제거).
- 그리고 캡처를 **사진 모드 / 입력(텍스트) 모드** 로 나눠, **책 선택·세션 시작 시점**과 **캡처 화면**에서 모드를 고르고 쉽게 토글.

즉 "입력 모드 = passage 타이핑", "사진 모드 = 카메라". 이건 핵심 도메인 변경이라 타입·캡처·상세·Review·AI 프롬프트·백업·기존 데이터에 파급된다.

## 도메인 모델 (ADR로 기록 — ADR-014 예정)

`Capture` (변경):
- `tag: Tag` — 느낌, 1개·필수 (유지)
- `image: Blob | null` (유지)
- **`passage: string | null`** (신규 — 책에서 담고 싶은 글)
- `memo: string | null` — **note(내 생각)로 의미 재정의**, why 흡수 (필드명 유지: `memo`)
- `page?: number`, `ocr: string | null`(사진만), `createdAt/updatedAt/sessionId/uuid/exportStatus` (유지)
- **`why` 제거**: 신규 캡처는 설정하지 않음. 타입에서 `why?: string | null`을 **deprecated(선택)로 남겨** 기존 레코드 읽기 호환만 유지(아래 마이그레이션).

용어(glossary 갱신): **passage**(인용/본문), **note**(주석·내 생각). WHY_CHIPS 상수 제거.

### 유효성 (`isValidCapture`)

신규 규칙: **(image 있음) 또는 (passage 비어있지 않음)** + tag.
```ts
export function isValidCapture(c: Pick<Capture,"image"|"passage"|"memo"|"tag">): boolean {
  const hasContent = c.image != null
    || (c.passage != null && c.passage.trim() !== "")
    || (c.memo != null && c.memo.trim() !== ""); // 레거시 memo-only 호환
  return hasContent && !!c.tag;
}
```
- 새 UI는 내용으로 image/passage만 제공하므로 신규는 (image||passage)를 만족. `memo` 절은 기존 memo-only 레코드 편집 저장이 막히지 않게 하는 **호환 조항**.

### 기존 데이터 마이그레이션 (비파괴)

- 스키마 버전업/일괄 변환 없음(IndexedDB 레코드 단위).
- 기존 캡처: `passage` 없음, `why`/`memo` 있을 수 있음. **`why`는 표시/Export에서 note에 합쳐 보여줌**(데이터는 그대로 둠): 표시용 note = `[memo, why].filter(Boolean).join(" · ")` 같은 식. 신규 캡처는 why 미설정.

## 캡처 모드 (사진 / 입력)

- **세션 시작 화면(`books.ts`)**: 책 선택 후(또는 선택과 함께) **시작 모드 선택**(📷 사진 / ✍️ 입력). 선택이 캡처 화면의 초기 모드가 됨.
- **캡처 화면(`capture.ts`)**: 상단/하단에 **모드 토글(📷 ↔ ✍️)**. 전환 즉시 동작, 부담 없이 오감.
  - **사진 모드:** 기존 카메라 흐름(셔터→동결→태그→note 시트→저장). 단 why 칩 제거, 시트는 **note(선택) + 페이지(선택)**. (passage는 사진 모드에선 선택적으로 비움; AI가 OCR.)
  - **입력 모드:** 카메라 대신 **텍스트 입력 화면** — **passage 입력**(필수 내용) + note(선택) + 페이지(선택) → 태그 → 저장. 다크 카메라 화면이 아니라 밝은 입력 화면(디자인 언어: 입력은 라이트).
- 3초 루프 철학: 사진 모드는 기존 속도 유지. 입력 모드는 타이핑이라 속도 예산 대상 아님(humanMs).

## 영향 파일

- `src/db/types.ts` — `passage` 추가, `memo` 의미 재정의 주석, `why` deprecated, `isValidCapture` 변경, `WHY_CHIPS` 제거.
- `src/db/db.ts` — 변경 거의 없음(put 기반). 
- `src/screens/capture.ts` — 모드 토글 + 입력 모드 화면 + why 시트 제거(→note).
- `src/screens/books.ts` — 시작 모드 선택.
- `src/screens/detail.ts` — passage/note 편집(why UI 제거). 표시 시 레거시 why 합치기.
- `src/screens/review.ts` — 카드/요약에서 why 통계 제거, passage/note 반영.
- `src/lib/prompt.ts` — 캡처 블록에 **passage(인용)** + **note** 출력, why 라인·"글감 후보" 분류 제거(ADR-007/009 갱신). 레거시 why는 note에 합쳐 출력.
- `src/lib/pdf.ts` — prompt.md 재사용이라 자동 반영(텍스트 페이지). 캡션도 passage/note로(코드 확인).
- `src/lib/backup.ts` — Capture 전체 직렬화라 passage 자동 포함(코드 변경 불필요), 버전 유지.
- `docs/decisions.md` — ADR-014(모델 개편), ADR-007/009 갱신 메모. `docs/glossary.md` — passage/note 추가.

## 디자인 언어 준수

- 입력 모드 화면은 밝은 토스-클린(라이트). passage = 큰 입력 영역, note = 보조 입력. 태그는 라벨 알약(기존 개편 유지). 마이크로카피 일관: "담고 싶은 글", "내 생각(선택)", "저장". 모드 토글은 명확한 2-세그먼트.

## 에러 처리 / 엣지

- 입력 모드 저장: passage 비고 image도 없으면 막고 안내("담고 싶은 글이나 사진이 필요해요").
- 레거시 why-only(=memo 없고 why만): 표시/Export에서 why를 note로 보여줌; 편집 저장 시 why를 memo로 이전(첫 편집 시 합치기) — 선택 구현.
- 모드 토글 시 진행 중 입력/동결 프레임 처리(전환 경고 없이 단순 초기화).

## 검증 (Verification)

테스트 프레임워크 없음 → `npm run build`(tsc) + `npm run preview` 수동(+ iOS 실기기).
1. `npm run build` 무에러(타입: passage 추가, isValidCapture 시그니처, WHY_CHIPS 제거 파급).
2. 사진 모드: 기존처럼 캡처(why 없이 note·페이지 선택). 입력 모드: passage 타이핑 저장 → 사진 없는 캡처 생성.
3. 상세: passage/note 편집·저장. Review: why 통계 사라지고 passage/note 반영.
4. Export prompt.md/PDF에 passage(인용)+note가 나오고 why/글감분류가 빠짐. 기존 캡처의 why가 note로 합쳐 출력.
5. 백업→가져오기 라운드트립에 passage 포함.
6. 모드 토글이 책 선택·캡처 양쪽에서 동작.

## 미해결/주의

- 이건 코어 변경이라 단일 plan이 커질 수 있음 → plan에서 (a) 모델+백엔드+상세+Export, (b) 캡처 모드 UX 로 태스크 분리 가능.
- ADR-007(규칙 기반 "글감 후보" 분류)이 why에 의존 → 제거 시 Export 프롬프트의 사전분류 섹션 축소. AI가 passage/note/tag로 충분히 분류 가능하다는 판단(사용자 합의 필요시 검토).
- 레거시 why→note 이전을 "표시만"으로 둘지 "편집 시 실제 이전"할지: 기본은 표시 합치기(비파괴), 실제 이전은 선택.
