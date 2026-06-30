# 인카메라 조절형 크롭 프레임 (D) 설계 (spec)

날짜: 2026-06-30
관련: ADR-013(iOS WebKit·이미지 onload), 캡처 3초 루프 예산(PRD §16/ADR-011), design-language.md, 조절형 크롭 박스(viewer.ts)
선행: A+B+C 배치 머지 완료(main).

## Context

지금은 촬영 후 detail에서 크롭한다(별도 단계). 책 페이지는 가로로 길어 의미 영역만 담고 싶다. **카메라 라이브에 조절형 크롭 프레임을 띄워, 셔터 시 그 영역만 캡처**하면 촬영 후 크롭 단계를 없앨 수 있다. 기본값은 직전 촬영 때 조정한 프레임.

## 결정 (확정)

- **자유 비율** 프레임(모서리·변 자유 조절). **전역 지속**(localStorage — 세션·앱 재시작에도 직전 값 기본).
- 인카메라 프레임이 **주 크롭** → 촬영 후 크롭 단계 제거. detail 크롭박스는 **사후 미세조정용으로 유지**. 전체를 담으려면 프레임을 가장자리까지 넓히면 됨(별도 토글 없음).

## 최우선 구속 제약 — "촬영 입장에서 간결함"

> 입력(촬영)하는 사람 관점의 **간결함이 최우선.** 아래는 타협 불가.

- **기본 흐름 불변: 셔터 1탭으로 촬영.** 프레임 조절은 **선택**(안 만지면 직전 값으로 그냥 찍힘). 새 단계·확인·포커스 가로채기 없음.
- 프레임은 **시각적으로 가볍게**: 얇은 흰 선, 작은 핸들, **옅은** 바깥 마스크(영상 가림 최소). 뷰파인더가 답답해선 안 됨.
- 3초 루프 예산(ADR-011): 셔터→크롭→저장의 앱 개입은 기존과 동급(크롭은 캔버스 1회 drawImage라 저렴). 측정 가능하면 `appMs` 회귀 없게.

## 컴포넌트 / 변경

### 1. `src/lib/cropframe.ts` (신규) — 라이브 오버레이 + rect 상태 + 지속
영상은 정지(팬/핀치 없음)라 viewer.ts보다 단순 — 핸들 리사이즈 + 박스 드래그 이동만(핀치/줌 없음).
```ts
export interface CropRect { x: number; y: number; w: number; h: number } // 뷰파인더 기준 0..1
export interface CropFrame {
  getRect(): CropRect;       // 현재 정규화 rect
  destroy(): void;           // 리스너/DOM 정리
}
// camEl(.cam) 위에 오버레이를 붙이고 포인터로 조절. pointerup마다 localStorage 저장.
export function mountCropFrame(camEl: HTMLElement): CropFrame;
export function loadCropRect(): CropRect;   // localStorage 또는 기본값
```
- 상태: rect 0..1(뷰파인더 clientW/H 기준). pointerdown이 핸들이면 resize(반대변 고정, 최소 크기 **w·h 각각** 클램프 예: 0.08, 0..1 클램프), 박스 내부면 move, 매 변경 `renderFrame()`. pointerup에 `saveCropRect(rect)`.
- 마스크: 박스 바깥 4개 dim div(옅게) 또는 box-shadow.
- **회전 대응(검토 C):** `window.addEventListener("resize", renderFrame)`(또는 camEl ResizeObserver)로 방향 전환 시 DOM 오버레이 px 재계산. `destroy()`에서 해제. 정규화 rect 자체는 불변(뷰파인더 기준).
- `elW/elH`는 **상호작용 시점에 lazy로** `camEl.clientWidth/Height` 읽기(마운트 시점 0 회피).

### 2. `src/lib/image.ts` — 크롭 인지 압축 추가
```ts
// source(비디오 프레임)의 정규화 rect(영상 기준)만 잘라 긴 변 ≤maxEdge로 축소·JPEG.
export async function cropResizeCompress(
  source: CanvasImageSource, srcW: number, srcH: number,
  cropPx: { sx: number; sy: number; sw: number; sh: number },
  maxEdge = IMAGE_MAX_EDGE, quality = IMAGE_QUALITY,
): Promise<{ blob: Blob; width: number; height: number }>;
```
- 캔버스에 `drawImage(source, sx,sy,sw,sh, 0,0,dw,dh)`로 크롭+다운스케일 → `toBlob` jpeg. 기존 `resizeCompress`는 유지.

### 3. `src/screens/capture.ts` — 라이브에 프레임 + 셔터 시 크롭
- 카메라 시작 후 `mountCropFrame(cam)`; cleanup에서 `destroy()`.
- **크롭 소스 = freeze 캔버스(검토 A, 중요):** 셔터 핸들러는 이미 풀 영상을 캔버스에 그린다(capture.ts:163-166 `canvas.drawImage(video,0,0)`, iOS-safe). 이 캔버스를 `let freezeCanvas: HTMLCanvasElement | null = canvas`로 보관해 **크롭 소스로 재사용**한다 — `grabFrame`의 `createImageBitmap`(iOS 취약, ADR-013) 의존을 피하고 재작업도 없앤다. (`grabFrame` 자체 정리는 별건 — 이 기능에서 막지 않음.)
- **셔터/저장:** 저장 시 `resizeCompress(frame)` 대신 `freezeCanvas`를 크롭 소스로:
  - 프레임 rect(뷰파인더 0..1)를 **object-fit: cover 변환**으로 영상 픽셀 rect로:
    `scale = max(elW/vW, elH/vH)`; `dispW=vW*scale, dispH=vH*scale`; `offX=(dispW-elW)/2, offY=(dispH-elH)/2`;
    영상픽셀 `sx=(rect.x*elW+offX)/scale`, `sy=(rect.y*elH+offY)/scale`, `sw=rect.w*elW/scale`, `sh=rect.h*elH/scale` (0..vW/vH 클램프).
  - `cropResizeCompress(freezeCanvas, vW, vH, {sx,sy,sw,sh})` → blob/width/height → rec.image/imageW/imageH(ArrayBuffer 저장은 db 경계가 처리, ADR-015).
  - `elW/elH` = `video.clientWidth/clientHeight`(또는 `.cam` 박스). videoW/H = `video.videoWidth/Height`. (셔터 시점엔 영상 준비됨 — 타이밍 안전.)
- 입력 모드엔 프레임 없음(사진 모드만).

### 4. `src/styles/app.css` — 오버레이(간결)
- `.cropframe`(얇은 흰 테두리), `.cropframe__handle`(작게, hit-area ≥44px), `.cropframe__mask`(옅은 dim). 다크 위에서 최소한으로.
- **z-index = 2**(영상/freeze 위, 컨트롤(.bottom z3)·시트 아래). 핸들 `pointer-events:auto`.
- **표시 규칙(검토 B):** 라이브에서만 보이게 —
  ```css
  .cam.is-frozen .cropframe { display: none; }   /* 동결(태그·노트) 중 숨김 */
  /* 입력 모드 클래스(현 코드 확인 후): */ .cam.mode--input .cropframe { display: none; }
  ```
  (입력 모드 실제 클래스명은 구현자가 capture.ts/CSS에서 확인해 맞춤.)
- **z2 한계(검토 D):** 기본 프레임 하단은 컨트롤(.bottom z3) 위로 가지 않게 잡음 — 하단 핸들이 컨트롤 영역과 겹치면 닿지 않을 수 있음(셔터 항상 닿게 하기 위한 의도적 트레이드오프). 사용자는 상단·좌우·박스 이동으로 조절.

## 데이터/지속
- `localStorage["capture.cropFrame"]` = `{x,y,w,h}`(0..1). 없으면 기본 = 가로 넓은 밴드 **`{x:0.06,y:0.25,w:0.88,h:0.38}`**(하단 0.63 — 컨트롤 영역 회피, 검토 D). 파싱 실패 시 기본. (코드베이스 첫 localStorage 사용 — iOS standalone PWA 지속 OK.)

## 에러/엣지
- `grabFrame` 실패(frame null): 기존과 동일 — 이미지 없이 메타만 저장(텍스트 캡처). 크롭 시도 안 함.
- 프레임이 너무 작음: 최소 크기 클램프(예: 뷰파인더의 0.08). 매핑 rect는 0..vW/vH 클램프.
- `videoWidth=0`(웜업 전): 셔터는 phase==="live"에서만 → 영상 준비 후. 방어적으로 vW/vH 0이면 풀프레임 폴백.
- 멀티터치/실기기: 헤드리스 불가 → iOS 실기기 검증(ADR-013). 이미지 로드 규칙 무관(여긴 video+canvas).

## 디자인 언어
- 카메라만 다크 풀블리드 유지. 프레임은 무채(흰 선)·옅은 마스크. 파랑은 셔터/태그에서만. 마이크로카피 추가 거의 없음(프레임은 무문구). 탭타깃 핸들 ≥44px.

## 영향 파일
`src/lib/cropframe.ts`(신규), `src/lib/image.ts`(cropResizeCompress), `src/screens/capture.ts`(프레임 마운트+셔터 크롭), `src/styles/app.css`(오버레이).

## 검증
테스트 프레임워크 없음 → `npm run build` + preview(데스크톱 마우스로 핸들/이동·매핑 확인) + **iOS 실기기**(터치 조절, 셔터 1탭 속도, 크롭 결과, 직전 값 유지).
1. `npm run build` 무에러.
2. preview: 라이브에 가벼운 프레임; 안 만지고 셔터 → 직전 프레임으로 크롭 저장; 핸들/박스 조절 후 셔터 → 그 영역만; detail에서 결과 확인. 새로고침 후에도 직전 프레임 유지(localStorage).
3. 매핑 정확성: 프레임 영역과 저장 이미지가 일치(cover 변환 검증) — preview에서 좌우/상하 치우친 프레임으로 확인.
4. 3초 루프: 셔터 1탭 흐름·체감 속도 회귀 없음.

## 미해결/주의
- detail 사후 크롭은 그대로(중복 아님 — 미세조정). 추후 "프레임 초기화" 버튼이 필요하면 별도.
- 가로/세로 회전 시 정규화 프레임 재적용(뷰파인더 기준) — 실기기 확인.
- cover 매핑이 이 기능의 핵심 리스크 → 구현 시 preview로 좌/우/상/하 치우친 케이스 꼭 검증.
