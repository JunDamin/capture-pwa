# 큰 이미지 + 줌 뷰어 + 크롭 (SP-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캡처 이미지를 더 크게 저장하고(3200/0.8), 상세 사진을 전체화면에서 핀치줌·팬으로 확대해 읽고, 보이는 영역으로 크롭해 저장한다.

**Architecture:** `lib/image.ts` 상수 상향. 신규 재사용 모듈 `lib/viewer.ts`의 `openImageViewer(blob, {onCrop})`가 다크 풀스크린 오버레이 + Pointer Events 핀치줌/팬 + 보이는-영역 크롭 재인코딩을 담당. `screens/detail.ts`가 사진 탭에서 뷰어를 열고 크롭 결과를 `updateCapture`로 저장.

**Tech Stack:** Vanilla TS + Vite, Canvas 2D, Pointer Events. 이미지 로드는 ADR-013대로 `Image`+`onload`만(createImageBitmap·decode 금지).

## Testing approach (이 저장소 적응)

테스트 프레임워크 없음. 각 태스크 검증 = `npm run build`(tsc) + `npm run preview` 수동 + 커밋. **멀티터치 핀치줌은 헤드리스로 검증 불가 → iOS 실기기 확인을 별도 명시**(ADR-013).

## Global Constraints

- 이미지 로드: `createImageBitmap`·`img.decode()` 금지 → `Image`+`onload`/`onerror`만(ADR-013).
- 뷰포트 `user-scalable=no` → 확대는 JS 제스처로 직접. 오버레이에 `touch-action: none`.
- 다크 풀스크린(콘텐츠가 색), 마이크로카피 plain("보이는 영역으로 자르기","닫기"), 탭타깃 ≥48px, `prefers-reduced-motion` 존중.
- 크롭 재인코딩: 긴 변 ≤ 3200, JPEG 0.8.
- iOS Safari 주 타깃 — 실기기 검증 필수.

---

### Task 1: 이미지 크기·품질 상향 (`src/lib/image.ts`)

**Files:**
- Modify: `src/lib/image.ts`

**Interfaces:**
- Produces: `IMAGE_MAX_EDGE = 3200`, `IMAGE_QUALITY = 0.8` (기존 export 유지, 값만 변경).

- [ ] **Step 1: 상수 + 주석 갱신**

`src/lib/image.ts` 상단 교체:

```typescript
/**
 * 이미지 리사이즈 + 압축 — ADR-003.
 * 긴 변 ~3200px, JPEG ~0.8 → 책 글씨 가독 우선(확대/크롭 대비). 원본 미보관.
 * 저장 직후 백그라운드에서 호출하여 카메라 복귀를 막지 않는다.
 */

export const IMAGE_MAX_EDGE = 3200;
export const IMAGE_QUALITY = 0.8;
```

- [ ] **Step 2: 빌드**

Run: `npm run build`
Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/lib/image.ts
git commit -m "feat: 캡처 이미지 3200/0.8로 상향(가독성)"
```

---

### Task 2: 전체화면 줌 뷰어 + 크롭 (`src/lib/viewer.ts`)

**Files:**
- Create: `src/lib/viewer.ts`
- Modify: `src/styles/app.css` (뷰어 스타일 추가)

**Interfaces:**
- Produces: `interface ViewerOptions { onCrop?: (blob: Blob, width: number, height: number) => void }`; `openImageViewer(image: Blob, opts?: ViewerOptions): void`.

- [ ] **Step 1: `src/lib/viewer.ts` 작성**

```typescript
/** 전체화면 이미지 뷰어 — 핀치줌/팬(Pointer Events) + 보이는 영역 크롭. ADR-013(이미지 로드 onload만). */
const MAX_EDGE = 3200;
const QUALITY = 0.8;
const MAX_SCALE = 6;

export interface ViewerOptions {
  onCrop?: (blob: Blob, width: number, height: number) => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

export function openImageViewer(image: Blob, opts: ViewerOptions = {}): void {
  const url = URL.createObjectURL(image);
  const overlay = document.createElement("div");
  overlay.className = "viewer";
  overlay.innerHTML = `
    <img class="viewer__img" alt="" />
    <button class="viewer__close" aria-label="닫기">✕</button>
    ${opts.onCrop ? `<button class="viewer__crop btn-primary">✂︎ 보이는 영역으로 자르기</button>` : ""}
  `;
  document.body.appendChild(overlay);
  const imgEl = overlay.querySelector(".viewer__img") as HTMLImageElement;

  let iw = 0;
  let ih = 0;
  let baseScale = 1;
  let userScale = 1;
  let ox = 0; // 이미지 좌상단 화면 x
  let oy = 0;

  const vw = () => overlay.clientWidth;
  const vh = () => overlay.clientHeight;

  function fit() {
    baseScale = Math.min(vw() / iw, vh() / ih);
    userScale = 1;
    const eff = baseScale * userScale;
    ox = (vw() - iw * eff) / 2;
    oy = (vh() - ih * eff) / 2;
    apply();
  }
  function apply() {
    const eff = baseScale * userScale;
    imgEl.style.transformOrigin = "0 0";
    imgEl.style.transform = `translate(${ox}px, ${oy}px) scale(${eff})`;
  }
  function clamp() {
    const eff = baseScale * userScale;
    const dw = iw * eff;
    const dh = ih * eff;
    // 화면보다 크면 가장자리 밖으로 못 나가게, 작으면 가운데로
    if (dw <= vw()) ox = (vw() - dw) / 2;
    else ox = Math.min(0, Math.max(vw() - dw, ox));
    if (dh <= vh()) oy = (vh() - dh) / 2;
    else oy = Math.min(0, Math.max(vh() - dh, oy));
  }

  // --- Pointer Events: 팬 + 핀치 ---
  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; cx: number; cy: number } | null = null;

  overlay.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    overlay.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) pinch = startPinch();
  });
  overlay.addEventListener("pointermove", (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      ox += e.clientX - prev.x;
      oy += e.clientY - prev.y;
      clamp();
      apply();
    } else if (pts.size === 2 && pinch) {
      const arr = [...pts.values()];
      const dist = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      const cx = (arr[0].x + arr[1].x) / 2;
      const cy = (arr[0].y + arr[1].y) / 2;
      const factor = dist / pinch.dist;
      zoomAt(cx, cy, factor);
      pinch = { dist, cx, cy };
    }
  });
  function endPointer(e: PointerEvent) {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
  }
  overlay.addEventListener("pointerup", endPointer);
  overlay.addEventListener("pointercancel", endPointer);

  function startPinch() {
    const arr = [...pts.values()];
    return {
      dist: Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y),
      cx: (arr[0].x + arr[1].x) / 2,
      cy: (arr[0].y + arr[1].y) / 2,
    };
  }
  function zoomAt(cx: number, cy: number, factor: number) {
    const next = Math.min(MAX_SCALE, Math.max(1, userScale * factor));
    const ratio = next / userScale;
    // 핀치 중점 고정: 중점 기준으로 오프셋 스케일
    ox = cx - (cx - ox) * ratio;
    oy = cy - (cy - oy) * ratio;
    userScale = next;
    clamp();
    apply();
  }

  // 더블탭/더블클릭 줌 토글
  let lastTap = 0;
  overlay.addEventListener("pointerup", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const now = e.timeStamp;
    if (now - lastTap < 300) {
      const target = userScale > 1 ? 1 : 2.5;
      zoomAt(e.clientX, e.clientY, target / userScale);
    }
    lastTap = now;
  });

  // --- 닫기 ---
  function close() {
    URL.revokeObjectURL(url);
    overlay.remove();
  }
  (overlay.querySelector(".viewer__close") as HTMLElement).onclick = close;

  // --- 크롭: 보이는 영역 → 원본 사각형 → 재인코딩 ---
  const cropBtn = overlay.querySelector(".viewer__crop") as HTMLButtonElement | null;
  if (cropBtn && opts.onCrop) {
    cropBtn.onclick = async () => {
      const eff = baseScale * userScale;
      const sx0 = Math.max(0, (0 - ox) / eff);
      const sy0 = Math.max(0, (0 - oy) / eff);
      const sx1 = Math.min(iw, (vw() - ox) / eff);
      const sy1 = Math.min(ih, (vh() - oy) / eff);
      const sw = Math.round(sx1 - sx0);
      const sh = Math.round(sy1 - sy0);
      if (sw <= 0 || sh <= 0) return;
      const long = Math.max(sw, sh);
      const scale = long > MAX_EDGE ? MAX_EDGE / long : 1;
      const ow = Math.round(sw * scale);
      const oh = Math.round(sh * scale);
      const canvas = document.createElement("canvas");
      canvas.width = ow;
      canvas.height = oh;
      const g = canvas.getContext("2d");
      if (!g) return;
      g.drawImage(imgEl, Math.round(sx0), Math.round(sy0), sw, sh, 0, 0, ow, oh);
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", QUALITY),
      );
      if (blob) opts.onCrop!(blob, ow, oh);
      close();
    };
  }

  // --- 이미지 로드 후 fit ---
  loadImage(url)
    .then((img) => {
      iw = img.naturalWidth || img.width;
      ih = img.naturalHeight || img.height;
      imgEl.src = url;
      fit();
    })
    .catch(() => {
      close();
    });
}
```

- [ ] **Step 2: 뷰어 CSS (`src/styles/app.css` 맨 끝)**

```css
/* --- 전체화면 이미지 뷰어 --- */
.viewer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #000;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}
.viewer__img {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
  -webkit-user-drag: none;
}
.viewer__close {
  position: fixed;
  top: calc(12px + var(--safe-top));
  left: 12px;
  min-width: 48px;
  min-height: 48px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 20px;
  z-index: 1001;
}
.viewer__crop {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(16px + var(--safe-bottom));
  width: min(100% - 40px, 480px);
  z-index: 1001;
}
```

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: 에러 없음(타입 통과).

- [ ] **Step 4: Commit**

```bash
git add src/lib/viewer.ts src/styles/app.css
git commit -m "feat: 전체화면 줌 뷰어 + 보이는영역 크롭 모듈"
```

---

### Task 3: 상세 화면에서 뷰어 열기 + 크롭 저장 (`src/screens/detail.ts`)

**Files:**
- Modify: `src/screens/detail.ts`

**Interfaces:**
- Consumes: `openImageViewer` from `../lib/viewer.ts`(Task 2); 기존 `updateCapture`.
- Produces: 사진 탭 → 뷰어; 크롭 → 캡처 이미지 교체 저장.

- [ ] **Step 1: import 추가**

`src/screens/detail.ts` 상단 import에 추가:

```typescript
import { openImageViewer } from "../lib/viewer.ts";
```

- [ ] **Step 2: 사진 탭 → 뷰어(크롭 콜백 포함)**

`render(cap)` 안에서 사진 주입 블록(`if (cap.image) { ... background-image ... }`) 바로 뒤에, 이미지가 있을 때 탭 핸들러를 추가:

```typescript
    const photoEl = root.querySelector(".detail__photo") as HTMLElement;
    if (cap.image) {
      photoEl.onclick = () => {
        if (!cap.image) return;
        openImageViewer(cap.image, {
          onCrop: async (blob, w, h) => {
            cap.image = blob;
            cap.imageW = w;
            cap.imageH = h;
            await updateCapture({ ...cap, image: blob, imageW: w, imageH: h, updatedAt: Date.now() });
            // 상세 썸네일 갱신
            const u = URL.createObjectURL(blob);
            urls.push(u);
            photoEl.style.backgroundImage = `url(${u})`;
          },
        });
      };
    }
```

(주의: `urls`는 detail.ts가 cleanup에서 revoke하는 기존 배열 — 새 objectURL을 push해 누수 방지.)

- [ ] **Step 3: 빌드 + 수동 확인(데스크톱)**

Run: `npm run build` → 무에러.
Run: `npm run preview` → 캡처(사진 포함) → 상세 → 사진 클릭 → 뷰어. 데스크톱: 더블클릭 줌 토글, 드래그 팬. "보이는 영역으로 자르기" → 상세 사진이 잘린 영역으로 갱신, 다시 들어가도 유지(저장됨).

- [ ] **Step 4: Commit**

```bash
git add src/screens/detail.ts
git commit -m "feat: 상세 사진 탭→줌 뷰어, 크롭 결과 저장"
```

---

## Self-Review

**1. Spec coverage:** 이미지 3200/0.8 → Task1 ✓; 재사용 줌 뷰어(핀치줌/팬/더블탭/닫기/크롭, onload만, touch-action none) → Task2 ✓; 보이는영역 크롭 재인코딩(≤3200/0.8) → Task2 crop ✓; 상세 진입+크롭 저장 → Task3 ✓; iOS 실기기 검증 → 각 검증절 명시 ✓.
**2. Placeholder scan:** 모든 코드 단계 실제 코드. ✓
**3. Type consistency:** `openImageViewer(image: Blob, opts?: ViewerOptions)`/`ViewerOptions.onCrop(blob,width,height)`(Task2) ↔ Task3 호출 시그니처 일치 ✓; `updateCapture`는 기존 export ✓; `urls`/`cap`/`render`는 detail.ts 기존 스코프 ✓.

## 참고
- 멀티터치 핀치는 헤드리스 검증 불가 → **iPhone Safari 실기기로 핀치줌·팬·크롭 확인**(ADR-013). 데스크톱은 더블클릭/드래그로 로직 검증.
- `.btn-primary`/`--safe-top`/`--safe-bottom`은 기존 토큰/클래스 재사용.
