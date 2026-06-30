/** 전체화면 이미지 뷰어 — 핀치줌/팬(Pointer Events) + 보이는 영역 크롭. ADR-013(이미지 로드 onload만). */
const MAX_EDGE = 3200;
const QUALITY = 0.8;
const MAX_SCALE = 6;

export interface ViewerOptions {
  onCrop?: (blob: Blob, width: number, height: number) => void;
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
  let closed = false; // M3: guard double close
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
  // 더블탭 판별용: 현재 제스처의 최대 동시 포인터 수, 첫 손가락 시작 위치
  let maxPointers = 0;
  let tapStartX = 0;
  let tapStartY = 0;

  overlay.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    overlay.setPointerCapture(e.pointerId);
    const wasEmpty = pts.size === 0;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (wasEmpty) {
      // 새 제스처 시작: 최대 포인터 수·탭 시작 위치 초기화
      maxPointers = 1;
      tapStartX = e.clientX;
      tapStartY = e.clientY;
    } else {
      maxPointers = Math.max(maxPointers, pts.size);
    }
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

  // 더블탭 줌 토글 — 핀치 끝/드래그 끝과 오인되지 않도록 세 조건을 모두 검사:
  //   1) maxPointers===1: 이번 제스처 내내 손가락이 하나였을 것 (핀치 배제)
  //   2) moved<10px: 손가락이 거의 움직이지 않았을 것 (팬 배제)
  //   3) pts.size===0: 모든 손가락이 떨어졌을 것
  let lastTap = 0;
  overlay.addEventListener("pointerup", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    // endPointer가 먼저 등록됐으므로 이 시점에 pts는 이미 갱신된 상태
    const now = e.timeStamp;
    const moved = Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY);
    const isTap = maxPointers === 1 && moved < 10 && pts.size === 0;
    if (isTap && now - lastTap < 300) {
      const target = userScale > 1 ? 1 : 2.5;
      zoomAt(e.clientX, e.clientY, target / userScale);
    }
    if (isTap) lastTap = now;
  });

  // --- 닫기 ---
  function close() {
    if (closed) return; // M3: idempotent
    closed = true;
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
      // M2: round each edge independently so right/bottom never exceeds image bounds by a pixel
      const sx = Math.round(sx0);
      const sy = Math.round(sy0);
      const sw = Math.round(sx1) - sx;
      const sh = Math.round(sy1) - sy;
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
      g.drawImage(imgEl, sx, sy, sw, sh, 0, 0, ow, oh);
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", QUALITY),
      );
      if (blob) opts.onCrop!(blob, ow, oh);
      close();
    };
  }

  // --- 이미지 로드: imgEl에 직접 — M4: 이중 디코드 제거(iOS 메모리) ---
  imgEl.onload = () => {
    iw = imgEl.naturalWidth;
    ih = imgEl.naturalHeight;
    fit();
  };
  imgEl.onerror = () => {
    close();
  };
  imgEl.src = url;
}
