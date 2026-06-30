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
