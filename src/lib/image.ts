/**
 * 이미지 리사이즈 + 압축 — ADR-003.
 * 긴 변 ~3200px, JPEG ~0.8 → 책 글씨 가독 우선(확대/크롭 대비). 원본 미보관.
 * 셔터 시점에 동결 캔버스를 받아 크롭·압축한다(ADR-018).
 */

export const IMAGE_MAX_EDGE = 3200;
export const IMAGE_QUALITY = 0.8;

function targetSize(w: number, h: number, maxEdge: number) {
  const long = Math.max(w, h);
  if (long <= maxEdge) return { w, h };
  const scale = maxEdge / long;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** OffscreenCanvas가 있으면 그것을, 없으면 일반 canvas를 사용. */
function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  return new Promise<Blob>((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality,
    ),
  );
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
}

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
): Promise<CompressResult> {
  const sx = Math.max(0, Math.min(cropPx.sx, srcW));
  const sy = Math.max(0, Math.min(cropPx.sy, srcH));
  const sw = Math.max(1, Math.min(cropPx.sw, srcW - sx));
  const sh = Math.max(1, Math.min(cropPx.sh, srcH - sy));
  const t = targetSize(sw, sh, maxEdge); // 크롭 영역 기준 다운스케일
  const canvas = makeCanvas(t.w, t.h);
  const ctx = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("2d ctx 없음");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, t.w, t.h);
  const blob = await canvasToBlob(canvas, quality);
  canvas.width = 0;
  canvas.height = 0; // 백킹스토어 해제(iOS 메모리)
  return { blob, width: t.w, height: t.h };
}
