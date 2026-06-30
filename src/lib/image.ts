/**
 * 이미지 리사이즈 + 압축 — ADR-003.
 * 긴 변 ~3200px, JPEG ~0.8 → 책 글씨 가독 우선(확대/크롭 대비). 원본 미보관.
 * 저장 직후 백그라운드에서 호출하여 카메라 복귀를 막지 않는다.
 */

export const IMAGE_MAX_EDGE = 3200;
export const IMAGE_QUALITY = 0.8;

type Source = ImageBitmap | HTMLVideoElement | HTMLCanvasElement;

function targetSize(w: number, h: number, maxEdge: number) {
  const long = Math.max(w, h);
  if (long <= maxEdge) return { w, h };
  const scale = maxEdge / long;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function sourceSize(src: Source): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) {
    return { w: src.videoWidth, h: src.videoHeight };
  }
  return { w: src.width, h: src.height };
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

export async function resizeCompress(
  src: Source,
  maxEdge = IMAGE_MAX_EDGE,
  quality = IMAGE_QUALITY,
): Promise<CompressResult> {
  const { w, h } = sourceSize(src);
  const t = targetSize(w, h, maxEdge);
  const canvas = makeCanvas(t.w, t.h);
  const ctx = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(src as CanvasImageSource, 0, 0, t.w, t.h);
  const blob = await canvasToBlob(canvas, quality);
  return { blob, width: t.w, height: t.h };
}

/** 비디오 현재 프레임을 즉시 ImageBitmap으로 동결(셔터). 압축 전 단계. */
export async function grabFrame(video: HTMLVideoElement): Promise<ImageBitmap> {
  return createImageBitmap(video);
}
