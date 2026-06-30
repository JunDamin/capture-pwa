/** 전체화면 이미지 뷰어 — 핀치줌/팬(Pointer Events) + 조절형 크롭 박스. ADR-013(이미지 로드 onload만). */
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
    ${opts.onCrop ? `
      <button class="viewer__crop btn-primary">✂︎ 보이는 영역으로 자르기</button>
      <div class="viewer__cropbox">
        <div class="viewer__handle" data-h="nw"></div>
        <div class="viewer__handle" data-h="n"></div>
        <div class="viewer__handle" data-h="ne"></div>
        <div class="viewer__handle" data-h="w"></div>
        <div class="viewer__handle" data-h="e"></div>
        <div class="viewer__handle" data-h="sw"></div>
        <div class="viewer__handle" data-h="s"></div>
        <div class="viewer__handle" data-h="se"></div>
      </div>
      <div class="viewer__mask viewer__mask--top"></div>
      <div class="viewer__mask viewer__mask--bottom"></div>
      <div class="viewer__mask viewer__mask--left"></div>
      <div class="viewer__mask viewer__mask--right"></div>
    ` : ""}
  `;
  document.body.appendChild(overlay);
  const imgEl = overlay.querySelector(".viewer__img") as HTMLImageElement;

  // --- Crop box DOM refs (null when opts.onCrop not set) ---
  const cropBoxEl = overlay.querySelector(".viewer__cropbox") as HTMLElement | null;
  const maskTop    = overlay.querySelector(".viewer__mask--top")    as HTMLElement | null;
  const maskBottom = overlay.querySelector(".viewer__mask--bottom") as HTMLElement | null;
  const maskLeft   = overlay.querySelector(".viewer__mask--left")   as HTMLElement | null;
  const maskRight  = overlay.querySelector(".viewer__mask--right")  as HTMLElement | null;

  // --- Crop box state (screen-space) ---
  let box = { l: 0, t: 0, r: 0, b: 0 };
  // Resize gesture state (separate from pan/pinch pointer tracking)
  let resizePointerId = -1;
  let resizeHandle = "";
  let resizePrev = { x: 0, y: 0 };
  // Flag used to block double-tap when a resize gesture just ended
  let resizeJustEnded = false;

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

  // ---- Crop box helpers ----

  /** 초기 박스: 뷰포트에서 가로 8%·세로 12% inset */
  function initBox() {
    if (!cropBoxEl) return;
    const W = vw();
    const H = vh();
    box = {
      l: Math.round(W * 0.08),
      t: Math.round(H * 0.12),
      r: Math.round(W * 0.92),
      b: Math.round(H * 0.88),
    };
    renderBox();
  }

  /** 박스 상태 → DOM 위치 동기화 */
  function renderBox() {
    if (!cropBoxEl || !maskTop || !maskBottom || !maskLeft || !maskRight) return;
    const { l, t, r, b } = box;
    const W = vw();
    const H = vh();
    cropBoxEl.style.left   = `${l}px`;
    cropBoxEl.style.top    = `${t}px`;
    cropBoxEl.style.width  = `${r - l}px`;
    cropBoxEl.style.height = `${b - t}px`;
    // 마스크: 박스 바깥 4영역
    maskTop.style.height    = `${t}px`;
    maskBottom.style.top    = `${b}px`;
    maskBottom.style.height = `${H - b}px`;
    maskLeft.style.top      = `${t}px`;
    maskLeft.style.width    = `${l}px`;
    maskLeft.style.height   = `${b - t}px`;
    maskRight.style.top     = `${t}px`;
    maskRight.style.left    = `${r}px`;
    maskRight.style.width   = `${W - r}px`;
    maskRight.style.height  = `${b - t}px`;
  }

  /**
   * 리사이즈 핸들 드래그 처리.
   * 핸들 이름('nw','n','ne','w','e','sw','s','se')에 포함된
   * 방향 문자(n/s/e/w)로 이동할 변을 결정; 반대 변은 고정.
   * 뷰포트 내 클램프 + 최소 60px.
   */
  function doResize(e: PointerEvent) {
    const dx = e.clientX - resizePrev.x;
    const dy = e.clientY - resizePrev.y;
    resizePrev = { x: e.clientX, y: e.clientY };
    const MIN = 60;
    const W = vw();
    const H = vh();
    let { l, t, r, b } = box;
    const h = resizeHandle;
    if (h.includes("w")) l = Math.min(r - MIN, Math.max(0, l + dx));
    if (h.includes("e")) r = Math.max(l + MIN, Math.min(W, r + dx));
    if (h.includes("n")) t = Math.min(b - MIN, Math.max(0, t + dy));
    if (h.includes("s")) b = Math.max(t + MIN, Math.min(H, b + dy));
    box = { l, t, r, b };
    renderBox();
  }

  // --- Pointer Events: 팬 + 핀치 + 핸들 리사이즈 ---
  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; cx: number; cy: number } | null = null;
  // 더블탭 판별용: 현재 제스처의 최대 동시 포인터 수, 첫 손가락 시작 위치
  let maxPointers = 0;
  let tapStartX = 0;
  let tapStartY = 0;

  overlay.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;

    // 핸들 hit-test: 리사이즈 포인터가 없을 때만 새 리사이즈 시작
    const handleEl = (e.target as HTMLElement).closest("[data-h]") as HTMLElement | null;
    if (handleEl && resizePointerId === -1) {
      overlay.setPointerCapture(e.pointerId);
      resizeHandle = handleEl.dataset["h"] ?? "";
      resizePointerId = e.pointerId;
      resizePrev = { x: e.clientX, y: e.clientY };
      return; // 팬/핀치 로직 건너뜀
    }

    // 팬 / 핀치 (기존 로직)
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
    // 리사이즈 포인터: 핸들 이동 처리
    if (e.pointerId === resizePointerId) {
      doResize(e);
      return;
    }
    // 팬 / 핀치 (기존 로직)
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
    // 리사이즈 포인터 종료
    if (e.pointerId === resizePointerId) {
      resizePointerId = -1;
      resizeHandle = "";
      resizeJustEnded = true; // 더블탭 오작동 방지 플래그
      return;
    }
    // 팬/핀치 포인터 종료
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
  //   + resizeJustEnded===false: 리사이즈 끝을 탭으로 오인하지 않도록
  let lastTap = 0;
  overlay.addEventListener("pointerup", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    // endPointer가 먼저 등록됐으므로 이 시점에 pts/resizeJustEnded는 이미 갱신된 상태
    if (resizeJustEnded) { resizeJustEnded = false; return; }
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

  // --- 크롭: 박스 영역 → 원본 사각형 → 재인코딩 ---
  // sx = (screen - ox) / eff  (역변환)
  const cropBtn = overlay.querySelector(".viewer__crop") as HTMLButtonElement | null;
  if (cropBtn && opts.onCrop) {
    cropBtn.onclick = async () => {
      const eff = baseScale * userScale;
      // 박스 좌표를 원본 이미지 픽셀로 역변환
      const sx0 = Math.max(0,  (box.l - ox) / eff);
      const sy0 = Math.max(0,  (box.t - oy) / eff);
      const sx1 = Math.min(iw, (box.r - ox) / eff);
      const sy1 = Math.min(ih, (box.b - oy) / eff);
      // M2: 각 변을 독립적으로 반올림하여 범위 초과 방지
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
    initBox(); // 이미지 크기 확정 후 박스 초기화
  };
  imgEl.onerror = () => {
    close();
  };
  imgEl.src = url;
}
