# 인카메라 조절형 크롭 프레임 (D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 라이브 카메라에 가벼운 조절형 크롭 프레임을 띄우고, 셔터 1탭에 그 영역만 캡처해 저장한다(촬영 후 크롭 단계 제거). 프레임은 자유 비율·전역 지속(직전 값 기본).

**Architecture:** 신규 `lib/cropframe.ts`가 `.cam` 위 정규화(0..1) 오버레이 rect를 관리하고 localStorage에 지속. `lib/image.ts`에 크롭 인지 압축 추가. `capture.ts` 셔터는 이미 그리는 freeze 캔버스를 크롭 소스로 써(object-fit:cover 매핑) 프레임 영역만 압축·저장.

**Tech Stack:** Vanilla TS + Vite, Pointer Events, Canvas 2D, localStorage. 이미지 처리는 video→canvas(iOS-safe, createImageBitmap 미사용).

## Global Constraints
- **최우선 = 촬영 입장 간결함:** 셔터 1탭 흐름 불변, 프레임 안 만지면 직전 값으로 그냥 찍힘. 새 단계·확인·포커스 가로채기 없음. 오버레이는 시각적으로 가볍게(얇은 흰 선·작은 핸들·옅은 마스크).
- **크롭 소스 = freeze 캔버스**(capture.ts 셔터가 그리는 video→canvas). `grabFrame`의 `createImageBitmap` 의존 금지(ADR-013).
- **cover 매핑:** `scale=max(elW/vW,elH/vH)`, `offX=(vW*scale-elW)/2`, `offY=(vH*scale-elH)/2`; `sx=(rx*elW+offX)/scale`, `sy=(ry*elH+offY)/scale`, `sw=rw*elW/scale`, `sh=rh*elH/scale`; 0..vW/vH 클램프.
- 크롭 재인코딩 긴 변 ≤3200(IMAGE_MAX_EDGE)/JPEG(IMAGE_QUALITY). 이미지 저장은 db 경계가 ArrayBuffer로(ADR-015) — 이 기능은 Blob을 rec.image에 넣으면 됨.
- 프레임 z-index=2(영상 위, 컨트롤 .bottom z3·시트 아래). `is-frozen`·입력 모드에선 숨김. 핸들 hit-area ≥44px. 다크 유지, 파랑은 셔터/태그만.
- 정규화 rect는 뷰파인더(camEl.clientW/H) 기준. 최소 크기 w·h 각각 0.08 클램프, 0..1 클램프.
- 테스트 프레임워크 없음: 각 태스크 = `npm run build`(tsc strict) + (해당 시) `npm run test:pdf` + 커밋. 멀티터치/매핑은 preview(마우스)+iOS 실기기.

## File Structure
- `src/lib/image.ts` — `cropResizeCompress(...)` 추가(T1). 기존 `resizeCompress` 유지.
- `src/lib/cropframe.ts` (신규) — 오버레이 + rect 상태 + 지속(T2).
- `src/screens/capture.ts` — 프레임 마운트 + 셔터 크롭 소스/매핑(T3).
- `src/styles/app.css` — 오버레이 스타일(T2에서 추가, T3에서 보정 가능).

---

### Task 1: 크롭 인지 압축 (`src/lib/image.ts`)

**Files:**
- Modify: `src/lib/image.ts`

**Interfaces:**
- Consumes: 기존 `IMAGE_MAX_EDGE`, `IMAGE_QUALITY`, `targetSize(w,h,maxEdge)`, `toBlob` 패턴.
- Produces: `cropResizeCompress(source: CanvasImageSource, srcW: number, srcH: number, cropPx: { sx: number; sy: number; sw: number; sh: number }, maxEdge?: number, quality?: number): Promise<{ blob: Blob; width: number; height: number }>`.

- [ ] **Step 1: 현 image.ts 확인**

`resizeCompress`/`targetSize`/`toBlob`/`IMAGE_MAX_EDGE`/`IMAGE_QUALITY`의 실제 시그니처·기본값을 읽어 맞춘다.

- [ ] **Step 2: cropResizeCompress 추가**

```typescript
/**
 * source(예: 셔터의 freeze 캔버스)의 cropPx 영역만 잘라 긴 변 ≤maxEdge로 축소·JPEG.
 * width/height = 크롭 후 출력 픽셀 크기.
 */
export async function cropResizeCompress(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  cropPx: { sx: number; sy: number; sw: number; sh: number },
  maxEdge = IMAGE_MAX_EDGE,
  quality = IMAGE_QUALITY,
): Promise<{ blob: Blob; width: number; height: number }> {
  // 크롭 px 클램프(소스 경계 안)
  const sx = Math.max(0, Math.min(cropPx.sx, srcW));
  const sy = Math.max(0, Math.min(cropPx.sy, srcH));
  const sw = Math.max(1, Math.min(cropPx.sw, srcW - sx));
  const sh = Math.max(1, Math.min(cropPx.sh, srcH - sy));
  const t = targetSize(sw, sh, maxEdge); // 크롭 영역 기준 다운스케일
  const canvas = document.createElement("canvas");
  canvas.width = t.w;
  canvas.height = t.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d ctx 없음");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, t.w, t.h);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", quality),
  );
  canvas.width = 0;
  canvas.height = 0; // 백킹스토어 해제
  return { blob, width: t.w, height: t.h };
}
```
(`targetSize`가 `{w,h}`를 반환하지 않거나 인자가 다르면 현 구현에 맞춰 조정. 목표: 크롭 영역의 긴 변을 maxEdge로.)

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: 타입에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/lib/image.ts
git commit -m "feat: cropResizeCompress — 소스 영역 크롭+축소 압축"
```

---

### Task 2: 크롭 프레임 오버레이 모듈 + CSS (`src/lib/cropframe.ts`, `src/styles/app.css`)

**Files:**
- Create: `src/lib/cropframe.ts`
- Modify: `src/styles/app.css`

**Interfaces:**
- Produces:
  - `interface CropRect { x: number; y: number; w: number; h: number }` (뷰파인더 기준 0..1)
  - `function loadCropRect(): CropRect` (localStorage 또는 기본값)
  - `interface CropFrame { getRect(): CropRect; destroy(): void }`
  - `function mountCropFrame(camEl: HTMLElement): CropFrame`

- [ ] **Step 1: 모듈 작성**

`src/lib/cropframe.ts` 생성:
```typescript
export interface CropRect { x: number; y: number; w: number; h: number } // 0..1, 뷰파인더 기준

const LS_KEY = "capture.cropFrame";
const DEFAULT_RECT: CropRect = { x: 0.06, y: 0.25, w: 0.88, h: 0.38 };
const MIN = 0.08;

export function loadCropRect(): CropRect {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_RECT };
    const r = JSON.parse(raw);
    if (typeof r?.x === "number" && typeof r?.y === "number" && typeof r?.w === "number" && typeof r?.h === "number")
      return clampRect(r);
  } catch { /* 무시 */ }
  return { ...DEFAULT_RECT };
}
function saveCropRect(r: CropRect): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(r)); } catch { /* 용량/사생활 모드 무시 */ }
}
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function clampRect(r: CropRect): CropRect {
  const w = Math.max(MIN, Math.min(r.w, 1));
  const h = Math.max(MIN, Math.min(r.h, 1));
  const x = Math.max(0, Math.min(r.x, 1 - w));
  const y = Math.max(0, Math.min(r.y, 1 - h));
  return { x, y, w, h };
}

export interface CropFrame { getRect(): CropRect; destroy(): void }

export function mountCropFrame(camEl: HTMLElement): CropFrame {
  let rect = loadCropRect();
  // 오버레이 DOM: 박스 + 4 마스크 + 8 핸들(4모서리·4변)
  const overlay = document.createElement("div");
  overlay.className = "cropframe";
  overlay.innerHTML = `
    <div class="cropframe__mask cf-top"></div><div class="cropframe__mask cf-bottom"></div>
    <div class="cropframe__mask cf-left"></div><div class="cropframe__mask cf-right"></div>
    <div class="cropframe__box">
      ${["nw","n","ne","e","se","s","sw","w"].map((h) => `<div class="cropframe__handle h-${h}" data-h="${h}"></div>`).join("")}
    </div>`;
  camEl.appendChild(overlay);
  const box = overlay.querySelector(".cropframe__box") as HTMLElement;
  const mTop = overlay.querySelector(".cf-top") as HTMLElement;
  const mBottom = overlay.querySelector(".cf-bottom") as HTMLElement;
  const mLeft = overlay.querySelector(".cf-left") as HTMLElement;
  const mRight = overlay.querySelector(".cf-right") as HTMLElement;

  function render() {
    const W = camEl.clientWidth, H = camEl.clientHeight;
    const l = rect.x * W, t = rect.y * H, w = rect.w * W, h = rect.h * H;
    box.style.left = `${l}px`; box.style.top = `${t}px`;
    box.style.width = `${w}px`; box.style.height = `${h}px`;
    mTop.style.cssText = `left:0;top:0;width:100%;height:${t}px`;
    mBottom.style.cssText = `left:0;top:${t + h}px;width:100%;bottom:0`;
    mLeft.style.cssText = `left:0;top:${t}px;width:${l}px;height:${h}px`;
    mRight.style.cssText = `left:${l + w}px;top:${t}px;right:0;height:${h}px`;
  }

  // 포인터: 핸들=resize(반대변 고정), 박스 내부=move. 단일 포인터.
  let mode: "" | "move" | string = "";
  let startX = 0, startY = 0, startRect: CropRect = rect, pid = -1;
  function onDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    const handle = target.dataset.h;
    if (handle) mode = handle;
    else if (target === box) mode = "move";
    else return;
    pid = e.pointerId; startX = e.clientX; startY = e.clientY; startRect = { ...rect };
    overlay.setPointerCapture?.(pid);
    e.preventDefault(); e.stopPropagation();
  }
  function onMove(e: PointerEvent) {
    if (mode === "" || e.pointerId !== pid) return;
    const W = camEl.clientWidth, H = camEl.clientHeight;
    const dx = (e.clientX - startX) / W, dy = (e.clientY - startY) / H;
    let { x, y, w, h } = startRect;
    if (mode === "move") { x = startRect.x + dx; y = startRect.y + dy; }
    else {
      if (mode.includes("w")) { x = startRect.x + dx; w = startRect.w - dx; }
      if (mode.includes("e")) { w = startRect.w + dx; }
      if (mode.includes("n")) { y = startRect.y + dy; h = startRect.h - dy; }
      if (mode.includes("s")) { h = startRect.h + dy; }
      if (w < MIN) { if (mode.includes("w")) x = startRect.x + startRect.w - MIN; w = MIN; }
      if (h < MIN) { if (mode.includes("n")) y = startRect.y + startRect.h - MIN; h = MIN; }
    }
    rect = clampRect({ x, y, w, h });
    render();
    e.preventDefault();
  }
  function onUp(e: PointerEvent) {
    if (e.pointerId !== pid) return;
    mode = ""; pid = -1; saveCropRect(rect);
  }
  overlay.addEventListener("pointerdown", onDown);
  overlay.addEventListener("pointermove", onMove);
  overlay.addEventListener("pointerup", onUp);
  overlay.addEventListener("pointercancel", onUp);
  window.addEventListener("resize", render);
  render();

  return {
    getRect: () => rect,
    destroy: () => {
      window.removeEventListener("resize", render);
      overlay.remove();
    },
  };
}
```

- [ ] **Step 2: CSS (간결·z2·표시규칙)**

`src/styles/app.css`에 추가(다크 위 가볍게):
```css
.cropframe { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.cropframe__mask { position: absolute; background: rgba(0,0,0,0.28); pointer-events: none; }
.cropframe__box { position: absolute; border: 1.5px solid rgba(255,255,255,0.95); box-sizing: border-box; pointer-events: auto; }
.cropframe__handle { position: absolute; width: 44px; height: 44px; pointer-events: auto; }
.cropframe__handle::after { content: ""; position: absolute; inset: 16px; border: 2px solid #fff; border-radius: 2px; }
.cropframe__handle.h-nw { left: -22px; top: -22px; } .cropframe__handle.h-n { left: 50%; top: -22px; transform: translateX(-50%); }
.cropframe__handle.h-ne { right: -22px; top: -22px; } .cropframe__handle.h-e { right: -22px; top: 50%; transform: translateY(-50%); }
.cropframe__handle.h-se { right: -22px; bottom: -22px; } .cropframe__handle.h-s { left: 50%; bottom: -22px; transform: translateX(-50%); }
.cropframe__handle.h-sw { left: -22px; bottom: -22px; } .cropframe__handle.h-w { left: -22px; top: 50%; transform: translateY(-50%); }
.cam.is-frozen .cropframe { display: none; }
```
(입력 모드 숨김 규칙은 T3에서 실제 모드 클래스 확인 후 추가.)

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: 타입에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cropframe.ts src/styles/app.css
git commit -m "feat: cropframe.ts — 라이브 카메라 조절형 크롭 프레임 오버레이 + 지속"
```

---

### Task 3: 카메라 연결 — 프레임 마운트 + 셔터 크롭 (`src/screens/capture.ts`, `src/styles/app.css`)

**Files:**
- Modify: `src/screens/capture.ts`, `src/styles/app.css`

**Interfaces:**
- Consumes: `mountCropFrame`/`CropFrame`(T2), `cropResizeCompress`(T1), 기존 셔터/저장 핸들러, `.cam` 요소, `video`.

구현자는 **현재 `capture.ts`를 먼저 읽고**(셔터 핸들러 capture.ts:154-182의 freeze 캔버스 생성, 저장 핸들러의 `if (frame) { resizeCompress(frame) ... }` 블록, `startCam`, cleanup, 입력/사진 모드 클래스) 적용한다.

- [ ] **Step 1: import + 프레임 마운트**

`import { mountCropFrame, type CropFrame } from "../lib/cropframe.ts";` 및 `import { cropResizeCompress } from "../lib/image.ts";`(기존 image import에 추가).
`let cropFrame: CropFrame | null = null;` 선언. 카메라 시작 직후(예: `startCam()`에서 `await startCamera(video)` 뒤)에 `cropFrame = mountCropFrame(cam);`(`cam`은 `.cam` 요소). cleanup에서 `cropFrame?.destroy(); cropFrame = null;`.

- [ ] **Step 2: 셔터 — freeze 캔버스 보관**

셔터 핸들러에서 이미 만드는 캔버스(capture.ts:163-166)를 바깥 스코프 변수에 보관:
`let freezeCanvas: HTMLCanvasElement | null = null;`(run 스코프) 선언 후, 셔터에서 `const canvas = ...; ... canvas.getContext("2d")?.drawImage(video,0,0); freezeCanvas = canvas;`.

- [ ] **Step 3: 저장 — 프레임 영역만 크롭**

저장 핸들러의 `if (frame) { const {blob,width,height} = await resizeCompress(frame); ... }` 블록을 freeze 캔버스 + 크롭 매핑으로 교체:
```typescript
if (freezeCanvas) {
  const vW = freezeCanvas.width, vH = freezeCanvas.height;
  const elW = cam.clientWidth || vW, elH = cam.clientHeight || vH;
  const r = cropFrame ? cropFrame.getRect() : { x: 0, y: 0, w: 1, h: 1 };
  let cropPx: { sx: number; sy: number; sw: number; sh: number };
  if (vW > 0 && vH > 0) {
    const scale = Math.max(elW / vW, elH / vH);
    const offX = (vW * scale - elW) / 2, offY = (vH * scale - elH) / 2;
    cropPx = {
      sx: (r.x * elW + offX) / scale,
      sy: (r.y * elH + offY) / scale,
      sw: (r.w * elW) / scale,
      sh: (r.h * elH) / scale,
    };
  } else {
    cropPx = { sx: 0, sy: 0, sw: vW, sh: vH }; // 풀프레임 폴백
  }
  try {
    const { blob, width, height } = await cropResizeCompress(freezeCanvas, vW, vH, cropPx);
    rec.image = blob;
    rec.imageW = width;
    rec.imageH = height;
    rec.updatedAt = Date.now();
    await addCapture(rec);
  } catch {
    /* 이미지 실패해도 메타 캡처는 유효 */
  }
  freezeCanvas = null;
}
```
- 기존 `frame`(grabFrame/ImageBitmap) 사용처는 정리: 셔터의 `grabFrame` 호출과 `frame.close?.()`는 더 이상 크롭 소스가 아님. **사진 저장 경로가 `freezeCanvas`만 쓰도록** 하고, 빈 캡처 가드(`if (!frame && !memoVal) return;`)는 `if (!freezeCanvas && !memoVal) return;`로 바꾼다(프레임 없이 메모만도 유효 — ADR-014). `grabFrame` 호출 자체는 제거 가능(freeze 캔버스로 대체) — 제거 시 import도 정리.
- **3초 루프 불변 확인:** 셔터는 여전히 1탭, 크롭 매핑은 동기 ~0ms, 압축은 `saveSw.stop()` 이후(예산 밖).

- [ ] **Step 4: 입력 모드 숨김 CSS**

`capture.ts`/CSS에서 입력 모드 실제 클래스(예: `.cam.mode--input` 또는 사진/입력 토글 클래스)를 확인해 `app.css`에 `<실제선택자> .cropframe { display: none; }` 추가. (사진 모드에서만 프레임 보이게.)

- [ ] **Step 5: 빌드 + 스모크 + 확인**

Run: `npm run build` → 에러 없음. `npm run test:pdf` → PASS(이미지 경로 회귀 없음).
(preview 데스크톱: 라이브에 가벼운 프레임; 안 만지고 셔터 → 직전 프레임으로 크롭 저장; 핸들/이동 후 셔터 → 그 영역만; detail에서 결과·매핑 확인(좌/우/상/하 치우친 프레임); 새로고침 후 직전 프레임 유지.)

- [ ] **Step 6: Commit**

```bash
git add src/screens/capture.ts src/styles/app.css
git commit -m "feat: 셔터 시 인카메라 프레임 영역만 크롭 저장(freeze 캔버스+cover 매핑)"
```

---

## Self-Review
**1. Spec coverage:** cropResizeCompress → T1; cropframe 오버레이+지속+회전 → T2; 카메라 마운트+freeze 캔버스 크롭+cover 매핑+입력모드 숨김 → T3. 간결 제약(1탭 불변)·z2·is-frozen 숨김·기본 rect{y0.25,h0.38}·최소클램프 모두 반영 ✓.
**2. Placeholder scan:** T1/T2 구체 코드. T3은 "현 파일 먼저 읽기" + 구체 코드·매핑(변수명/모드 클래스만 현 코드 확인 — 의도적). CSS 구체값. ✓
**3. Type consistency:** `cropResizeCompress(source,srcW,srcH,cropPx,maxEdge?,quality?)→{blob,width,height}`(T1) ↔ T3 호출 일치. `mountCropFrame(camEl)→CropFrame{getRect():CropRect,destroy()}`(T2) ↔ T3 사용 일치. `CropRect{x,y,w,h}` 0..1 일관. ✓

## 참고
- 멀티터치 없음(단일 포인터 resize/move) — preview 마우스로 검증 가능, 셔터 1탭·매핑은 iOS 실기기 마무리 확인.
- `grabFrame`(createImageBitmap)은 이 경로에서 freeze 캔버스로 대체 — 별도 정리 대상이나 이 기능을 막지 않음.
- detail 사후 크롭은 그대로 유지(미세조정).
