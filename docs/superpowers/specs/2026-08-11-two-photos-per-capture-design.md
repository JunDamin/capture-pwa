# 캡처당 사진 최대 2장 — 설계

날짜: 2026-08-11 · 결정 기록: ADR-020

## 문제

담고 싶은 글이 **페이지 아래쪽에서 끊겨 다음 페이지로 이어지는** 경우가 흔하다. 사진이 캡처당 0~1장이라 이런 글은 캡처를 둘로 쪼개 찍어야 했고, Export에서 AI는 두 캡처가 이어진 하나의 글이라는 사실을 알 방법이 없어 전사가 두 토막으로 나뉘었다.

## 목표

캡처 1건에 사진을 최대 2장 담고, 그 2장이 **같은 글의 앞/뒤**임을 PDF와 prompt.md 양쪽에 명시해 AI가 끊지 않고 하나의 원문으로 전사하게 한다.

비목표: 3장 이상, 임의의 사진 모음, 캡처 화면에서의 사진첩 선택(사진 모드는 촬영 전용 유지).

## 도메인

`Capture`의 사진은 슬롯 2개(`image`/`image2` + 각 `W`/`H`)로 저장하고, 소비는 전부 접근자를 통한다.

```ts
export const MAX_PHOTOS = 2;
export interface Photo { blob: Blob; width?: number; height?: number }
export function capturePhotos(c: Partial<PhotoSlots>): Photo[]   // 읽기
export function photoSlots(photos: Photo[]): PhotoSlots          // 저장 조립
```

`isValidCapture`의 "사진 있음" 판정은 `capturePhotos(...).length > 0`.

전면 배열화(`images: Photo[]`)를 채택하지 않은 이유는 ADR-020 §2에 기록. 요지는 마이그레이션 위험 회피 — DB는 버전 1 고정, 마이그레이션 인프라·테스트 그물 없음, 상한이 2로 고정.

## 화면

### 편집 시트 (`capture.ts`)

사진 슬롯 1개 → 가로 스트립. 버튼 노출 규칙:

| 사진 | 다시 찍기 | 사진 추가 |
|---|---|---|
| 0장 | 노출 | 숨김 |
| 1장 | 노출 | 노출 |
| 2장 | 숨김 | 숨김 (× 삭제로만 되돌림) |

- `사진 추가` = 사진을 지우지 않고 `closeEditor(false)`만 — 기존 `다시 찍기`의 "시트 하강 + 텍스트·태그 보존" 메커니즘 재사용. 힌트가 "이어지는 페이지를 담고 셔터를 누르세요"로 바뀐다.
- `다시 찍기` = 사진 **전부** 폐기 후 하강(현행 의미 유지).
- 슬롯별 `×` 삭제, 슬롯 탭 → 뷰어 재크롭(그 슬롯만 교체).
- 상태·렌더는 `pendingPhotos: PendingPhoto[]` + `renderEditorPhotos()` 한 경로로 수렴. objectURL은 렌더마다 전량 revoke.

**압축 결과 귀속**: 전역 `shotSeq` 비교는 2장 상태에서 오판하므로, 셔터 시점에 `{seq, blob:null}` 자리표를 꽂고 완료 시 `seq`로 자기 슬롯을 되찾는다. 슬롯이 사라졌으면 폐기, 실패면 자리표를 걷어내 무사진 강등.

**3초 루프**: 1장만 찍는 경로의 탭 수(태그+저장 2탭)와 셔터→시트 상승 동기 구간 불변. 계측은 `sizeKB` 합계 / `compressMs` 최댓값.

### 상세 화면 (`detail.ts`)

같은 스트립. 카메라가 없으므로 추가는 **숨은 파일 입력**(`accept="image/*"`) — iOS 네이티브 "사진 찍기 / 보관함" 시트. `compressImageFile()`이 촬영본과 같은 규격으로 정규화하며 디코드는 `Image`+`onload`만(ADR-013). 재크롭·삭제·추가는 저장 버튼을 기다리지 않고 즉시 반영. 마지막 사진 삭제로 내용이 하나도 남지 않게 되는 경우는 거부.

### 목록 (`review.ts`)

대표(첫 장) 썸네일만 렌더하고 2장은 뱃지로 알린다 — 목록에서 objectURL을 배로 늘리지 않는다.

## Export

번호 생성은 `exportModel.ts`에만 둔다(prompt.md ↔ PDF lockstep의 구조적 보장).

- 1장 → `capture-03.jpg` (현행 그대로)
- 2장 → `capture-03a.jpg` / `capture-03b.jpg`

`CaptureRow.fileName`/`hasImage` → `photos: PhotoRef[]`. 중복 계산되던 사진 장수는 `totalPhotoCount()`로 흡수.

**PDF**: 사진 1장당 1페이지. 2단 레이아웃은 사진이 절반으로 작아져 OCR 정확도를 깎으므로 채택하지 않았다. 둘째 장은 캡션 전문 대신 `capture-03a에서 이어짐 · 태그 · 시각` 한 줄만 싣고 사진 영역을 넓게 준다(캡션 예약 320px → 140px).

**프롬프트 v5**: 사진 2장인 캡처는 "두 장을 끊지 말고 이어 붙여 하나의 원문으로 전사하라, 페이지 경계에서 끊긴 문장은 자연스럽게 이어라, 출력 제목은 `capture-NN` 하나로".

## 호환

- DB 버전 1 유지(IDB 레코드는 스키마리스, 필드 추가만). 기존 레코드는 `image2` 없음 → 접근자가 1장 반환.
- 백업 번들 `version` 1 유지. `image2`가 없는 구버전 번들은 복원 시 자연히 null.

## 검증

`npm run build`(tsc strict) + `npm run test:pdf`(2장 픽스처 추가 — 페이지 수·파일명 lockstep 단언) + chromium 흐름 검증(편집 시트 사진 추가/삭제/저장, 상세 파일 입력 추가/삭제, 백업 왕복·구버전 번들).

**실기기(iOS Safari) 필수** — 헤드리스로 못 잡는 것:
- 파일 입력이 네이티브 사진 시트를 띄우고 HEIC 선택 시에도 `Image`+onload로 디코드되는지.
- 2장 캡처가 여러 개인 세션에서 PDF 생성이 메모리로 죽지 않는지(ADR-013/015 회귀 — 최대 위험).
- `사진 추가` 시 시트 하강/재상승 중 카메라가 끊기지 않는지.
