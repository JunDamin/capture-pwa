/** PWA 설치/공유 수신 유틸. 정적 import 전용(ADR-013). */

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// beforeinstallprompt(안드로이드/크롬) — 모듈 초기화 시 등록
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferredPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
});

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const p = deferredPrompt;
  deferredPrompt = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  return outcome;
}

// 공유 수신 텍스트(1회성) — main.ts가 set, capture.ts가 consume
let pendingSharedText: string | null = null;
export function setPendingSharedText(t: string): void {
  pendingSharedText = t;
}
export function consumeSharedText(): string | null {
  const t = pendingSharedText;
  pendingSharedText = null;
  return t;
}
export function hasPendingSharedText(): boolean {
  return pendingSharedText != null;
}
