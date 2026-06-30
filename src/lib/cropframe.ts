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
