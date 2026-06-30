# 서브프로젝트 A — 큰 이미지 + 전체화면 줌 뷰어 + 크롭 설계 (spec)

날짜: 2026-06-30
관련: ADR-003(이미지 Blob/리사이즈), ADR-013(iOS WebKit 호환), docs/design-language.md, 캡처 상세 화면(detail.ts)

## Context

사용자는 캡처한 책 사진의 **작은 글씨를 읽고 싶다**. 현재는 (1) 저장 이미지가 긴 변 1600px·품질 0.7로 작고, (2) 상세 화면 사진을 **탭해도 확대 불가**, (3) 의미 없는 여백을 **잘라낼 수 없다**.

목표: 캡처 이미지를 더 크게 저장하고, 전체화면에서 **핀치줌·팬으로 확대해 읽고**, **보이는 영역으로 크롭**해 의미 있는 부분만 남긴다.

제약: 뷰포트가 `user-scalable=no`(index.html)라 브라우저 핀치줌이 꺼져 있어 **확대는 JS 제스처로 직접 구현**한다. iOS Safari 주 타깃 — Pointer Events(iOS 13+) + `touch-action: none` 사용, ADR-013 교훈(WebKit 취약 API 회피) 준수.

## 범위

포함: 이미지 크기/품질 상향, 재사용 전체화면 줌 뷰어, 보이는-영역 크롭(상세 화면에서), 상세 진입 배선.
범위 밖: **캡처 중 크롭(서브프로젝트 B)** — SP-A의 뷰어를 재사용해 별도 진행. 회전/필터/그리기 등 추가 편집.

## 컴포넌트

### 1. 이미지 크기·품질 상향 (`src/lib/image.ts`)

- `IMAGE_MAX_EDGE` 1600 → **3200**, `IMAGE_QUALITY` 0.7 → **0.8**. (사용자 합의)
- 파일 상단 doc 주석의 "긴 변 ~1600px, JPEG ~0.7 → 200–500KB" 갱신.
- 신규 캡처에만 적용(기존 캡처 불변). 용량 ~4배↑는 크롭으로 상쇄.
- `targetSize`는 그대로(긴 변 기준). 폰 원본이 3200 미만이면 업스케일하지 않음(현 동작 유지 — 화질 저하 방지).

### 2. 재사용 전체화면 줌 뷰어 (`src/lib/viewer.ts`, 신규) — 깊은 모듈

작은 인터페이스:
```ts
export interface ViewerOptions {
  onCrop?: (blob: Blob, width: number, height: number) => void; // 있으면 "자르기" 노출
}
export function openImageViewer(image: Blob, opts?: ViewerOptions): void;
```
- `document.body`에 다크 풀스크린 오버레이를 만들고, 닫힐 때 스스로 제거(+objectURL revoke).
- 내부 표시: `<img>`(object URL)를 `transform: translate()+scale()`로 변환. `touch-action: none`.
- **제스처(Pointer Events — 마우스/터치/펜 통합, iOS 13+):**
  - 활성 포인터를 Map으로 추적.
  - 1 포인터 드래그 → 팬(translate).
  - 2 포인터 → 핀치줌(거리비로 scale, 중점 기준). userScale ∈ [1, 6].
  - 더블탭/더블클릭 → scale 1 ↔ 약 2.5 토글(탭 지점 기준).
  - scale·translate 범위 클램프(이미지가 화면 밖으로 과도 이탈 방지).
- **컨트롤:** 좌상단 `✕`(닫기). `onCrop` 있으면 하단에 `✂︎ 보이는 영역으로 자르기`.
- **좌표 모델(크롭의 근거):**
  - `baseScale = min(vw/iw, vh/ih)`(contain), `eff = baseScale * userScale`.
  - 이미지 좌상단 화면좌표 `(ox, oy)`(센터링 + 팬 누적).
  - 화면점→원본픽셀: `sx = (vx - ox)/eff`, `sy = (vy - oy)/eff`.
  - 보이는 영역 = 화면 사각형 (0,0)~(vw,vh)를 역매핑 → 원본 사각형 `[sx0,sy0 .. sx1,sy1]`, `[0,iw]×[0,ih]`로 클램프.
- **크롭 재인코딩:** 원본 사각형을 canvas에 그려(긴 변 ≤ 3200로 다운스케일) `toBlob("image/jpeg", 0.8)` → `onCrop(blob, w, h)` 호출 후 뷰어 닫기.
- **이미지 로드:** ADR-013대로 `createImageBitmap`/`decode()` 금지 — `Image`+`onload`만 사용(별도 헬퍼 또는 `lib/pdf.ts`의 패턴 재사용). drawImage 소스로 그 `<img>` 사용.

### 3. 상세 화면 배선 (`src/screens/detail.ts`)

- `.detail__photo`(현재 background-image div) **탭 → `openImageViewer(cap.image, { onCrop })`**(이미지 있을 때만).
- `onCrop = async (blob, w, h) => { await updateCapture({ ...cap, image: blob, imageW: w, imageH: h, updatedAt: Date.now() }); cap.image=blob; cap.imageW=w; cap.imageH=h; /* 상세 썸네일 갱신 */ }`.
- 시각 힌트: 사진에 "탭하면 확대" 표시(작게) 또는 커서/aria.

### 4. 스타일 (`src/styles/app.css`)

- `.viewer`(고정 풀스크린, 다크 배경 `#000`/`#17171C`, z-index 최상위), `.viewer__img`(transform-origin 0 0), `.viewer__close`/`.viewer__crop`(≥48px 탭타깃, 하단 풀폭 파랑 `.btn-primary` 톤). reduced-motion 존중.

## 데이터 흐름

상세 사진 탭 → `openImageViewer(blob,{onCrop})` → (보기: 핀치줌/팬) → "자르기" → 보이는 영역 재인코딩 → `onCrop` → `updateCapture`로 교체 저장 → 뷰어 닫고 상세 갱신.

## 디자인 언어 준수

- 뷰어는 카메라처럼 **다크 풀스크린**(콘텐츠가 색). 컨트롤 최소, 마이크로카피 plain("보이는 영역으로 자르기", "닫기"). 스프링/페이드는 가볍게, reduced-motion 준수. 탭타깃 ≥48px.

## 에러 처리 / 엣지

- 이미지 로드 실패 → 오버레이에 안내 후 닫기(앱 깨지지 않음).
- 줌 안 한 상태(scale=1)에서 크롭 = 거의 전체(허용). 크롭 결과가 0폭/0높이면 무시.
- 데스크톱: 마우스 드래그=팬, 더블클릭=줌 토글(휠 줌은 선택). 포인터 통합이라 동작.
- 큰 원본(3200) canvas 크롭은 iOS 캔버스 한도(개별 ≤ ~16M px) 내 — 3200×3200=10.24M로 안전.

## 검증 (Verification)

테스트 프레임워크 없음 → `npm run build`(tsc) + `npm run preview` 수동 + 가능 시 `npm run test:pdf` 스타일 chromium 스모크.
1. `npm run build` 무에러.
2. preview(데스크톱): 새 캡처가 더 큰 해상도로 저장되는지(IndexedDB imageW/H 확인). 상세 사진 클릭 → 뷰어 열림, 더블클릭/드래그로 확대·이동, "자르기" → 상세 이미지가 잘린 영역으로 갱신.
3. **실기기(iPhone Safari) 필수**(ADR-013): 핀치줌·팬·크롭이 iOS에서 동작하는지. 헤드리스는 멀티터치 핀치 검증 불가 — 실기기로.
4. 크롭 후 Export PDF/백업에 새 이미지가 반영되는지.

## 미해결/주의

- 멀티터치 핀치는 헤드리스로 검증 어려움 → 실기기 확인을 검증 절차에 명시(ADR-013 패턴: 실패 시 화면에 에러 노출 고려).
- 용량 4배↑ → 백업 JSON·PDF 비대. 후속으로 백업 용량 경고/이미지 상한 옵션 검토(범위 밖).
- 크롭 좌표 클램프·관성 등 디테일은 구현 중 실기기로 튜닝.
