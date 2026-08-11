/**
 * 카메라 — getUserMedia 웜업 + 백그라운드 복귀 시 스트림 되살리기. ADR-011(웜업 예산), ADR-021(복귀).
 *
 * iOS는 앱이 백그라운드에 가면 <video>를 pause시키고 카메라 트랙을 mute/ended로 만든다.
 * 복귀 시 아무도 되살리지 않으면 뷰파인더는 마지막 프레임에서 정지하고, 셔터는 그 낡은 프레임을 찍는다.
 * 그래서 이 모듈은 "스트림이 살아 있는가"를 **트랙 상태 플래그가 아니라 프레임이 실제로 흐르는지**로 판정한다
 * (iOS는 복귀 직후 트랙이 잠시 muted였다가 스스로 풀리기도 해서, 플래그로 분기하면 멀쩡한 스트림을 재시작하게 된다).
 */
import { Stopwatch } from "../lib/budget.ts";

export interface CameraHandle {
  stream: MediaStream;
  warmupMs: number;
}

/** 복귀 판정 창 — 이 안에 프레임이 오면 살아 있는 것. */
const RESUME_FRAME_MS = 600;
/** 웜업 대기 상한 — 없으면 백그라운드에서 시작된 startCamera가 영영 pending으로 남는다. */
const WARMUP_TIMEOUT_MS = 5000;

let active: MediaStream | null = null;
let activeVideo: HTMLVideoElement | null = null;
let starting: Promise<CameraHandle> | null = null;

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

/**
 * 다음 프레임이 실제로 그려질 때까지 기다린다. 온 프레임이 있으면 true, 시간 안에 없으면 false.
 * rVFC가 가장 정확하고(정지된 video에는 안 온다), 없으면 loadeddata + currentTime 전진으로 감지한다.
 */
function waitForFrame(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    let poll = 0;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      video.onloadeddata = null;
      resolve(ok);
    };
    const fv = video as FrameVideo;
    if (fv.requestVideoFrameCallback) {
      fv.requestVideoFrameCallback(() => finish(true));
    } else {
      // 첫 기동은 loadeddata, 복귀는 이미 로드된 상태라 currentTime 전진으로만 알 수 있다
      video.onloadeddata = () => finish(true);
      const t0 = video.currentTime;
      poll = window.setInterval(() => {
        if (video.currentTime > t0) finish(true);
      }, 50);
    }
    timer = window.setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * 후면 카메라를 켜고, 첫 프레임이 실제로 그려질 때까지의 시간을 측정한다.
 * 웜업 = getUserMedia 호출 ~ video가 재생 가능(첫 프레임)까지.
 * 중복 호출은 진행 중인 기동에 합류한다 — 스트림을 겹쳐 켜 놓고 놓치는 일을 막는다.
 */
export function startCamera(video: HTMLVideoElement): Promise<CameraHandle> {
  if (starting) return starting;
  const p = doStart(video).finally(() => {
    if (starting === p) starting = null;
  });
  starting = p;
  return p;
}

async function doStart(video: HTMLVideoElement): Promise<CameraHandle> {
  stopCamera(); // 남아 있던 스트림 정리 — 재진입 시 트랙 누수(카메라 LED 유지) 방지
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
  activeVideo = video;
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;

  const frame = waitForFrame(video, WARMUP_TIMEOUT_MS); // play() 전에 걸어야 첫 프레임을 놓치지 않는다
  const played = await video
    .play()
    .then(() => true)
    .catch(() => false);
  if (played) await frame;

  return { stream, warmupMs: sw.stop() };
}

export type ResumeResult = "ok" | "restart-needed" | "idle";

/**
 * 백그라운드 복귀 시 호출 — 싼 것부터 시도한다.
 * 1) video.play()로 요소 pause만 풀어 본다(권한 재요청도 웜업도 없음).
 * 2) 짧은 창 안에 프레임이 오면 "ok". 안 오면 트랙이 죽은 것이므로 "restart-needed".
 */
export async function resumeCamera(video: HTMLVideoElement): Promise<ResumeResult> {
  if (!active) return "idle"; // 카메라를 쓰는 화면이 아님
  if (starting) return "ok"; // 기동이 진행 중 — 건드리지 않는다
  const frame = waitForFrame(video, RESUME_FRAME_MS);
  await video.play().catch(() => {});
  return (await frame) ? "ok" : "restart-needed";
}

/**
 * 동기 생사 점검 — 셔터 경로에서 쓰므로 비동기 대기 금지(3초 루프 예산, ADR-018).
 * 낡은 프레임이 진짜 사진인 양 저장되는 것을 막는 게 목적이다.
 */
export function isCameraLive(video: HTMLVideoElement): boolean {
  if (!active) return false;
  const live = active.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
  return live && video.videoWidth > 0 && !video.paused;
}

export function stopCamera() {
  active?.getTracks().forEach((t) => t.stop());
  active = null;
  if (activeVideo) {
    activeVideo.srcObject = null; // 죽은 스트림 참조를 DOM에 남기지 않는다
    activeVideo = null;
  }
}
