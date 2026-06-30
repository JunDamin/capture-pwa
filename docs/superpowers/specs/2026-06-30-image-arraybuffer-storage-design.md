# 이미지 저장: Blob → ArrayBuffer (iOS IDB-Blob 버그 수정) 설계 (spec)

날짜: 2026-06-30
관련: ADR-003(이미지 Blob 저장 — 본 건으로 개정), ADR-013(iOS WebKit), PRD §12

## Context

iPhone에서 Export PDF에 사진이 안 들어가는 근본 원인을 온디바이스 진단으로 확정:
**`FileReader` 읽기 시 `NotFoundError: The object can not be found here.`** — IndexedDB에 저장된 **Blob을 iOS Safari가 나중에 읽지 못하는 알려진 WebKit 버그**다(레코드는 남고 바이트가 사라짐). Android(Blink)는 정상 → 그래서 Android만 잘 됐다.

그동안 createImageBitmap·decode·onload·JPEG 직접삽입이 모두 실패한 진짜 이유 = **저장된 사진 Blob을 iOS에서 못 읽음**(PDF 코드가 아니라 저장 방식). ADR-003의 "이미지를 Blob으로 저장"이 iOS에서 깨진다.

## 결정

이미지를 IndexedDB에 **ArrayBuffer**로 저장한다(Blob 금지). iOS가 ArrayBuffer는 안정적으로 보관. 용량 추가 없음(base64 33% 회피). 변경은 **`src/db/db.ts`에 격리** — 앱의 다른 코드는 계속 `Capture.image: Blob | null`을 받는다.

## 설계 (db.ts 경계 변환)

`Capture.image`(소비자 타입)는 `Blob | null` 유지. 저장형만 ArrayBuffer.

```ts
// 저장형(IDB): image가 ArrayBuffer + imageType. (Capture 타입과 구분 — 내부 캐스팅)
async function blobToBuf(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b); });
}
async function toStored(c: Capture): Promise<unknown> {
  if (c.image instanceof Blob) {
    const buf = await blobToBuf(c.image);           // 생성 직후/Android 기존 Blob은 읽힘
    return { ...c, image: buf, imageType: c.image.type || "image/jpeg" };
  }
  return c; // image null
}
function fromStored(rec: any): Capture {
  if (rec && rec.image instanceof ArrayBuffer) {
    return { ...rec, image: new Blob([rec.image], { type: rec.imageType || "image/jpeg" }) };
  }
  return rec as Capture; // 옛 Blob 레코드(Android) 또는 null → 그대로
}
```

적용:
- `addCapture`/`updateCapture`: `put("captures", await toStored(c))`.
- `getCapture`: `fromStored(await get(...))`.
- `capturesForSession`/`allCaptures`: 결과 배열을 `map(fromStored)`.
- 정렬 등 기존 로직 유지(변환 후/전 무관, image만 바뀜).

## 마이그레이션 / 영향

- **비파괴, 양방향 호환:** 옛 Blob 레코드는 `fromStored`가 그대로 통과(Android 기존 사진 정상). 신규는 ArrayBuffer.
- **iOS 기존 사진:** iOS가 이미 못 읽으므로 복구 불가 — **새 캡처부터 정상**. (사용자 안내 필요)
- 소비자(detail/review/pdf/viewer/backup) **변경 없음** — 계속 Blob 수령. backup의 `blobToDataUrl`/`dataUrlToBlob`도 그대로(읽는 Blob이 fresh라 OK).
- PDF의 직접삽입(`blobToDataUrl` + `addImage`) 코드 그대로 — 이제 Blob이 읽히므로 동작.

## ADR

`docs/decisions.md`에 **ADR-015: 이미지 IDB 저장은 ArrayBuffer(Blob 금지) — iOS IDB-Blob 버그(NotFoundError) 회피**. ADR-003 개정 메모.

## 검증
- `npm run build` 무에러.
- preview(데스크톱): 새 캡처 → 저장형이 ArrayBuffer인지(IDB 확인), detail/review에 사진 표시, Export PDF에 사진 삽입(`npm run test:pdf` 통과).
- **iOS 실기기**(핵심): 새 캡처 → PDF에 사진 들어가는지. (기존 사진은 placeholder일 수 있음 — 새 캡처로 확인.)
- 백업→가져오기 라운드트립에 사진 유지.

## 미해결/주의
- 진단용 placeholder 에러 노출(c9407a9)은 이 수정 후에도 잠시 유지하다, 정상 확인되면 일반 문구로 되돌리기.
- iOS 기존 사진 복구 불가 안내.
