# 포스트모템 — iPhone Export PDF에 사진이 안 들어감

날짜: 2026-06-30 · 관련: ADR-013(iOS WebKit), ADR-015(이미지 ArrayBuffer 저장)

## 한 줄 요약

iPhone에서 Export PDF에 사진이 안 들어간 진짜 원인은 디코드·메모리·애플 정책이 아니라 **iOS Safari의 IndexedDB-Blob 버그**였다. IDB에 **Blob으로 저장하면 iOS가 나중에 그 바이트를 읽지 못한다**(`FileReader` → `NotFoundError: The object can not be found here.`). 해법은 이미지를 **ArrayBuffer로 저장**하고 읽을 때 `new Blob([buf])`로 복원하는 것.

## 증상

- Export PDF에서 모든 사진이 "(사진을 불러오지 못했어요 — 텍스트만 포함)" placeholder로 나옴.
- **iPhone에서만** 발생. **Android(Chrome)는 정상.**
- 여러 차례 "수정 배포"에도 iPhone PDF가 **매번 정확히 675.4KB(바이트 동일)**.

## 잘못 짚은 가설들 (그리고 왜 틀렸나)

1. **`createImageBitmap(blob)` 미지원** → Image+`decode()`로 교체. → 여전히 실패.
2. **`img.decode()`가 blob URL 거부(EncodingError)** → `Image`+`onload`만으로 교체. → 여전히 실패.
3. **PWA 동적 import 청크 깨짐** → jsPDF 정적 import. (이건 별개의 실제 버그였고 고친 게 맞음. 하지만 사진 문제의 원인은 아님.)
4. **iOS RAM 부족으로 3200px 풀 디코드 실패** → `createImageBitmap({resizeWidth})` 축소 디코드. → 여전히 실패.
5. **디코드 자체가 문제** → 디코드 없이 `jsPDF.addImage(JPEG)` 직접 삽입. → **여전히 실패.**
6. **iPhone PWA가 옛 서비스워커 캐시(stale)** → 빌드 버전 스탬프 추가로 확인. → **stale 아님**(스탬프가 갱신됨). 이 가설은 틀렸지만, 스탬프 덕분에 "새 코드인데도 실패"가 확정돼 진짜 원인으로 좁혀짐.

공통점: **이미지를 읽는 모든 방법이 실패** → 문제는 "어떻게 읽느냐"가 아니라 **"읽을 데이터 자체가 없다"**.

## 진짜 원인

`blobToDataUrl`(FileReader)이 던진 에러를 catch가 삼키고 있었다. 그 에러를 PDF placeholder에 노출하니:

> **NotFoundError: The object can not be found here.**

= iOS Safari가 **IndexedDB에 저장된 Blob의 백킹 데이터를 읽지 못함**(레코드는 남고 바이트는 사라짐). 알려진 WebKit 버그. Android(Blink)는 멀쩡해서 Android만 됐던 것. 캡처 시점엔 fresh Blob이라 멀쩡했고, **나중에 IDB에서 다시 읽을 때** 깨졌다.

## 해결

`src/db/db.ts` 경계에서 변환(ADR-015):
- **저장:** Blob → `ArrayBuffer`(+`imageType`)로 변환해 IDB에 저장. (생성 직후 Blob은 읽히므로 변환 가능.)
- **읽기:** `ArrayBuffer` → `new Blob([buf], {type})`로 복원. 앱의 나머지(detail/review/pdf/viewer/backup)는 계속 `Blob`을 받음 — 소비자 변경 0.
- 옛 Blob 레코드는 그대로 통과(Android 기존 사진 무사). **iOS 기존 사진은 이미 데이터 소실 → 복구 불가, 새 캡처부터 정상.**

## 결정타 — 무엇이 사건을 풀었나

1. **에러를 노출했다.** catch가 삼키던 실제 에러(`NotFoundError`)를 placeholder/토스트에 찍은 순간 원인이 드러났다. **swallow된 에러는 디버깅의 적.**
2. **버전 스탬프로 "stale vs 새 코드"를 분리했다.** "수정했는데 안 됨"이 "옛 버전인가? 새 버전인데도 실패인가?"로 갈리는데, 스탬프가 이걸 확정해줬다.
3. **바이트 단위 단서를 신뢰했다.** "매번 정확히 675.4KB" = 같은 코드가 도는 강력한 신호.

## 일반화할 교훈

- **한 엔진에서 됐다 ≠ 다른 엔진 보증.** 특히 iOS Safari(WebKit) ↔ Chrome(Blink). 모바일 핵심 경로(카메라·이미지·IDB·PDF·공유)는 WebKit에서 깨지기 쉽다.
- **iOS에서 IndexedDB에 Blob 저장 금지 → ArrayBuffer로 저장.** (이 프로젝트의 영구 규칙.)
- **읽기 방법을 N번 바꿔도 다 실패하면, 데이터/저장 계층을 의심하라.** 증상(읽기)이 아니라 소스(저장)가 원인일 수 있다.
- **온디바이스 진단을 만들어라.** 헤드리스/데스크톱이 재현 못 하는 버그(이 샌드박스의 WebHeadless는 RAM 충분·IDB 정상이라 재현 불가)는 **실기기에서 에러를 보이게** 만들어 진단한다(placeholder/토스트에 에러명·메시지).
- **swallow한 에러에 항상 메시지를 남겨라.** `catch {}`는 원인을 숨긴다.
- **배포물에 버전 스탬프.** PWA는 stale 캐시가 흔해 "고쳤는데 왜 안 되지"의 절반이 갱신 문제다 — 버전이 보이면 즉시 갈린다.

## 부산물(이 과정에서 생긴 실제 개선)

- jsPDF 정적 import(동적 import 청크 깨짐 수정).
- PDF 사진을 디코드 없이 `addImage(JPEG)` 직접 삽입(메모리 안전, 가설 5 — 원인은 아니었지만 더 견고한 코드).
- 홈 하단 빌드 버전 스탬프(상시 유지).
