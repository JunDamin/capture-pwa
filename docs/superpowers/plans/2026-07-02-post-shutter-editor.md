# 촬영 후 편집 시트 — 사진 경로 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 셔터 직후 대형 편집 시트(크롭 결과 사진 + 다시 찍기 + 태그→담은 글→생각→페이지→저장)로 전환해, 찍힌 결과를 확인하고 입력모드와 동일한 흐름으로 저장한다. 카메라는 시트 아래 라이브 유지(다시 찍기 즉시).

**Architecture:** capture.ts 내 phase 재설계(`live ↔ editing`): 동결 상태·인카메라 태그·기존 note 시트 제거, 크롭+압축을 셔터 시점으로 이동(`pendingPhoto`), 에디터는 복제 DOM(`.ed__*`) + 입력 패널과 공용 헬퍼(wireTagRow/readForm/validate). 시트 열림 중 상단 요소 게이팅(`is-editing`). detail 사진도 동일 반응형 원칙. ADR-018.

**Tech Stack:** Vanilla TS + Vite. 기존 cropResizeCompress/openImageViewer/budget 재사용.

## Global Constraints
- **예산(ADR-011 개정):** `shutterMs` = 셔터 탭→시트 상승 시작(동기 작업만: freezeCanvas draw + cover 매핑 + 압축 킥오프 + 클래스 플립, ~≤50ms). `compressMs`는 병행·appMs 제외(현행 동일), pendingPhoto에 실어 저장 시 record. `saveMs` = 저장 탭→시트 하강+addCapture. `appMs = shutterMs + saveMs ≤ 300` 불변. **회귀 기준: 사진이 시트 애니메이션(0.32s) 내 표시.** BudgetSample/HUD 형태 불변.
- **스냅샷 의미론:** 크롭 rect + cover 매핑은 **셔터 시점 확정**(§9의 "동결 중 조정 반영" 폐기 — ADR-018 명시, 보상=시트 재크롭).
- **다시 찍기 = 사진만 폐기**(URL revoke + pendingPhoto null), 텍스트·태그 보존 → 다음 셔터에 시트 재개(필드 유지). 전체 초기화는 저장/모드 전환/이탈.
- **저장 피드백:** 사진 저장 = ✓ done 배지(시그니처), 무사진 폴백 = "저장했어요" 토스트.
- **검증:** pendingPhoto 있으면 태그만 필수; 없으면(늦은 압축 실패 등) passage‖note + 태그(입력 규칙). `isValidCapture` 유지. **단일 addCapture**(이중 저장 수렴).
- **게이팅:** `.cam.is-editing` 도입 — pill·HUD·cropframe pointer-events/표시 차단 + `cam__back`/`cnt`/모드 토글 핸들러에 editing 가드.
- **에디터 = 복제 DOM + 공용 헬퍼**(같은 DOM 재부모화 금지). `.ed__*` 필드가 `.field`/`.tag` 클래스 재사용, 밝은 태그행 CSS 공용 클래스로 재타깃.
- objectURL: pendingPhoto 표시 URL은 저장/다시 찍기/이탈 시 revoke(기존 freezeUrl 누수도 소멸). 이미지는 `<img>`+objectURL만(ADR-013). 카메라 스트림은 시트 아래 라이브(현행 동결과 열/배터리 동등).
- 마이크로카피: "다시 찍기", "저장". 시트는 밝은 톤·내부 스크롤·저장 버튼 도달 가능. 탭타깃 ≥44px.
- 테스트 프레임워크 없음: 각 태스크 = `npm run build` + 커밋(T1·T4는 `test:pdf`도). 시트 체감·키보드는 preview+iOS 실기기.

## File Structure
- T1: `src/screens/capture.ts`(핵심 재설계) + `src/styles/app.css`
- T2: `src/screens/capture.ts`(시트 사진 상호작용: 재크롭·placeholder/늦은 실패)
- T3: `src/screens/detail.ts` + `src/styles/app.css`(반응형 img 전환)
- T4: `docs/decisions.md`(ADR-018)·`CLAUDE.md`(사진 경로 서술 개정)

---

### Task 1: capture.ts 핵심 재설계 (해체 + 셔터 이동 + 편집 시트)

**Files:**
- Modify: `src/screens/capture.ts`, `src/styles/app.css`

**Interfaces:**
- Consumes: 기존 `cropResizeCompress`, `addCapture`, `flash`, `showDone`, budget(Stopwatch/record/renderHud), cropframe.
- Produces(T2 전제): `pendingPhoto: { blob: Blob; width: number; height: number; compressMs: number } | null`(run 스코프), `pendingUrl: string | null`(헤더 objectURL), `.ed__photoimg`(헤더 img), `openEditor()`/`closeEditor(reset: boolean)`, 공용 `wireTagRow/readForm/validate` 헬퍼.

구현자는 **현 capture.ts 전체를 정독** 후(리뷰 인벤토리 기준) 진행:

- [ ] **Step 1: 해체(검토 인벤토리)**
  - `Phase` → `"live" | "editing"`. `is-frozen` 클래스 조작·`.cam__freeze` img·`freezeUrl`·프리뷰 `canvas.toBlob(0.6)` 제거(템플릿 포함). 인카메라 태그행(photo-ctrl tagrow)·`chosenTag`·기존 note 시트 DOM/open/close/scrim/sheetTag 제거. hint 텍스트는 live/에러용만.
  - CSS 제거: `.cam.is-frozen .cam__freeze`/`.cam.is-frozen .shutter-wrap`/`.cam:not(.is-frozen) .photo-ctrl .tagrow`/`.photo-ctrl .tag.is-sel .tag__l` + 가로모드의 `.cam__freeze` 참조.

- [ ] **Step 2: 셔터 = 크롭·압축 + 시트 상승**

```typescript
shutter.onclick = () => {
  if (phase !== "live") return;
  const shutterSw = new Stopwatch();
  // 1) 소스 캔버스 + 셔터 시점 cover 매핑(기존 저장 핸들러의 매핑 코드를 이동)
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  const cropPx = computeCropPx(canvas); // 기존 cover 매핑 로직 함수화(cam.clientWidth/cropFrame.getRect() — 셔터 시점 스냅샷)
  // 2) 압축 킥오프(비동기 — 시트 애니메이션과 병행)
  const compSw = new Stopwatch();
  void cropResizeCompress(canvas, canvas.width, canvas.height, cropPx)
    .then(({ blob, width, height }) => {
      pendingPhoto = { blob, width, height, compressMs: compSw.stop() };
      canvas.width = 0; canvas.height = 0; // iOS 메모리 즉시 해제
      if (phase === "editing") setEditorPhoto(blob); // 늦게 도착해도 시트에 반영
    })
    .catch(() => { canvas.width = 0; canvas.height = 0; /* 무사진 강등 — placeholder 유지 */ });
  // 3) 시트 상승(동기)
  openEditor();
  shutterMs = shutterSw.stop(); // 시트 상승 시작까지(동기 구간)
};
```
`setEditorPhoto(blob)`: 기존 pendingUrl revoke → `URL.createObjectURL` → `.ed__photoimg.src` + placeholder 숨김.

- [ ] **Step 3: 편집 시트 DOM/CSS**

템플릿에 대형 시트 추가(기존 `.sheet` 자리 대체):
```html
<div class="edsheet">
  <div class="grab"></div>
  <div class="edsheet__scroll">
    <div class="ed__photo">
      <img class="ed__photoimg" alt="" hidden />
      <div class="ed__photoph">📷</div>
      <button class="btn-ghost ed__retake">다시 찍기</button>
    </div>
    <div class="inp__hint ed__hint"></div>
    <div class="ed__tagrow tagrow--light">${tags}</div>
    <label class="inp__label">담은 글</label>
    <textarea class="field ed__passage" rows="4" placeholder="담고 싶은 글 (선택)"></textarea>
    <label class="inp__label">내 생각</label>
    <textarea class="field ed__note" rows="3" placeholder="내 생각 (선택)"></textarea>
    <input class="field ed__page" inputmode="numeric" placeholder="페이지 (선택)" />
    <button class="btn-primary ed__save">저장</button>
  </div>
</div>
```
CSS: `.edsheet`(absolute bottom, height ~90%, 밝은 배경, radius 24 24 0 0, translateY(100%) → `.is-open` 0, 기존 스프링), `.edsheet__scroll`(overflow-y auto, -webkit-overflow-scrolling, padding 최소), `.ed__photo`(중앙, img max-height 30vh·max-width 100%·object-fit contain·radius 12), `.ed__photoph`(placeholder 톤), `.ed__retake`(≥44px). **태그행 밝은 스타일을 `.tagrow--light` 공용 클래스로 추출**해 입력 패널(.inp__tagrow)과 시트가 공유(기존 `.cam.mode--input .inp__tagrow ...` 규칙 재타깃).

- [ ] **Step 4: 공용 헬퍼 추출 + 입력 패널 적용**

```typescript
function wireTagRow(rowEl: HTMLElement, onPick: (t: Tag) => void) { /* .tag 클릭 → is-sel 토글 + onPick */ }
function readForm(els: { passage: HTMLTextAreaElement; note: HTMLTextAreaElement; page: HTMLInputElement }) { /* trim값 3종 반환 */ }
function validate(v: { hasPhoto: boolean; passage: string | null; note: string | null; tag: Tag | null }, els): boolean { /* 규칙: 사진→태그만, 무사진→(passage‖note)+태그. field--err/hint 처리 */ }
```
입력 패널 저장 핸들러도 이 헬퍼를 쓰도록 정리(동작 불변 — 기존 검증·에러클리어·토스트 유지).

- [ ] **Step 5: openEditor/closeEditor/다시 찍기/저장**

- `openEditor()`: `phase = "editing"`; `cam.classList.add("is-editing")`; `.edsheet.is-open`; (필드는 보존 상태 그대로 — 다시 찍기 재개 대응).
- `closeEditor(reset)`: 클래스 해제, `phase = "live"`; reset=true면 필드·태그·pendingPhoto/pendingUrl 전부 초기화(revoke).
- 다시 찍기: `pendingUrl` revoke, `pendingPhoto = null`, img hidden+placeholder 표시, `closeEditor(false)` — **텍스트·태그 보존**.
- 저장: `const saveSw = new Stopwatch();` → readForm+에디터 태그 → `validate({ hasPhoto: !!pendingPhoto, ... })` 실패 시 return → rec 구성(`image: pendingPhoto?.blob ?? null`, imageW/H, passage/note/page/tag) → **단일 addCapture** → `appMs = shutterMs + saveSw.stop()` + `record({ captureMs, appMs, humanMs, compressMs: pendingPhoto?.compressMs ?? 0, sizeKB })` + renderHud → pendingPhoto 있으면 `showDone()`, 없으면 `flash("저장했어요")` → `closeEditor(true)` → count/cntEl 갱신.

- [ ] **Step 6: 게이팅 + 정리**

- CSS: `.cam.is-editing .pill { pointer-events: none; }`, `.cam.is-editing .cropframe { pointer-events: none; }`, `.cam.is-editing .hud { display: none; }`.
- 핸들러 가드: `cam__back`/`cnt`/모드 토글에 `if (phase === "editing") return;`(pill 책전환은 기존 `currentMode !== "input"` 가드로 이미 차단). `setMode`가 editing 중 호출 불가함을 보장(토글 가드로 충분 — 갇힘 방지 확인).
- cleanup: `pendingUrl` revoke 추가(+freezeUrl 누수는 삭제로 자연 해소).

- [ ] **Step 7: 빌드 + 스모크 + Commit**

Run: `npm run build` → 무에러. `npm run test:pdf` → PASS.
```bash
git add src/screens/capture.ts src/styles/app.css
git commit -m "feat: 촬영 후 편집 시트 — 셔터 크롭·태그/입력 통합·다시 찍기 (ADR-018)"
```

---

### Task 2: 시트 사진 상호작용 — 재크롭 + placeholder 상태

**Files:**
- Modify: `src/screens/capture.ts`

**Interfaces:**
- Consumes: T1의 `pendingPhoto`/`setEditorPhoto`/`.ed__photoimg`, 기존 `openImageViewer`(detail.ts:92-107의 onCrop 패턴).

- [ ] **Step 1: 사진 탭 → 뷰어(재크롭)**

```typescript
(root.querySelector(".ed__photoimg") as HTMLImageElement).onclick = () => {
  if (!pendingPhoto) return;
  openImageViewer(pendingPhoto.blob, {
    onCrop: (blob, w, h) => {
      pendingPhoto = { ...pendingPhoto!, blob, width: w, height: h };
      setEditorPhoto(blob); // URL 교체(이전 revoke)
    },
  });
};
```
(실제 openImageViewer 시그니처는 detail.ts 사용부에 맞춤. 뷰어는 z1000 — 시트 위 OK.)

- [ ] **Step 2: placeholder/늦은 실패 상태 정리**

- 압축 완료 전: `.ed__photoph`(📷 중립) 표시. 완료: img 표시. 실패: placeholder 유지(무사진 강등 — 저장 시 validate가 입력 규칙 적용). 다시 찍기는 항상 동작.
- 연속 셔터(시트 재개 상태에서 다시 찍기→재촬영): 이전 pendingUrl revoke 보장(setEditorPhoto가 처리) 확인.

- [ ] **Step 3: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/screens/capture.ts
git commit -m "feat: 편집 시트 사진 탭 재크롭 + placeholder/실패 강등 상태"
```

---

### Task 3: detail.ts 반응형 사진

**Files:**
- Modify: `src/screens/detail.ts`, `src/styles/app.css`

- [ ] **Step 1: `<img>` 전환**

`.detail__photo`(4:3 background-image div — 레터박스가 패딩 낭비 원인)를 `<img class="detail__photoimg">`로: objectURL src(기존 urls 수명 규율), `max-height: 30vh; width: auto; max-width: 100%; object-fit: contain; border-radius: 12px; display: block; margin: 0 auto;` 패딩 최소. 사진 없음(`--none`) placeholder는 유지. 탭→openImageViewer(기존 배선 유지). 가로모드 오버라이드(app.css ~1135의 70vh)를 img 기준으로 정합.

- [ ] **Step 2: 빌드 + Commit**

Run: `npm run build` → 무에러.
```bash
git add src/screens/detail.ts src/styles/app.css
git commit -m "feat: 캡처 상세 사진 반응형 축소(레터박스 제거, 한 화면에 최대한)"
```

---

### Task 4: ADR-018 + CLAUDE.md 개정

**Files:**
- Modify: `docs/decisions.md`, `CLAUDE.md`

- [ ] **Step 1: ADR-018**

기존 형식으로 추가: 사진 경로 재설계 — 셔터→대형 편집 시트(카메라 라이브 유지·다시 찍기 즉시), 태그는 시트에서(입력모드와 통일), 탭 수 불변(2탭)으로 3초 루프 의미 유지; 크롭 rect·cover 매핑 **셔터 시점 스냅샷**(§9 동결-조정 폐기, 보상=시트 재크롭); 예산 재정의(shutterMs=셔터→시트 상승 시작, compressMs 병행·appMs 제외, 회귀 기준=사진이 애니메이션 내 표시); 스트림 라이브 유지=현행 동결과 열 동등; 단일 addCapture; 저장 피드백(사진=done 배지, 무사진=토스트).

- [ ] **Step 2: CLAUDE.md 사진 경로 서술 갱신**

"캡처 '사진 모드' 3초 루프" 항목의 경로 기술을 "(셔터→태그→note 시트→저장)" → "(셔터→편집 시트: 태그→저장)"으로, 원칙(느리게 하거나 포커스 가로채는 변경 금지)은 유지.

- [ ] **Step 3: 빌드(문서 무관 확인) + Commit**

```bash
git add docs/decisions.md CLAUDE.md
git commit -m "docs: ADR-018 사진 경로 재설계 + CLAUDE.md 갱신"
```

---

## Self-Review
**1. Spec coverage:** 시트 흐름·셔터 이동·해체 → T1; 검토 조정 1(게이팅)·2(스냅샷)·3(예산)·4(다시찍기 보존)·5(freeze 삭제·placeholder)·6(피드백)·7(복제DOM+헬퍼)·9(cleanup revoke)·11(단일 addCapture) → T1; 10(재크롭)·5(늦은 실패) → T2; 8(detail img) → T3; ADR-018/CLAUDE.md → T4. ✓
**2. Placeholder scan:** 핵심 코드 제시, 세부는 "현 파일 정독+인벤토리" 기반(의도적 — 대수술이라 실코드 정합 필수). ✓
**3. Type consistency:** `pendingPhoto{blob,width,height,compressMs}`(T1) ↔ T2 사용 일치; validate 시그니처 T1 정의·입력 패널 공용; openImageViewer는 detail 사용부 기준. ✓

## 참고
- 순서: T1 → T2 → T3 → T4. T1이 대수술 — 태스크 리뷰 필수.
- preview: 셔터→시트(사진 0.32s 내 표시), 다시 찍기(텍스트 보존), 저장(사진=배지/무사진=토스트), 게이팅(시트 위 틈 탭 무반응), 입력모드 회귀 없음(공용 헬퍼 후). iOS 실기기: 전환 체감·키보드-시트·HUD.
