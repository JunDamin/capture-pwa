# 조절형 크롭 박스 + 폴리시 배치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 자유 비율 조절형 크롭 박스를 추가하고(viewer.ts), 감사로 식별한 폴리시(P1/P2/잡정리)를 정리한다.

**Architecture:** 기존 `lib/viewer.ts`(핀치줌/팬 + 보이는영역 크롭)에 조절형 크롭 박스를 얹어 크롭 기준을 "뷰포트 전체 → 박스 영역"으로 바꾼다. 나머지는 audit가 짚은 file:line별 소규모 수정.

**Tech Stack:** Vanilla TS + Vite, Pointer Events, Canvas 2D. 이미지 로드 `Image`+`onload`만(ADR-013).

## Testing approach
테스트 프레임워크 없음. 각 태스크 = `npm run build`(tsc) + (해당 시) `npm run test:pdf` + 커밋. 멀티터치/핸들 드래그는 iOS 실기기 확인(헤드리스 불가).

## Global Constraints
- 다크 풀스크린 뷰어, 토스-클린, 탭타깃 ≥48px(핸들 hit-area ≥44px). 이미지 로드 onload만.
- 크롭 재인코딩 긴 변 ≤3200, JPEG 0.8. `openImageViewer(blob,{onCrop})` 인터페이스 불변.
- 마이크로카피 일관. confirm/alert 미관 변경은 범위 밖.

---

### Task 1: 조절형 크롭 박스 (`src/lib/viewer.ts` + `src/styles/app.css`)

**Files:** Modify `src/lib/viewer.ts`, `src/styles/app.css`
**Interfaces:** `openImageViewer(image, {onCrop})` 불변.

구현자는 **현재 `src/lib/viewer.ts`를 먼저 읽고**(핀치줌/팬 상태 `baseScale/userScale/ox/oy`, `apply()`, pointer 핸들러, crop 핸들러) 아래 요구사항대로 조절형 박스를 추가한다.

- [ ] **Step 1: 크롭 박스 상태 + DOM/CSS**
  - 박스 상태(화면좌표): `box = { l, t, r, b }`, 초기값 = 뷰포트에서 가로 8%·세로 12% inset.
  - 오버레이에 박스 테두리 + 8개 핸들(4 모서리·4 변) DOM 추가, 바깥 마스킹(4개 dim div 또는 큰 box-shadow). 핸들 시각 작아도 hit-area ≥44px.
  - `app.css`에 `.viewer__cropbox`, `.viewer__handle`(8종 위치), `.viewer__mask` 스타일 추가. 다크 위에서 잘 보이게(흰 테두리/반투명 마스크).
  - `renderBox()`: box 상태로 테두리·핸들·마스크 위치 갱신.

- [ ] **Step 2: 제스처 라우팅**
  - `pointerdown`: 대상이 핸들이면 `mode="resize"`(어느 핸들인지 기록), 아니면 기존 팬/핀치 로직.
  - resize: 포인터 이동분으로 해당 모서리/변만 이동(반대변 고정), 뷰포트 클램프 + 최소 60px, `renderBox()`.
  - 한 손가락(핸들 밖)=이미지 팬, 두 손가락=핀치줌(기존 유지). 더블탭 줌 토글 유지.
  - 핀치/팬으로 이미지가 움직여도 박스는 화면좌표 고정.

- [ ] **Step 3: 박스 영역으로 크롭**
  - 기존 crop 핸들러에서 크롭 사각형을 **뷰포트(0,0,vw,vh) 대신 박스 `{l,t,r,b}`** 로:
    `sx0=(box.l-ox)/eff`, `sy0=(box.t-oy)/eff`, `sx1=(box.r-ox)/eff`, `sy1=(box.b-oy)/eff`, `[0,iw]×[0,ih]` 클램프.
  - 나머지(≤3200 다운스케일, toBlob jpeg 0.8, onCrop, close)는 기존대로.

- [ ] **Step 4: 빌드**
  - `npm run build` 무에러. (멀티터치는 iOS 실기기 확인 — 헤드리스 불가, 코드 검토로 가드.)

- [ ] **Step 5: Commit**
  - `git add src/lib/viewer.ts src/styles/app.css && git commit -m "feat: 조절형 크롭 박스(핸들/마스킹) — 박스 영역만 자르기"`

---

### Task 2: CSS 폴리시 + whisper 테스트 페이지 제거 (`src/styles/app.css`, `public/`)

**Files:** Modify `src/styles/app.css`; Delete `public/whisper-test.html`

- [ ] **Step 1: 사진모드 태그 라벨 흰-on-흰 수정**
  `app.css`에 추가: `.photo-ctrl .tag.is-sel .tag__l { color: var(--ink); }` (선택 태그 라벨이 흰 배경에서 보이게).

- [ ] **Step 2: 탭타깃 ≥44px**
  - `.cam__back` → `width: 44px; height: 44px;`(또는 패딩으로 hit-area 확대).
  - `.iconbtn` → `min-width: 44px; min-height: 44px;`.
  - `.capdel` → `min-width: 44px; min-height: 44px; padding: 0; display:flex; align-items:center; justify-content:center;`.

- [ ] **Step 3: `.tag` 세로정렬 + 죽은/잘못된 규칙 정리**
  - `.tag` 규칙에 `justify-content: center;` 추가.
  - `.export .share` 규칙(죽은 셀렉터) 삭제.
  - `.promptview` 폰트스택에서 `"Pretendard"` 제거(모노 폴백 정상화).

- [ ] **Step 4: whisper 테스트 페이지 제거**
  `git rm public/whisper-test.html` (음성 보류 — git 히스토리 보존).

- [ ] **Step 5: 빌드 + 커밋**
  `npm run build` 무에러 → `git add -A && git commit -m "polish: 태그 라벨 가시성·탭타깃·죽은 CSS 정리 + whisper 테스트 페이지 제거"`

---

### Task 3: 캡처 화면 폴리시 (`src/screens/capture.ts`)

**Files:** Modify `src/screens/capture.ts`

- [ ] **Step 1: 사진모드 빈 캡처 방지**
  사진 저장 핸들러(`saveBtn.onclick`)에서 `addCapture(rec)` 호출 전에 콘텐츠 가드 추가: 프레임도 없고 note도 비면 저장 안 함 — `if (!frame && !memoVal) return;` (현 변수명에 맞춰; `memoVal`은 note 입력값).

- [ ] **Step 2: 입력모드 passage 에러 클리어 + 자동 포커스**
  - `inpPassage` 조회 근처에 `inpPassage.oninput = () => inpPassage.classList.remove("field--err");`.
  - `setMode("input")` 분기 끝에 `inpPassage.focus();`.

- [ ] **Step 3: 빌드 + 커밋**
  `npm run build` 무에러 → `git add src/screens/capture.ts && git commit -m "polish: 사진모드 빈 캡처 방지 + 입력모드 포커스/에러클리어"`

---

### Task 4: Review/Detail/Types 폴리시 (`review.ts`, `detail.ts`, `types.ts`)

**Files:** Modify `src/screens/review.ts`, `src/screens/detail.ts`, `src/db/types.ts`

- [ ] **Step 1: review objectURL 누수 + putSession catch + 빈상태 문구**
  - `review.ts` `render()` 시작에서 기존 `urls`를 모두 revoke 후 비우고 재생성(매 render 누수 방지).
  - 세션 목적 편집의 `putSession(...).then(() => render(...))`에 `.catch((e) => console.error("putSession failed", e))` 추가.
  - 빈상태 문구 "카메라로 첫 생각을 붙잡아 보세요" → "캡처 화면에서 첫 생각을 붙잡아 보세요".

- [ ] **Step 2: detail objectURL 누수(재크롭)**
  `detail.ts` `onCrop`에서 새 썸네일 URL을 push하기 전에 **직전 크롭 URL만** revoke. 안전하게 별도 변수 `let lastCropUrl: string | null = null`로 추적(초기 썸네일 URL은 건드리지 않음): 새 크롭 시 `if (lastCropUrl) URL.revokeObjectURL(lastCropUrl); lastCropUrl = u;` 그리고 `urls.push(u)`는 유지(언마운트 정리). (중복 revoke 안 되게 cleanup과 정합.)

- [ ] **Step 3: `Capture.passage` 타입 필수화**
  `types.ts` `passage?: string | null` → `passage: string | null`. `npm run build`로 모든 생성부가 passage를 설정하는지 확인 — 미설정 빌드에러가 나면 해당 생성부에 `passage: null` 추가(현재 capture 사진/입력·detail·backup 모두 설정 중일 것).

- [ ] **Step 4: 빌드 + 커밋**
  `npm run build` 무에러 → `git add -A && git commit -m "polish: review/detail objectURL 누수·putSession catch·빈상태 문구·passage 타입 필수화"`

---

## Self-Review
**1. Spec coverage:** 크롭 박스 → T1; P1(whisper 제거·태그라벨·탭타깃·빈캡처) → T2,T3; P2(.tag정렬·입력포커스·objectURL·putSession) → T2,T3,T4; 잡정리(passage타입·빈상태·죽은CSS·promptview) → T2,T4. ✓
**2. Placeholder scan:** T1은 상호작용 코드라 "현 파일 기준 구현" 요구(의도적); T2-T4는 audit의 구체 file:line·수정안. ✓
**3. Type consistency:** `openImageViewer` 불변(T1); `passage` 필수화(T4)는 모든 생성부 설정 전제 — 빌드로 검증. detail objectURL은 `lastCropUrl` 추적으로 cleanup과 충돌 방지.

## 참고
- 멀티터치 크롭 박스는 iOS 실기기 검증 필수(ADR-013). 데스크톱은 마우스로 핸들/팬 로직 검증.
- detail/review URL revoke는 "현재 표시 중 URL"을 revoke하지 않게 주의(추적 변수).
