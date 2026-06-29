/**
 * 카메라 — getUserMedia 웜업. PRD §16 최대 리스크(웜업 ≤ 1s) 측정 지점.
 */
import { Stopwatch } from "../lib/budget.ts";

export interface CameraHandle {
  stream: MediaStream;
  warmupMs: number;
}

let active: MediaStream | null = null;

/**
 * 후면 카메라를 켜고, 첫 프레임이 실제로 그려질 때까지의 시간을 측정한다.
 * 웜업 = getUserMedia 호출 ~ video가 재생 가능(첫 프레임)까지.
 */
export async function startCamera(video: HTMLVideoElement): Promise<CameraHandle> {
  const sw = new Stopwatch();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  active = stream;
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // 첫 프레임 콜백이 있으면 가장 정확하다.
    const anyVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (anyVideo.requestVideoFrameCallback) {
      anyVideo.requestVideoFrameCallback(() => finish());
    } else {
      video.onloadeddata = () => finish();
    }
    video.play().catch(() => finish());
  });

  return { stream, warmupMs: sw.stop() };
}

export function stopCamera() {
  active?.getTracks().forEach((t) => t.stop());
  active = null;
}
