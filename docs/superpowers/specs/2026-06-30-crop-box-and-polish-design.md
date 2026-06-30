# 조절형 크롭 박스 + 폴리시 배치 설계 (spec)

날짜: 2026-06-30
관련: SP-A 이미지 줌/크롭(viewer.ts), ADR-013(iOS WebKit), design-language.md, 폴리시 감사 결과

## Context

**크롭 박스:** 현재 크롭은 "보이는 화면 영역 전체"를 잘라 **자를 비율이 세로 화면 비율에 묶인다** → 좌우로 긴 띠(상하를 잘라낸 영역)를 못 만든다. **자유 비율 조절형 크롭 박스**(핸들)를 추가해 임의 영역을 자른다.

**폴리시:** 최근 빠른 기능 추가로 생긴 거친 부분을 감사로 식별 → 정리(사용자 합의: 크롭 박스 + P1+P2+잡정리, 단 네이티브 confirm/alert 미관 변경은 제외).

## 1. 조절형 크롭 박스 (`src/lib/viewer.ts` 확장)

접근법 A(승인). 기존 핀치줌/팬 뷰어 위에 조절형 사각형을 얹는다.

- **박스 상태:** 화면 좌표 사각형 `{left, top, right, bottom}`. 기본값 = 뷰포트에서 안쪽 inset(예: 가로 8%·세로 12%)이라 핸들이 바로 보임/잡힘.
- **핸들:** 4 모서리 + 4 변. 터치 영역 ≥44px(시각은 작아도 hit-area 확대). 박스 바깥은 어둡게 **마스킹**(4개 dim 사각형 또는 box-shadow).
- **제스처 라우팅(포인터):**
  - 포인터다운이 **핸들 위** → 해당 모서리/변 드래그로 **박스 리사이즈**(반대변 고정).
  - **한 손가락**(핸들 밖) → **이미지 팬**(기존).
  - **두 손가락** → **핀치줌**(기존). (박스는 화면좌표 고정 — 이미지가 박스 안에서 움직임.)
  - 더블탭 줌 토글 유지.
- **클램프:** 박스는 뷰포트 안으로, 최소 크기(예: 60px) 보장. 리사이즈 시 반대 변 넘어가지 않게.
- **크롭 동작:** "자르기" = **박스 사각형**을 소스 좌표로 환산(기존 역매핑 `s=(v-o)/eff` 재사용하되 v=box 경계) → `[0,iw]×[0,ih]` 클램프 → canvas로 그려 긴 변 ≤3200, JPEG 0.8 재인코딩 → `onCrop(blob,w,h)`.
- **유지:** 다크 풀스크린, ADR-013(이미지 `Image`+`onload`만), `✕ 닫기` / `✂︎ 자르기`(≥48px).
- 인터페이스 불변: `openImageViewer(blob, {onCrop})` 그대로.

## 2. 폴리시 배치 (감사 기반)

### P1 (높음)
- **whisper-test.html 제거:** `public/whisper-test.html` 삭제(음성 보류 — git 히스토리 보존).
- **사진모드 태그 라벨 흰-on-흰 버그:** `app.css` `.tag.is-sel`는 흰 배경인데 `.tag__l`이 흰 글씨 → 라벨 안 보임. 추가: `.photo-ctrl .tag.is-sel .tag__l { color: var(--ink); }`.
- **탭타깃:** `.cam__back` 28→≥44px, `.iconbtn` 36→44px(min-width/height). (전 라이트 화면 뒤로가기 동시 개선)
- **사진모드 빈 캡처 방지:** `capture.ts` 사진 저장 핸들러에서 `addCapture` 전에 콘텐츠 가드 — `if (!frame && !memoVal) return;`(또는 조립 후 `isValidCapture`).

### P2 (중간)
- **`.tag` 세로정렬:** `app.css .tag`에 `justify-content: center` 추가(top-heavy 해소).
- **입력모드 passage:** `inpPassage.oninput = () => inpPassage.classList.remove("field--err")` 추가, `setMode("input")` 끝에 `inpPassage.focus()`.
- **detail objectURL 누수:** `onCrop`에서 새 URL push 전에 직전 크롭 URL revoke(`if (urls.length>1) URL.revokeObjectURL(urls.pop()!)` — 단, 원본 썸네일 URL은 보존하도록 인덱스 주의; 안전하게 "직전 크롭 URL" 추적 변수로).
- **review objectURL 누수:** `render()` 시작에서 기존 `urls` 전부 revoke 후 재생성.
- **`putSession` 에러:** `review.ts` 세션 목적 편집의 `putSession(...).then(render)`에 `.catch(console.error)`.

### 잡정리 (낮음)
- **`Capture.passage` 타입 정합:** `types.ts` `passage?: string|null` → `passage: string|null`(필수 키). 모든 생성부가 이미 passage를 설정하는지 빌드로 확인(미설정 시 해당 생성부에 `passage: null` 추가).
- **빈상태 문구:** `review.ts` "카메라로 첫 생각을…" → "캡처 화면에서 첫 생각을 붙잡아 보세요"(모드 무관).
- **죽은 CSS:** `app.css`의 `.export .share` 규칙 삭제(이제 `.topdf`).
- **promptview 폰트:** `.promptview` 모노스택에서 `"Pretendard"` 제거(비례폰트가 모노 폴백에 끼면 안 됨).

### 제외
- 네이티브 `confirm()`(삭제)·`alert()`(검증) → 토스트/인라인 전환은 이번 배치에서 제외(동작 변경, 추후).

## 디자인 언어 / 제약
- 크롭 박스: 다크 풀스크린, 토스-클린 최소 컨트롤, ≥48px(핸들 hit-area ≥44px). 마스킹은 과하지 않게.
- 이미지 로드 `Image`+`onload`만(ADR-013).

## 검증 (Verification)
테스트 프레임워크 없음 → `npm run build`(tsc) + `npm run preview` 수동 + `npm run test:pdf` + **iOS 실기기**(크롭 박스 멀티터치/핸들은 실기기 필수).
1. `npm run build` 무에러.
2. preview(데스크톱): 상세 사진 탭 → 박스 핸들로 좌우 긴 띠 지정 → 자르기 → 그 영역만 저장. 줌·팬·박스 동시 동작(마우스).
3. 폴리시: 사진모드 선택 태그 라벨 보임 / 뒤로가기 탭 쉬움 / 입력모드 passage 포커스·에러클리어 / 빈상태 문구 / 빌드에 죽은 CSS 영향 없음.
4. iOS 실기기: 핀치줌 + 박스 핸들 드래그 + 자르기 동작.

## 미해결/주의
- 크롭 박스 제스처 라우팅(핸들 vs 팬 vs 핀치) 충돌 — 핸들 hit-test 우선, 멀티터치는 핀치 우선. 실기기 튜닝.
- 박스 마스킹 렌더 방식(4 div vs box-shadow spread) 구현 중 택일.
- detail/review URL revoke는 "현재 표시 중 URL"을 실수로 revoke하지 않게 추적 변수로 분리.
