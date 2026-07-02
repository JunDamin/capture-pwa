/**
 * 전달 — ADR-008(ADR-019 개정). 현재 호출은 PDF 1개 + 텍스트(프롬프트)를 Web Share로 공유.
 * 보조: 클립보드 복사, 다운로드. 다중 파일 공유 능력은 범용으로 유지.
 */

export interface ShareFile {
  name: string;
  blob: Blob;
}

export function canShareFiles(files: ShareFile[]): boolean {
  if (!("share" in navigator) || !("canShare" in navigator)) return false;
  const data = { files: files.map((f) => new File([f.blob], f.name, { type: f.blob.type })) };
  try {
    return (navigator as Navigator).canShare(data);
  } catch {
    return false;
  }
}

export type ShareResult = "shared" | "cancelled" | "unsupported" | "error";

/** 파일(현재는 PDF 1개)을 공유. 미지원/취소/에러를 구분해 반환. text는 선택적으로 공유 페이로드에 포함(많은 앱이 파일과 함께 올 때 무시하지만 지원하는 경우 활용). */
export async function shareFiles(files: ShareFile[], title: string, text?: string): Promise<ShareResult> {
  if (!canShareFiles(files)) return "unsupported";
  const data: ShareData = {
    title,
    files: files.map((f) => new File([f.blob], f.name, { type: f.blob.type })),
    ...(text ? { text } : {}),
  };
  try {
    await (navigator as Navigator).share(data);
    return "shared";
  } catch (e) {
    if ((e as Error).name === "AbortError") return "cancelled";
    return "error";
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadFile(file: ShareFile) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
